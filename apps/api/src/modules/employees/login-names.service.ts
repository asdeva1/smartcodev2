import { Injectable } from '@nestjs/common';
import {
  type Page,
  type Role,
  LOGIN_NAME_ELIGIBLE_ROLES,
  isLoginNameEligibleRole,
  loginNameSchema,
  scopeFor,
} from '@smartcode/shared';
import { z } from 'zod';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { employeeScopeWhere } from './employee-scope';

export interface LoginNameRow {
  id: string;
  value: string;
  status: string;
  holder: {
    id: string;
    employeeCode: string;
    fullName: string;
    email: string;
    role: Role;
    status: string;
  } | null;
  assignedAt: string | null;
}

export interface AssignmentHistoryRow {
  loginName: string;
  assignedAt: string;
  endedAt: string | null;
  endReason: string | null;
  assignedBy: string;
}

export interface AssignOutcome {
  changed: boolean;
  loginName: string;
  previousLoginName: string | null;
}

/**
 * SmartClues Login Name management — Manager-only (`loginName.assign`). A Login Name is an operational identifier,
 * never an authentication identity. PostgreSQL enforces the same rules (eligible role, ACTIVE employee, one active
 * name per employee and per name); the checks here exist to give the Manager precise, actionable messages.
 */
@Injectable()
export class LoginNamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  // ───────── reads ─────────

  async list(
    principal: Principal,
    query: { page: number; pageSize: number; q?: string | undefined; assigned?: boolean | undefined },
  ): Promise<Page<LoginNameRow>> {
    const scope = scopeFor(principal.role, 'loginName.read');
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    const visibleHolder = employeeScopeWhere(principal, scope);
    const where: Prisma.LoginNameWhereInput = {
      organizationId: principal.organizationId,
      ...(scope === 'ORG' ? {} : { assignments: { some: { endedAt: null, employee: visibleHolder } } }),
      ...(query.q ? { value: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.assigned === true ? { assignments: { some: { endedAt: null } } } : {}),
      ...(query.assigned === false ? { assignments: { none: { endedAt: null } } } : {}),
    };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.loginName.count({ where }),
      this.prisma.client.loginName.findMany({
        where,
        orderBy: [{ value: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          assignments: {
            where: { endedAt: null },
            take: 1,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  fullName: true,
                  email: true,
                  role: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => {
        const open = row.assignments[0];
        return {
          id: row.id,
          value: row.value,
          status: row.status,
          holder: open ? { ...open.employee, role: open.employee.role as Role } : null,
          assignedAt: open?.assignedAt.toISOString() ?? null,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Assignment history of one employee (Login Name assignment history is visible to those who may read it). */
  async history(principal: Principal, employeeId: string): Promise<AssignmentHistoryRow[]> {
    const scope = scopeFor(principal.role, 'loginName.read');
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    const employee = await this.prisma.client.employee.findFirst({
      where: { AND: [{ id: employeeId }, employeeScopeWhere(principal, scope)] },
      select: { id: true },
    });
    if (!employee) throw new ProblemException(404, 'NOT_FOUND', 'Employee not found');
    const rows = await this.prisma.client.loginNameAssignment.findMany({
      where: { employeeId },
      orderBy: { assignedAt: 'desc' },
      include: { loginName: { select: { value: true } }, assignedBy: { select: { fullName: true } } },
    });
    return rows.map((r) => ({
      loginName: r.loginName.value,
      assignedAt: r.assignedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      endReason: r.endReason,
      assignedBy: r.assignedBy.fullName,
    }));
  }

  /** The employee a typed email address belongs to (Manager only), or a clear 404. */
  async employeeIdForEmail(principal: Principal, email: string): Promise<string> {
    const found = await this.prisma.client.employee.findFirst({
      where: { organizationId: principal.organizationId, email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!found) {
      throw new ProblemException(404, 'NOT_FOUND', 'No employee has this email address', [
        { field: 'email', message: 'No employee has this email address' },
      ]);
    }
    return found.id;
  }

  // ───────── assign / change ─────────

  /** Assigns a Login Name, or changes the employee's current one. Idempotent when nothing changes. */
  async assign(
    principal: Principal,
    employeeId: string,
    rawLoginName: string,
    meta: RequestMeta,
    existingTx?: Tx,
  ): Promise<AssignOutcome> {
    const value = loginNameSchema.parse(rawLoginName);
    const run = async (tx: Tx): Promise<AssignOutcome> => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, organizationId: principal.organizationId },
        include: { loginNameAssignments: { where: { endedAt: null }, include: { loginName: true } } },
      });
      if (!employee) throw new ProblemException(404, 'NOT_FOUND', 'Employee not found');
      this.assertEligible(employee);

      const current = employee.loginNameAssignments[0] ?? null;
      const existing = await tx.loginName.findFirst({
        where: { organizationId: principal.organizationId, value: { equals: value, mode: 'insensitive' } },
        include: {
          assignments: {
            where: { endedAt: null },
            include: { employee: { select: { id: true, employeeCode: true } } },
          },
        },
      });

      if (existing) {
        if (existing.status !== 'ACTIVE') {
          throw new ProblemException(
            409,
            'LOGIN_NAME_TAKEN',
            `Login Name "${existing.value}" is retired and cannot be assigned`,
          );
        }
        const holder = existing.assignments[0];
        if (holder && holder.employeeId === employee.id) {
          return { changed: false, loginName: existing.value, previousLoginName: existing.value };
        }
        if (holder) {
          throw new ProblemException(
            409,
            'LOGIN_NAME_TAKEN',
            `Login Name "${existing.value}" is already assigned to ${holder.employee.employeeCode}. Release it first if it should move.`,
          );
        }
      }

      if (current) await this.assertNoOpenAllocations(tx, employee.id, 'change the Login Name');

      if (current) {
        await tx.loginNameAssignment.update({
          where: { id: current.id },
          data: { endedAt: new Date(), endReason: 'REASSIGNED' },
        });
      }
      const loginName =
        existing ??
        (await tx.loginName.create({
          data: { organizationId: principal.organizationId, value, createdById: principal.employeeId },
          include: { assignments: { include: { employee: { select: { id: true, employeeCode: true } } } } },
        }));
      await tx.loginNameAssignment.create({
        data: { loginNameId: loginName.id, employeeId: employee.id, assignedById: principal.employeeId },
      });
      if (current) {
        await this.log(tx, principal, meta, 'LOGIN_NAME.ENDED', employee.id, {
          before: { loginName: current.loginName.value },
          after: { endReason: 'REASSIGNED' },
        });
      }
      await this.log(tx, principal, meta, 'LOGIN_NAME.ASSIGNED', employee.id, {
        before: { loginName: current?.loginName.value ?? null },
        after: { loginName: loginName.value },
      });
      return {
        changed: true,
        loginName: loginName.value,
        previousLoginName: current?.loginName.value ?? null,
      };
    };
    return existingTx
      ? run(existingTx)
      : this.prisma.transaction({ actorId: principal.employeeId, reason: 'login name assigned' }, run);
  }

  /** Ends the employee's active Login Name without assigning another. */
  async release(principal: Principal, employeeId: string, meta: RequestMeta): Promise<{ released: string }> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'login name released' },
      async (tx) => {
        const open = await tx.loginNameAssignment.findFirst({
          where: { employeeId, endedAt: null, employee: { organizationId: principal.organizationId } },
          include: { loginName: true },
        });
        if (!open) throw new ProblemException(404, 'NOT_FOUND', 'This employee has no active Login Name');
        await this.assertNoOpenAllocations(tx, employeeId, 'release the Login Name');
        await tx.loginNameAssignment.update({
          where: { id: open.id },
          data: { endedAt: new Date(), endReason: 'DEACTIVATED' },
        });
        await this.log(tx, principal, meta, 'LOGIN_NAME.ENDED', employeeId, {
          before: { loginName: open.loginName.value },
          after: { endReason: 'DEACTIVATED' },
        });
        return { released: open.loginName.value };
      },
    );
  }

  // ───────── rules ─────────

  /** The Phase 3 eligibility rule, with a message per reason. */
  assertEligible(employee: { status: string; role: string }): void {
    if (employee.status === 'PENDING_ACTIVATION') {
      throw new ProblemException(
        422,
        'LOGIN_NAME_INELIGIBLE',
        'This employee has not activated their account yet. Assign a Login Name after activation.',
      );
    }
    if (employee.status !== 'ACTIVE') {
      throw new ProblemException(
        422,
        'LOGIN_NAME_INELIGIBLE',
        'Only an active employee can receive a Login Name',
      );
    }
    if (!isLoginNameEligibleRole(employee.role as Role)) {
      throw new ProblemException(
        422,
        'LOGIN_NAME_INELIGIBLE',
        `The ${employee.role} role does not use a SmartClues Login Name (eligible: ${LOGIN_NAME_ELIGIBLE_ROLES.join(', ')})`,
      );
    }
  }

  private async assertNoOpenAllocations(tx: Tx, employeeId: string, action: string): Promise<void> {
    const open = await tx.chartAllocation.count({ where: { employeeId, status: 'ACTIVE' } });
    if (open > 0) {
      throw new ProblemException(
        409,
        'CONFLICT',
        `This employee still holds ${open} allocated chart(s). Reallocate them before you ${action}.`,
      );
    }
  }

  private async log(
    tx: Tx,
    principal: Principal,
    meta: RequestMeta,
    action: 'LOGIN_NAME.ASSIGNED' | 'LOGIN_NAME.ENDED',
    employeeId: string,
    detail: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
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
}

export const loginNameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => v || undefined),
  assigned: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
