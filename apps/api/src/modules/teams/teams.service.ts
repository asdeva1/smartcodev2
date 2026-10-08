import { Injectable } from '@nestjs/common';
import {
  type Page,
  type Scope,
  type TeamCreate,
  type TeamDetail,
  type TeamListQuery,
  type TeamRecord,
  type TeamUpdate,
  scopeFor,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { isUniqueViolation, logEntityChange } from '../organization/entity-log';

const TEAM_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  teamLead: { select: { id: true, fullName: true } },
  _count: { select: { memberships: { where: { endedAt: null } } } },
} satisfies Prisma.TeamInclude;

type TeamWithRelations = Prisma.TeamGetPayload<{ include: typeof TEAM_INCLUDE }>;

function toRecord(t: TeamWithRelations): TeamRecord {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    vendor: t.vendor,
    teamLead: t.teamLead,
    memberCount: t._count.memberships,
    createdAt: t.createdAt.toISOString(),
  };
}

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Team not found');

/**
 * Team management. A Manager manages every team; a Vendor Admin manages only their own vendor's teams.
 * Team Leads and Coders read only their own team. Anything outside the caller's scope is "not found".
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  // ───────── scope ─────────

  private scopeOf(principal: Principal, permission: 'team.read' | 'team.manage'): Scope {
    const scope = scopeFor(principal.role, permission);
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    return scope;
  }

  private scopeWhere(principal: Principal, scope: Scope): Prisma.TeamWhereInput {
    const org: Prisma.TeamWhereInput = { organizationId: principal.organizationId };
    const vendor: Prisma.TeamWhereInput = principal.vendorId ? { vendorId: principal.vendorId } : {};
    switch (scope) {
      case 'ORG':
        return { AND: [org, vendor] };
      case 'VENDOR':
        return principal.vendorId ? { AND: [org, vendor] } : { id: { in: [] } };
      case 'TEAM':
        return {
          AND: [
            org,
            vendor,
            {
              OR: [
                { teamLeadId: principal.employeeId },
                { memberships: { some: { employeeId: principal.employeeId, endedAt: null } } },
              ],
            },
          ],
        };
      case 'SELF':
        return {
          AND: [org, { memberships: { some: { employeeId: principal.employeeId, endedAt: null } } }],
        };
      case 'PROJECT':
        // Group Coach team visibility follows project staffing, which arrives in Phase 5. Until then: none.
        return { id: { in: [] } };
    }
  }

  // ───────── reads ─────────

  async list(principal: Principal, query: TeamListQuery): Promise<Page<TeamRecord>> {
    const scope = this.scopeOf(principal, 'team.read');
    const filters: Prisma.TeamWhereInput[] = [this.scopeWhere(principal, scope)];
    if (query.status) filters.push({ status: query.status });
    if (query.vendorId) filters.push({ vendorId: query.vendorId });
    if (query.q) filters.push({ name: { contains: query.q, mode: 'insensitive' } });
    const where: Prisma.TeamWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.team.count({ where }),
      this.prisma.client.team.findMany({
        where,
        include: TEAM_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toRecord), page: query.page, pageSize: query.pageSize, total };
  }

  async get(principal: Principal, id: string): Promise<TeamDetail> {
    const scope = this.scopeOf(principal, 'team.read');
    const team = await this.prisma.client.team.findFirst({
      where: { AND: [{ id }, this.scopeWhere(principal, scope)] },
      include: TEAM_INCLUDE,
    });
    if (!team) throw notFound();
    const memberships = await this.prisma.client.teamMembership.findMany({
      where: { teamId: id, endedAt: null },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true, role: true, status: true } },
      },
      orderBy: { startedAt: 'asc' },
    });
    return {
      ...toRecord(team),
      members: memberships.map((m) => ({
        id: m.employee.id,
        employeeCode: m.employee.employeeCode,
        fullName: m.employee.fullName,
        role: m.employee.role,
        status: m.employee.status,
        joinedAt: m.startedAt.toISOString(),
      })),
    };
  }

  /** A team the caller may change (Manager: any; Vendor Admin: own vendor), or 404. */
  private async loadManaged(principal: Principal, id: string): Promise<TeamWithRelations> {
    const scope = this.scopeOf(principal, 'team.manage');
    const team = await this.prisma.client.team.findFirst({
      where: { AND: [{ id }, this.scopeWhere(principal, scope)] },
      include: TEAM_INCLUDE,
    });
    if (!team) throw notFound();
    return team;
  }

  // ───────── create / update ─────────

  async create(principal: Principal, input: TeamCreate, meta: RequestMeta): Promise<TeamDetail> {
    const scope = this.scopeOf(principal, 'team.manage');
    let vendorId: string | null;
    if (scope === 'VENDOR') {
      if (!principal.vendorId)
        throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      if (input.vendorId && input.vendorId !== principal.vendorId)
        throw new ProblemException(404, 'NOT_FOUND', 'Vendor not found');
      vendorId = principal.vendorId;
    } else {
      vendorId = input.vendorId ?? null;
    }
    if (vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: vendorId, organizationId: principal.organizationId },
        select: { status: true },
      });
      if (!vendor) throw this.invalid('vendorId', 'Vendor not found');
      if (vendor.status !== 'ACTIVE') throw this.invalid('vendorId', 'That vendor is not active');
    }
    await this.assertNameFree(principal.organizationId, vendorId, input.name);

    let id: string;
    try {
      id = await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'team created' },
        async (tx) => {
          const team = await tx.team.create({
            data: {
              organizationId: principal.organizationId,
              vendorId,
              name: input.name,
              ...(input.teamLeadId ? { teamLeadId: input.teamLeadId } : {}),
            },
            select: { id: true },
          });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'TEAM.CREATED',
            { type: 'Team', id: team.id },
            {
              after: { name: input.name, vendorId, teamLeadId: input.teamLeadId ?? null },
            },
          );
          return team.id;
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw this.conflict('name', 'A team with this name already exists here');
      throw error;
    }
    return this.get(principal, id);
  }

  async update(principal: Principal, id: string, input: TeamUpdate, meta: RequestMeta): Promise<TeamDetail> {
    const current = await this.loadManaged(principal, id);
    if (current.status === 'INACTIVE') throw this.invalid('status', 'This team is not active');
    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameFree(principal.organizationId, current.vendorId, input.name, id);
    }
    try {
      await this.prisma.transaction({ actorId: principal.employeeId, reason: 'team updated' }, async (tx) => {
        await tx.team.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.teamLeadId !== undefined ? { teamLeadId: input.teamLeadId } : {}),
          },
        });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'TEAM.UPDATED',
          { type: 'Team', id },
          {
            before: { name: current.name, teamLeadId: current.teamLead?.id ?? null },
            after: {
              name: input.name ?? current.name,
              teamLeadId: input.teamLeadId === undefined ? (current.teamLead?.id ?? null) : input.teamLeadId,
            },
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.conflict('name', 'A team with this name already exists here');
      throw error;
    }
    return this.get(principal, id);
  }

  // ───────── status ─────────

  async deactivate(principal: Principal, id: string, meta: RequestMeta): Promise<TeamDetail> {
    const current = await this.loadManaged(principal, id);
    if (current.status === 'INACTIVE') return this.get(principal, id);
    if (current._count.memberships > 0) {
      throw new ProblemException(
        409,
        'CONFLICT',
        'Move or remove the team members before deactivating the team',
      );
    }
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'team deactivated' },
      async (tx) => {
        await tx.team.update({ where: { id }, data: { status: 'INACTIVE', teamLeadId: null } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'TEAM.DEACTIVATED',
          { type: 'Team', id },
        );
      },
    );
    return this.get(principal, id);
  }

  async reactivate(principal: Principal, id: string, meta: RequestMeta): Promise<TeamDetail> {
    const current = await this.loadManaged(principal, id);
    if (current.status === 'ACTIVE') return this.get(principal, id);
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'team reactivated' },
      async (tx) => {
        await tx.team.update({ where: { id }, data: { status: 'ACTIVE' } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'TEAM.REACTIVATED',
          { type: 'Team', id },
        );
      },
    );
    return this.get(principal, id);
  }

  // ───────── membership ─────────

  /** Adds an employee to the team. If they are in another team they move (the earlier membership is ended). */
  async addMember(
    principal: Principal,
    id: string,
    employeeId: string,
    meta: RequestMeta,
  ): Promise<TeamDetail> {
    const team = await this.loadManaged(principal, id);
    if (team.status !== 'ACTIVE') throw this.invalid('teamId', 'That team is not active');
    const employee = await this.prisma.client.employee.findFirst({
      where: {
        id: employeeId,
        organizationId: principal.organizationId,
        vendorId: team.vendor?.id ?? null,
      },
      select: { id: true, status: true },
    });
    if (!employee) throw this.invalid('employeeId', 'Employee not found for this team');
    if (employee.status === 'INACTIVE')
      throw this.invalid('employeeId', 'An inactive employee cannot join a team');

    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'team member added' },
      async (tx) => {
        const current = await tx.teamMembership.findFirst({ where: { employeeId, endedAt: null } });
        if (current?.teamId === id) return;
        if (current) {
          await tx.teamMembership.update({ where: { id: current.id }, data: { endedAt: new Date() } });
        }
        await tx.teamMembership.create({
          data: { teamId: id, employeeId, createdById: principal.employeeId },
        });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'TEAM.MEMBER_ADDED',
          { type: 'Team', id },
          {
            after: { employeeId, movedFromTeamId: current?.teamId ?? null },
          },
        );
      },
    );
    return this.get(principal, id);
  }

  async removeMember(
    principal: Principal,
    id: string,
    employeeId: string,
    meta: RequestMeta,
  ): Promise<TeamDetail> {
    await this.loadManaged(principal, id);
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'team member removed' },
      async (tx) => {
        const current = await tx.teamMembership.findFirst({
          where: { teamId: id, employeeId, endedAt: null },
        });
        if (!current)
          throw new ProblemException(404, 'NOT_FOUND', 'That employee is not a member of this team');
        await tx.teamMembership.update({ where: { id: current.id }, data: { endedAt: new Date() } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'TEAM.MEMBER_REMOVED',
          { type: 'Team', id },
          {
            after: { employeeId },
          },
        );
      },
    );
    return this.get(principal, id);
  }

  // ───────── helpers ─────────

  private async assertNameFree(
    organizationId: string,
    vendorId: string | null,
    name: string,
    ignoreId?: string,
  ) {
    const found = await this.prisma.client.team.findFirst({
      where: {
        organizationId,
        vendorId,
        name: { equals: name, mode: 'insensitive' },
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (found) throw this.conflict('name', 'A team with this name already exists here');
  }

  private invalid(field: string, message: string) {
    return new ProblemException(422, 'VALIDATION_FAILED', message, [{ field, message }]);
  }

  private conflict(field: string, message: string) {
    return new ProblemException(409, 'CONFLICT', message, [{ field, message }]);
  }
}
