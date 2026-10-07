import { Injectable } from '@nestjs/common';
import {
  type EmployeeCreate,
  type EmployeeListQuery,
  type EmployeeRecord,
  type EmployeeUpdate,
  type Page,
  type Permission,
  type Role,
  type RoleChange,
  type DeactivateRequest,
  type Scope,
  VENDOR_STAFF_ROLES,
  scopeFor,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import { AuthTokenService, type AuthTokenKind } from '../../core/auth/auth-token.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { SessionService } from '../../core/auth/session.service';
import { ProblemException } from '../../core/errors/problem';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { AuditAction } from '@smartcode/shared';
import type { Tx } from '../../core/prisma/actor-transaction';
import { EMPLOYEE_INCLUDE, type EmployeeWithRelations, toEmployeeRecord } from './employee-record';
import { employeeScopeWhere } from './employee-scope';

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Employee not found');

export interface ActivationOutcome {
  emailed: boolean;
  expiresAt: string;
}

/**
 * The Employee Directory — the single employee master (docs/07). Every operation re-derives what the caller may
 * touch from the authenticated principal; a record outside that scope is "not found", never "forbidden".
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
    private readonly mail: MailService,
  ) {}

  // ───────── reads ─────────

  private scopeOf(principal: Principal, permission: Permission): Scope {
    const scope = scopeFor(principal.role, permission);
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    return scope;
  }

  async list(principal: Principal, query: EmployeeListQuery): Promise<Page<EmployeeRecord>> {
    const scope = this.scopeOf(principal, 'employee.read');
    const filters: Prisma.EmployeeWhereInput[] = [employeeScopeWhere(principal, scope)];
    if (query.role) filters.push({ role: query.role });
    if (query.status) filters.push({ status: query.status });
    if (query.vendorId) filters.push({ vendorId: query.vendorId });
    if (query.teamId) filters.push({ teamMemberships: { some: { teamId: query.teamId, endedAt: null } } });
    if (query.projectId)
      filters.push({ projectAssignments: { some: { projectId: query.projectId, endedAt: null } } });
    if (query.loginName) {
      filters.push({
        loginNameAssignments: {
          some: { endedAt: null, loginName: { value: { contains: query.loginName, mode: 'insensitive' } } },
        },
      });
    }
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      filters.push({
        OR: [
          { employeeCode: contains },
          { fullName: contains },
          { email: contains },
          { loginNameAssignments: { some: { endedAt: null, loginName: { value: contains } } } },
        ],
      });
    }
    const where: Prisma.EmployeeWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.employee.count({ where }),
      this.prisma.client.employee.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: [{ [query.sort]: query.direction }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toEmployeeRecord), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Choices for the directory's filters and the Add Employee form: vendors, teams and projects the caller may see.
   * Only organization- and vendor-wide readers get any; a vendor user only ever sees their own vendor's.
   */
  async options(principal: Principal): Promise<{
    vendors: { id: string; name: string }[];
    teams: { id: string; name: string; vendorId: string | null }[];
    projects: { id: string; name: string; vendorId: string | null }[];
  }> {
    const scope = this.scopeOf(principal, 'employee.read');
    if (scope !== 'ORG' && scope !== 'VENDOR') return { vendors: [], teams: [], projects: [] };
    const organizationId = principal.organizationId;
    const vendorOnly = principal.vendorId ? { vendorId: principal.vendorId } : {};
    const [vendors, teams, projects] = await Promise.all([
      this.prisma.client.vendor.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          ...(principal.vendorId ? { id: principal.vendorId } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.team.findMany({
        where: { organizationId, status: 'ACTIVE', ...vendorOnly },
        select: { id: true, name: true, vendorId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.project.findMany({
        where: { organizationId, ...vendorOnly },
        select: { id: true, name: true, vendorId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { vendors, teams, projects };
  }

  async get(principal: Principal, id: string): Promise<EmployeeRecord> {
    return toEmployeeRecord(await this.loadVisible(principal, id, 'employee.read'));
  }

  /**
   * Loads an employee the principal may see under `permission`, or 404. With `manage`, a Vendor Admin may only act on
   * Team Leads, Auditors and Coders of their vendor (never on a fellow Vendor Admin) — except on their own record.
   */
  async loadVisible(
    principal: Principal,
    id: string,
    permission: Permission,
    options: { manage?: boolean } = {},
  ): Promise<EmployeeWithRelations> {
    const scope = this.scopeOf(principal, permission);
    const found = await this.prisma.client.employee.findFirst({
      where: { AND: [{ id }, employeeScopeWhere(principal, scope)] },
      include: EMPLOYEE_INCLUDE,
    });
    if (!found) throw notFound();
    if (
      options.manage &&
      scope === 'VENDOR' &&
      found.id !== principal.employeeId &&
      !VENDOR_STAFF_ROLES.includes(found.role as Role)
    ) {
      throw new ProblemException(
        403,
        'FORBIDDEN',
        'A Vendor Admin can only manage Team Leads, Auditors and Coders',
      );
    }
    return found;
  }

  // ───────── create ─────────

  async create(
    principal: Principal,
    input: EmployeeCreate,
    meta: RequestMeta,
  ): Promise<EmployeeRecord & { activation?: ActivationOutcome }> {
    const scope = this.scopeOf(principal, 'employee.create');
    const vendorId = await this.resolveVendorForCreate(principal, scope, input.role, input.vendorId);
    await this.assertIdentityFree(input.employeeCode, input.email, principal.organizationId);
    if (input.teamId) await this.assertTeamUsable(input.teamId, principal.organizationId, vendorId);

    const { employee, token, expiresAt } = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'employee created' },
      async (tx) => {
        const created = await tx.employee.create({
          data: {
            organizationId: principal.organizationId,
            employeeCode: input.employeeCode,
            fullName: input.fullName,
            email: input.email,
            role: input.role,
            vendorId,
            createdById: principal.employeeId,
          },
        });
        if (input.teamId) {
          await tx.teamMembership.create({
            data: { teamId: input.teamId, employeeId: created.id, createdById: principal.employeeId },
          });
        }
        let issued: { token: string; expiresAt: Date } | null = null;
        if (input.sendActivation)
          issued = await this.tokens.issue(tx, created.id, 'ACTIVATION', principal.employeeId);
        await this.log(tx, principal, meta, 'EMPLOYEE.CREATED', created.id, {
          after: {
            employeeCode: created.employeeCode,
            role: created.role,
            vendorId,
            teamId: input.teamId ?? null,
          },
        });
        const full = await tx.employee.findUniqueOrThrow({
          where: { id: created.id },
          include: EMPLOYEE_INCLUDE,
        });
        return { employee: full, token: issued?.token ?? null, expiresAt: issued?.expiresAt ?? null };
      },
    );

    const record = toEmployeeRecord(employee);
    if (!token || !expiresAt) return record;
    const emailed = await this.sendActivationEmail(principal, employee, token);
    return { ...record, activation: { emailed, expiresAt: expiresAt.toISOString() } };
  }

  /** Which vendor the new employee belongs to, enforcing role/vendor rules for the creator's scope. */
  private async resolveVendorForCreate(
    principal: Principal,
    scope: Scope,
    role: Role,
    requested: string | undefined,
  ): Promise<string | null> {
    let vendorId: string | null;
    if (scope === 'VENDOR') {
      // A Vendor Admin creates staff inside their own vendor only, whatever the request says.
      if (!principal.vendorId)
        throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      if (!VENDOR_STAFF_ROLES.includes(role)) {
        throw new ProblemException(
          403,
          'FORBIDDEN',
          'A Vendor Admin can only add Team Leads, Auditors and Coders',
        );
      }
      if (requested && requested !== principal.vendorId) throw notFound();
      vendorId = principal.vendorId;
    } else {
      vendorId = requested ?? null;
      if (role === 'VENDOR_ADMIN' && !vendorId) {
        throw this.invalid('vendorId', 'A Vendor Admin must belong to a vendor');
      }
      if (['MANAGER', 'HR', 'GROUP_COACH'].includes(role) && vendorId) {
        throw this.invalid('vendorId', 'This role is organization-wide and cannot belong to a vendor');
      }
    }
    if (vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: vendorId, organizationId: principal.organizationId },
        select: { status: true },
      });
      if (!vendor) throw this.invalid('vendorId', 'Vendor not found');
      if (vendor.status !== 'ACTIVE') throw this.invalid('vendorId', 'That vendor is not active');
    }
    return vendorId;
  }

  async assertIdentityFree(
    employeeCode: string,
    email: string,
    organizationId: string,
    ignoreId?: string,
  ): Promise<void> {
    const [byCode, byEmail] = await Promise.all([
      this.prisma.client.employee.findFirst({
        where: {
          organizationId,
          employeeCode: { equals: employeeCode, mode: 'insensitive' },
          ...(ignoreId ? { id: { not: ignoreId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.client.employee.findFirst({
        where: { email, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
        select: { id: true },
      }),
    ]);
    if (byCode) throw this.conflict('employeeCode', 'This Employee ID is already in use');
    if (byEmail) throw this.conflict('email', 'This email address is already in use');
  }

  private async assertTeamUsable(
    teamId: string,
    organizationId: string,
    vendorId: string | null,
  ): Promise<void> {
    const team = await this.prisma.client.team.findFirst({
      where: { id: teamId, organizationId },
      select: { status: true, vendorId: true },
    });
    if (!team) throw this.invalid('teamId', 'Team not found');
    if (team.status !== 'ACTIVE') throw this.invalid('teamId', 'That team is not active');
    if (team.vendorId !== vendorId)
      throw this.invalid('teamId', 'The team must belong to the same vendor as the employee');
  }

  // ───────── update ─────────

  async update(
    principal: Principal,
    id: string,
    input: EmployeeUpdate,
    meta: RequestMeta,
  ): Promise<EmployeeRecord> {
    const scope = this.scopeOf(principal, 'employee.update');
    const target = await this.loadVisible(principal, id, 'employee.update', { manage: true });
    const hrOrSelfOnly = principal.role === 'HR' || scope === 'SELF';
    if (hrOrSelfOnly && (input.email !== undefined || input.teamId !== undefined)) {
      throw new ProblemException(403, 'FORBIDDEN', 'You can only edit the name on this profile');
    }
    if (input.email !== undefined && input.email !== target.email) {
      if (target.status !== 'PENDING_ACTIVATION') {
        throw new ProblemException(
          409,
          'CONFLICT',
          'Email is the sign-in identity, so it can only be corrected before the account is activated',
        );
      }
      await this.assertIdentityFree(target.employeeCode, input.email, principal.organizationId, target.id);
    }
    if (input.teamId) await this.assertTeamUsable(input.teamId, principal.organizationId, target.vendorId);

    const before = {
      fullName: target.fullName,
      email: target.email,
      teamId: target.teamMemberships[0]?.team.id ?? null,
    };
    const updated = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'employee updated' },
      async (tx) => {
        const data: Prisma.EmployeeUpdateInput = {};
        if (input.fullName !== undefined) data.fullName = input.fullName;
        if (input.email !== undefined && target.status === 'PENDING_ACTIVATION') data.email = input.email;
        if (Object.keys(data).length) await tx.employee.update({ where: { id }, data });
        if (input.teamId !== undefined && input.teamId !== before.teamId) {
          await tx.teamMembership.updateMany({
            where: { employeeId: id, endedAt: null },
            data: { endedAt: new Date() },
          });
          if (input.teamId) {
            await tx.teamMembership.create({
              data: { teamId: input.teamId, employeeId: id, createdById: principal.employeeId },
            });
          }
        }
        const after = {
          fullName: input.fullName ?? before.fullName,
          email: (target.status === 'PENDING_ACTIVATION' ? input.email : undefined) ?? before.email,
          teamId: input.teamId === undefined ? before.teamId : input.teamId,
        };
        await this.log(tx, principal, meta, 'EMPLOYEE.UPDATED', id, { before, after });
        return tx.employee.findUniqueOrThrow({ where: { id }, include: EMPLOYEE_INCLUDE });
      },
    );
    return toEmployeeRecord(updated);
  }

  // ───────── activation & password reset (initiated by an administrator) ─────────

  async sendActivation(principal: Principal, id: string, meta: RequestMeta): Promise<ActivationOutcome> {
    const target = await this.loadVisible(principal, id, 'employee.sendActivation', { manage: true });
    if (target.status !== 'PENDING_ACTIVATION') {
      throw new ProblemException(
        409,
        'CONFLICT',
        'Only employees who have not activated yet can be sent an activation link',
      );
    }
    const { token, expiresAt } = await this.prisma.transaction(
      { actorId: principal.employeeId },
      async (tx) => {
        const issued = await this.tokens.issue(tx, id, 'ACTIVATION', principal.employeeId);
        await this.log(tx, principal, meta, 'EMPLOYEE.ACTIVATION_SENT', id, {});
        return issued;
      },
    );
    const emailed = await this.sendActivationEmail(principal, target, token);
    return { emailed, expiresAt: expiresAt.toISOString() };
  }

  async sendActivationBulk(
    principal: Principal,
    ids: string[],
    meta: RequestMeta,
  ): Promise<{ sent: number; failed: number; skipped: { id: string; reason: string }[] }> {
    let sent = 0;
    let failed = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const outcome = await this.sendActivation(principal, id, meta);
        if (outcome.emailed) sent += 1;
        else failed += 1;
      } catch (error) {
        if (error instanceof ProblemException) skipped.push({ id, reason: error.message });
        else throw error;
      }
    }
    return { sent, failed, skipped };
  }

  async triggerPasswordReset(
    principal: Principal,
    id: string,
    meta: RequestMeta,
  ): Promise<{ emailed: boolean }> {
    const target = await this.loadVisible(principal, id, 'employee.triggerPasswordReset', { manage: true });
    if (target.status === 'PENDING_ACTIVATION') {
      throw new ProblemException(
        409,
        'CONFLICT',
        'This account is not activated yet. Send an activation link instead — a password reset cannot replace activation.',
      );
    }
    if (target.status !== 'ACTIVE') {
      throw new ProblemException(409, 'CONFLICT', 'Only active accounts can have their password reset');
    }
    const { token } = await this.prisma.transaction({ actorId: principal.employeeId }, async (tx) => {
      const issued = await this.tokens.issue(tx, id, 'PASSWORD_RESET', principal.employeeId);
      await this.log(tx, principal, meta, 'EMPLOYEE.PASSWORD_RESET_TRIGGERED', id, {});
      return issued;
    });
    // The link goes to the employee's own inbox; the Manager never receives it or the new password.
    const emailed = await this.mail.trySend(
      () => this.mail.sendPasswordReset(target, token, 'manager'),
      'password-reset',
    );
    return { emailed };
  }

  private sendActivationEmail(
    principal: Principal,
    target: EmployeeWithRelations,
    token: string,
  ): Promise<boolean> {
    return this.prisma.client.employee
      .findUnique({ where: { id: principal.employeeId }, select: { fullName: true } })
      .then((actor) =>
        this.mail.trySend(
          () =>
            this.mail.sendActivation({ ...target, role: target.role as Role }, token, {
              ...(actor ? { invitedByName: actor.fullName } : {}),
            }),
          'activation',
        ),
      );
  }

  // ───────── deactivate / reactivate ─────────

  async deactivate(
    principal: Principal,
    id: string,
    input: DeactivateRequest,
    meta: RequestMeta,
  ): Promise<EmployeeRecord> {
    const target = await this.loadVisible(principal, id, 'employee.deactivate', { manage: true });
    if (target.id === principal.employeeId) {
      throw new ProblemException(409, 'CONFLICT', 'You cannot deactivate your own account');
    }
    if (target.status === 'INACTIVE')
      throw new ProblemException(409, 'CONFLICT', 'This employee is already inactive');

    const [allocations, rework] = await Promise.all([
      this.prisma.client.chartAllocation.count({ where: { employeeId: id, status: 'ACTIVE' } }),
      this.prisma.client.rework.count({
        where: { assignedCoderId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);
    if ((allocations > 0 || rework > 0) && !input.confirmOpenWork) {
      throw new ProblemException(
        409,
        'CONFLICT',
        `This employee still has ${allocations} allocated chart(s) and ${rework} open rework item(s). Reallocate them first, or confirm to deactivate anyway.`,
      );
    }

    const updated = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: input.reason },
      async (tx) => {
        // The database ends the open Login Name assignment (EMPLOYEE_INACTIVE) and protects the last active Manager.
        await tx.employee.update({ where: { id }, data: { status: 'INACTIVE', deactivatedAt: new Date() } });
        await this.tokens.revokeAllLive(tx, id);
        const revoked = await this.sessions.revokeAllForEmployee(id, {}, tx);
        await this.log(tx, principal, meta, 'EMPLOYEE.DEACTIVATED', id, {
          before: { status: target.status },
          after: {
            status: 'INACTIVE',
            reason: input.reason,
            sessionsRevoked: revoked,
            openAllocations: allocations,
            openRework: rework,
          },
        });
        return tx.employee.findUniqueOrThrow({ where: { id }, include: EMPLOYEE_INCLUDE });
      },
    );
    await this.mail.trySend(() => this.mail.sendAccountStatus(target, 'DEACTIVATED'), 'account-status');
    return toEmployeeRecord(updated);
  }

  /** INACTIVE → PENDING_ACTIVATION with a fresh activation link (the person chooses a new password). */
  async reactivate(
    principal: Principal,
    id: string,
    meta: RequestMeta,
  ): Promise<EmployeeRecord & { activation: ActivationOutcome }> {
    const target = await this.loadVisible(principal, id, 'employee.deactivate', { manage: true });
    if (target.status !== 'INACTIVE')
      throw new ProblemException(409, 'CONFLICT', 'Only inactive employees can be reactivated');
    const { employee, token, expiresAt } = await this.prisma.transaction(
      { actorId: principal.employeeId },
      async (tx) => {
        await tx.employee.update({ where: { id }, data: { status: 'PENDING_ACTIVATION' } });
        const issued = await this.tokens.issue(tx, id, 'ACTIVATION', principal.employeeId);
        await this.log(tx, principal, meta, 'EMPLOYEE.REACTIVATED', id, {
          before: { status: 'INACTIVE' },
          after: { status: 'PENDING_ACTIVATION' },
        });
        const full = await tx.employee.findUniqueOrThrow({ where: { id }, include: EMPLOYEE_INCLUDE });
        return { employee: full, token: issued.token, expiresAt: issued.expiresAt };
      },
    );
    await this.mail.trySend(() => this.mail.sendAccountStatus(target, 'REACTIVATED'), 'account-status');
    const emailed = await this.sendActivationEmail(principal, employee, token);
    return { ...toEmployeeRecord(employee), activation: { emailed, expiresAt: expiresAt.toISOString() } };
  }

  // ───────── role change (Manager only) ─────────

  async changeRole(
    principal: Principal,
    id: string,
    input: RoleChange,
    meta: RequestMeta,
  ): Promise<EmployeeRecord & { loginNameEnded: boolean }> {
    const target = await this.loadVisible(principal, id, 'employee.changeRole');
    if (target.id === principal.employeeId) {
      throw new ProblemException(409, 'CONFLICT', 'You cannot change your own role');
    }
    if (target.role === input.role) throw this.invalid('role', 'The employee already has this role');
    if (target.vendorId) {
      if (!['TEAM_LEAD', 'AUDITOR', 'CODER', 'VENDOR_ADMIN'].includes(input.role)) {
        throw this.invalid('role', 'Vendor staff can only be a Team Lead, Auditor, Coder or Vendor Admin');
      }
    } else if (input.role === 'VENDOR_ADMIN') {
      throw this.invalid('role', 'A Vendor Admin must belong to a vendor');
    }

    const [allocations, rework, ledTeams] = await Promise.all([
      this.prisma.client.chartAllocation.count({ where: { employeeId: id, status: 'ACTIVE' } }),
      this.prisma.client.rework.count({
        where: { assignedCoderId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.client.team.count({ where: { teamLeadId: id, status: 'ACTIVE' } }),
    ]);
    if (allocations > 0)
      throw new ProblemException(
        409,
        'CONFLICT',
        'This employee still holds allocated charts. Reallocate them before changing the role.',
      );
    if (rework > 0)
      throw new ProblemException(
        409,
        'CONFLICT',
        'This employee has open rework. Complete or reassign it before changing the role.',
      );
    if (ledTeams > 0)
      throw new ProblemException(
        409,
        'CONFLICT',
        'This employee leads an active team. Assign another Team Lead before changing the role.',
      );

    const hadLoginName = target.loginNameAssignments.length > 0;
    const updated = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: input.reason },
      async (tx) => {
        // The database ends a Login Name that the new role cannot hold (ROLE_CHANGED) and project staffing recorded for
        // the old role. Nothing is deleted: history stays.
        await tx.employee.update({ where: { id }, data: { role: input.role } });
        const full = await tx.employee.findUniqueOrThrow({ where: { id }, include: EMPLOYEE_INCLUDE });
        const ended = hadLoginName && full.loginNameAssignments.length === 0;
        await this.log(tx, principal, meta, 'EMPLOYEE.ROLE_CHANGED', id, {
          before: { role: target.role },
          after: { role: input.role, reason: input.reason, loginNameEnded: ended },
        });
        if (ended) {
          await this.log(tx, principal, meta, 'LOGIN_NAME.ENDED', id, {
            before: { loginName: target.loginNameAssignments[0]?.loginName.value ?? null },
            after: { endReason: 'ROLE_CHANGED' },
          });
        }
        return { full, ended };
      },
    );
    await this.mail.trySend(
      () => this.mail.sendAccountStatus(target, 'ROLE_CHANGED', input.role),
      'account-status',
    );
    return { ...toEmployeeRecord(updated.full), loginNameEnded: updated.ended };
  }

  // ───────── helpers ─────────

  async log(
    tx: Tx,
    principal: Principal,
    meta: RequestMeta,
    action: AuditAction,
    employeeId: string,
    detail: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.audit.record(
      {
        organizationId: principal.organizationId,
        actorId: principal.employeeId,
        actorRole: principal.role,
        action,
        entityType: 'Employee',
        entityId: employeeId,
        ...(detail.before ? { before: detail.before } : {}),
        ...(detail.after ? { after: detail.after } : {}),
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await this.activity.record(
      {
        organizationId: principal.organizationId,
        actorId: principal.employeeId,
        action,
        entityType: 'Employee',
        entityId: employeeId,
      },
      tx,
    );
  }

  private invalid(field: string, message: string) {
    return new ProblemException(422, 'VALIDATION_FAILED', message, [{ field, message }]);
  }

  private conflict(field: string, message: string) {
    return new ProblemException(409, 'CONFLICT', message, [{ field, message }]);
  }
}

export type { AuthTokenKind };
