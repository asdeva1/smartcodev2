import { Injectable } from '@nestjs/common';
import {
  type ClientOption,
  type Page,
  type ProjectChartRecord,
  type ProjectChartsQuery,
  type ProjectCreate,
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectListRecord,
  type ProjectMemberAdd,
  type ProjectMemberRecord,
  type ProjectUpdate,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { logEntityChange } from '../organization/entity-log';
import { projectScopeWhere } from './project-scope';
import { syncProjectTeamStaff } from './project-team-sync';

const LIST_INCLUDE = {
  client: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  assignments: {
    where: { endedAt: null },
    select: { projectRole: true, startedAt: true, employee: { select: { id: true, fullName: true } } },
    orderBy: { startedAt: 'asc' },
  },
  _count: { select: { charts: true } },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof LIST_INCLUDE }>;

export const OPEN_CHART_STATUSES = ['ALLOCATED', 'IN_PRODUCTION'] as const;

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Project not found');

function toListRecord(p: ProjectRow): ProjectListRecord {
  const lead = p.assignments.find((a) => a.projectRole === 'TEAM_LEAD');
  return {
    id: p.id,
    name: p.name,
    client: p.client,
    allocationType: p.allocationType,
    status: p.status,
    vendor: p.vendor,
    team: p.team,
    lead: lead ? { id: lead.employee.id, fullName: lead.employee.fullName } : null,
    memberCount: p.assignments.filter((a) => a.projectRole !== 'TEAM_LEAD').length,
    chartCount: p._count.charts,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * Clients and Projects. A Manager creates projects (Client Name + Project + Allocation Type) and staffs them; every
 * other role only reads the projects it works on. Allocation Type is MANUAL (allocation file) or AUTOMATIC
 * (allocated by the engine, no file allocation).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  private log(
    tx: Tx,
    principal: Principal,
    meta: RequestMeta,
    action: Parameters<typeof logEntityChange>[4],
    entity: { type: string; id: string },
    detail: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
  ) {
    return logEntityChange(
      { audit: this.audit, activity: this.activity },
      tx,
      principal,
      meta,
      action,
      entity,
      detail,
    );
  }

  // ───────── reads ─────────

  async clients(principal: Principal): Promise<ClientOption[]> {
    projectScopeWhere(principal); // permission check (project.read)
    const projectFilter = projectScopeWhere(principal);
    const rows = await this.prisma.client.client.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(principal.role === 'MANAGER' ? {} : { projects: { some: projectFilter } }),
      },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows;
  }

  async list(principal: Principal, query: ProjectListQuery): Promise<Page<ProjectListRecord>> {
    const filters: Prisma.ProjectWhereInput[] = [projectScopeWhere(principal)];
    if (query.allocationType) filters.push({ allocationType: query.allocationType });
    if (query.status) filters.push({ status: query.status });
    if (query.clientId) filters.push({ clientId: query.clientId });
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      filters.push({ OR: [{ name: contains }, { client: { name: contains } }] });
    }
    const where: Prisma.ProjectWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.project.count({ where }),
      this.prisma.client.project.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toListRecord), page: query.page, pageSize: query.pageSize, total };
  }

  /** The project row if the caller may see it; otherwise 404. */
  async load(principal: Principal, id: string): Promise<ProjectRow> {
    const found = await this.prisma.client.project.findFirst({
      where: { AND: [{ id }, projectScopeWhere(principal)] },
      include: LIST_INCLUDE,
    });
    if (!found) throw notFound();
    return found;
  }

  async get(principal: Principal, id: string): Promise<ProjectDetail> {
    const project = await this.load(principal, id);
    const [staff, open, byStatus, submitted, working, meta] = await Promise.all([
      this.prisma.client.projectAssignment.findMany({
        where: { projectId: id, endedAt: null },
        orderBy: { startedAt: 'asc' },
        select: {
          projectRole: true,
          viaTeamId: true,
          startedAt: true,
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              email: true,
              loginNameAssignments: {
                where: { endedAt: null },
                take: 1,
                select: { loginName: { select: { value: true } } },
              },
            },
          },
        },
      }),
      this.prisma.client.chartAllocation.groupBy({
        by: ['employeeId'],
        where: { status: 'ACTIVE', chart: { projectId: id, status: { in: [...OPEN_CHART_STATUSES] } } },
        _count: { _all: true },
      }),
      this.prisma.client.chart.groupBy({ by: ['status'], where: { projectId: id }, _count: { _all: true } }),
      this.prisma.client.chart.count({ where: { projectId: id, submittedToClientAt: { not: null } } }),
      this.prisma.client.chartAllocation.groupBy({
        by: ['employeeId'],
        where: { status: 'ACTIVE', chart: { projectId: id, status: 'IN_PRODUCTION' } },
      }),
      this.prisma.client.project.findUniqueOrThrow({ where: { id }, select: { clientPullbackAt: true } }),
    ]);
    const openByEmployee = new Map(open.map((o) => [o.employeeId, o._count._all]));
    const members: ProjectMemberRecord[] = staff
      .filter((s) => s.projectRole !== 'TEAM_LEAD')
      .map((s) => ({
        employeeId: s.employee.id,
        employeeCode: s.employee.employeeCode,
        fullName: s.employee.fullName,
        email: s.employee.email,
        projectRole: s.projectRole,
        viaTeam: s.viaTeamId !== null,
        loginName: s.employee.loginNameAssignments[0]?.loginName.value ?? null,
        openCharts: openByEmployee.get(s.employee.id) ?? 0,
        startedAt: s.startedAt.toISOString(),
      }));
    return {
      ...toListRecord(project),
      members,
      workingNow: working.length,
      chartsByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      submittedToClient: submitted,
      clientPullbackAt: meta.clientPullbackAt?.toISOString() ?? null,
      legacyStaffCount: staff.filter((s) => s.viaTeamId === null && s.projectRole !== 'AUDITOR').length,
    };
  }

  async charts(
    principal: Principal,
    id: string,
    query: ProjectChartsQuery,
  ): Promise<Page<ProjectChartRecord>> {
    await this.load(principal, id);
    const filters: Prisma.ChartWhereInput[] = [{ projectId: id }];
    if (query.status) filters.push({ status: query.status as never });
    if (query.q) filters.push({ chartRef: { contains: query.q, mode: 'insensitive' } });
    // A coder only ever sees their own charts of the project.
    if (principal.role === 'CODER') {
      filters.push({ allocations: { some: { status: 'ACTIVE', employeeId: principal.employeeId } } });
    }
    const where: Prisma.ChartWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.chart.count({ where }),
      this.prisma.client.chart.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          allocations: {
            where: { status: 'ACTIVE' },
            take: 1,
            include: {
              loginName: { select: { value: true } },
              employee: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((c) => {
        const a = c.allocations[0];
        return {
          id: c.id,
          chartId: c.chartRef,
          status: c.status,
          pages: c.pages,
          pageBucket: c.pageBucket,
          remarks: c.remarks,
          heldAt: c.heldAt?.toISOString() ?? null,
          holdReason: c.holdReason,
          allocation: a
            ? {
                loginName: a.loginName.value,
                assignedTo: a.employee,
                allocatedAt: a.allocatedAt.toISOString(),
              }
            : null,
          submittedToClientAt: c.submittedToClientAt?.toISOString() ?? null,
          updatedAt: c.updatedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  // ───────── create / update (Manager) ─────────

  async create(principal: Principal, input: ProjectCreate, meta: RequestMeta): Promise<ProjectDetail> {
    const organizationId = principal.organizationId;
    let vendorId = input.vendorId ?? null;
    if (input.teamId) {
      const team = await this.assertTeamUsable(organizationId, input.teamId, vendorId, !input.vendorId);
      vendorId = team.vendorId;
    }
    if (vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: vendorId, organizationId },
        select: { status: true },
      });
      if (!vendor) throw new ProblemException(404, 'NOT_FOUND', 'Vendor not found');
      if (vendor.status !== 'ACTIVE') {
        throw new ProblemException(409, 'CONFLICT', 'This vendor is inactive and cannot receive a project');
      }
    }
    if (input.leadId) await this.assertLeadEligible(organizationId, input.leadId, vendorId);

    const id = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'project created' },
      async (tx) => {
        let client = await tx.client.findFirst({
          where: { organizationId, name: { equals: input.clientName, mode: 'insensitive' } },
        });
        if (client && client.status !== 'ACTIVE') {
          throw new ProblemException(409, 'CONFLICT', `Client "${client.name}" is inactive`);
        }
        if (!client) {
          client = await tx.client.create({ data: { organizationId, name: input.clientName } });
          await this.log(
            tx,
            principal,
            meta,
            'CLIENT.CREATED',
            { type: 'Client', id: client.id },
            {
              after: { name: client.name },
            },
          );
        }
        const clash = await tx.project.findFirst({
          where: { organizationId, clientId: client.id, name: { equals: input.name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (clash) {
          throw new ProblemException(
            409,
            'CONFLICT',
            `${client.name} already has a project named "${input.name}"`,
            [{ field: 'name', message: 'A project with this name already exists for this client' }],
          );
        }
        const project = await tx.project.create({
          data: {
            organizationId,
            clientId: client.id,
            name: input.name,
            allocationType: input.allocationType,
            vendorId,
            ...(input.teamId ? { teamId: input.teamId, teamAssignedById: principal.employeeId } : {}),
          },
        });
        if (input.teamId) {
          const synced = await syncProjectTeamStaff(tx, project.id, principal.employeeId);
          await this.log(
            tx,
            principal,
            meta,
            'PROJECT.TEAM_ASSIGNED',
            { type: 'Project', id: project.id },
            { before: { teamId: null }, after: { teamId: input.teamId, staffAdded: synced.added } },
          );
        }
        if (input.leadId) {
          await tx.projectAssignment.create({
            data: {
              projectId: project.id,
              employeeId: input.leadId,
              projectRole: 'TEAM_LEAD',
              assignedById: principal.employeeId,
            },
          });
        }
        await this.log(
          tx,
          principal,
          meta,
          'PROJECT.CREATED',
          { type: 'Project', id: project.id },
          {
            after: {
              client: client.name,
              name: project.name,
              allocationType: project.allocationType,
              vendorId: project.vendorId,
              teamId: input.teamId ?? null,
              leadId: input.leadId ?? null,
            },
          },
        );
        return project.id;
      },
    );
    return this.get(principal, id);
  }

  async update(
    principal: Principal,
    id: string,
    input: ProjectUpdate,
    meta: RequestMeta,
  ): Promise<ProjectDetail> {
    const current = await this.load(principal, id);
    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      const clash = await this.prisma.client.project.findFirst({
        where: {
          clientId: current.client.id,
          id: { not: id },
          name: { equals: input.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ProblemException(409, 'CONFLICT', 'This client already has a project with this name', [
          { field: 'name', message: 'A project with this name already exists for this client' },
        ]);
      }
    }
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'project updated' },
      async (tx) => {
        await tx.project.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        await this.log(
          tx,
          principal,
          meta,
          'PROJECT.UPDATED',
          { type: 'Project', id },
          {
            before: { name: current.name, status: current.status },
            after: { name: input.name ?? current.name, status: input.status ?? current.status },
          },
        );
      },
    );
    return this.get(principal, id);
  }

  // ───────── staffing (Manager) ─────────

  private async assertLeadEligible(organizationId: string, employeeId: string, vendorId: string | null) {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: { role: true, status: true, vendorId: true },
    });
    if (!employee) throw new ProblemException(404, 'NOT_FOUND', 'Employee not found');
    if (employee.role !== 'TEAM_LEAD') {
      throw new ProblemException(422, 'PROJECT_STAFF_INELIGIBLE', 'The Project Lead must be a Team Lead', [
        { field: 'leadId', message: 'Choose an employee with the Team Lead role' },
      ]);
    }
    if (employee.status === 'INACTIVE') {
      throw new ProblemException(422, 'PROJECT_STAFF_INELIGIBLE', 'This employee is inactive');
    }
    if (employee.vendorId && employee.vendorId !== vendorId) {
      throw new ProblemException(
        422,
        'PROJECT_STAFF_INELIGIBLE',
        'Vendor staff can only lead projects of their own vendor',
      );
    }
  }

  /** The team must be active, in this organization and belong to the project's vendor (or both be in-house). */
  private async assertTeamUsable(
    organizationId: string,
    teamId: string,
    projectVendorId: string | null,
    adoptVendor = false,
  ) {
    const team = await this.prisma.client.team.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true, status: true, vendorId: true },
    });
    if (!team) throw new ProblemException(404, 'NOT_FOUND', 'Team not found');
    if (team.status !== 'ACTIVE') {
      throw new ProblemException(422, 'PROJECT_STAFF_INELIGIBLE', 'This team is not active', [
        { field: 'teamId', message: 'Choose an active team' },
      ]);
    }
    if (!adoptVendor && team.vendorId !== projectVendorId) {
      throw new ProblemException(
        422,
        'PROJECT_STAFF_INELIGIBLE',
        "The team must belong to the project's vendor (or both must be in-house)",
        [{ field: 'teamId', message: "Choose a team from the project's vendor" }],
      );
    }
    return team;
  }

  /** Assigns the project's team (or clears it). The team's people become the project's staff. */
  async setTeam(
    principal: Principal,
    id: string,
    teamId: string | null,
    meta: RequestMeta,
  ): Promise<ProjectDetail> {
    const project = await this.load(principal, id);
    if (teamId) await this.assertTeamUsable(principal.organizationId, teamId, project.vendor?.id ?? null);
    if ((project.team?.id ?? null) !== teamId) {
      await this.prisma.transaction({ actorId: principal.employeeId, reason: 'project team' }, async (tx) => {
        await tx.project.update({
          where: { id },
          data: { teamId, teamAssignedById: teamId ? principal.employeeId : null },
        });
        const synced = await syncProjectTeamStaff(tx, id, principal.employeeId);
        await this.log(
          tx,
          principal,
          meta,
          'PROJECT.TEAM_ASSIGNED',
          { type: 'Project', id },
          {
            before: { teamId: project.team?.id ?? null },
            after: { teamId, staffAdded: synced.added, staffEnded: synced.ended },
          },
        );
      });
    }
    return this.get(principal, id);
  }

  async setLead(
    principal: Principal,
    id: string,
    employeeId: string | null,
    meta: RequestMeta,
  ): Promise<ProjectDetail> {
    const project = await this.load(principal, id);
    if (project.team) {
      throw new ProblemException(
        409,
        'CONFLICT',
        "This project's lead is the Team Lead of its team. Change the team's Team Lead instead.",
      );
    }
    if (employeeId)
      await this.assertLeadEligible(principal.organizationId, employeeId, project.vendor?.id ?? null);
    const currentLead = project.assignments.find((a) => a.projectRole === 'TEAM_LEAD');
    if ((currentLead?.employee.id ?? null) !== employeeId) {
      await this.prisma.transaction({ actorId: principal.employeeId, reason: 'project lead' }, async (tx) => {
        await tx.projectAssignment.updateMany({
          where: { projectId: id, projectRole: 'TEAM_LEAD', endedAt: null },
          data: { endedAt: new Date() },
        });
        if (employeeId) {
          await tx.projectAssignment.create({
            data: { projectId: id, employeeId, projectRole: 'TEAM_LEAD', assignedById: principal.employeeId },
          });
        }
        await this.log(
          tx,
          principal,
          meta,
          'PROJECT.LEAD_CHANGED',
          { type: 'Project', id },
          {
            before: { leadId: currentLead?.employee.id ?? null },
            after: { leadId: employeeId },
          },
        );
      });
    }
    return this.get(principal, id);
  }

  async addMember(
    principal: Principal,
    id: string,
    input: ProjectMemberAdd,
    meta: RequestMeta,
  ): Promise<ProjectDetail> {
    const project = await this.load(principal, id);
    if (project.team && input.projectRole !== 'AUDITOR') {
      throw new ProblemException(
        409,
        'CONFLICT',
        `Coders and Group Coaches join this project through its team (${project.team.name}). Add them to the team.`,
      );
    }
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: input.employeeId, organizationId: principal.organizationId },
      select: { role: true, status: true },
    });
    if (!employee) throw new ProblemException(404, 'NOT_FOUND', 'Employee not found');
    if (employee.role !== input.projectRole) {
      throw new ProblemException(
        422,
        'PROJECT_STAFF_INELIGIBLE',
        `This employee's role is ${employee.role}; add them to the project as ${employee.role}`,
      );
    }
    const existing = await this.prisma.client.projectAssignment.findFirst({
      where: { projectId: id, employeeId: input.employeeId, endedAt: null },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'project staffed' },
        async (tx) => {
          await tx.projectAssignment.create({
            data: {
              projectId: id,
              employeeId: input.employeeId,
              projectRole: input.projectRole,
              assignedById: principal.employeeId,
            },
          });
          await this.log(
            tx,
            principal,
            meta,
            'PROJECT.STAFF_ASSIGNED',
            { type: 'Project', id },
            {
              after: { employeeId: input.employeeId, projectRole: input.projectRole },
            },
          );
        },
      );
    }
    return this.get(principal, id);
  }

  async removeMember(
    principal: Principal,
    id: string,
    employeeId: string,
    meta: RequestMeta,
  ): Promise<ProjectDetail> {
    await this.load(principal, id);
    const assignment = await this.prisma.client.projectAssignment.findFirst({
      where: { projectId: id, employeeId, endedAt: null, projectRole: { not: 'TEAM_LEAD' } },
      select: { id: true, projectRole: true, viaTeamId: true },
    });
    if (!assignment)
      throw new ProblemException(404, 'NOT_FOUND', 'This employee is not a member of the project');
    if (assignment.viaTeamId) {
      throw new ProblemException(
        409,
        'CONFLICT',
        'This person is on the project through its team. Remove them from the team instead.',
      );
    }
    const open = await this.prisma.client.chartAllocation.count({
      where: { employeeId, status: 'ACTIVE', chart: { projectId: id } },
    });
    if (open > 0) {
      throw new ProblemException(
        409,
        'CONFLICT',
        `This member still holds ${open} chart${open === 1 ? '' : 's'}. Pull them back first.`,
      );
    }
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'project staff removed' },
      async (tx) => {
        await tx.projectAssignment.update({ where: { id: assignment.id }, data: { endedAt: new Date() } });
        await this.log(
          tx,
          principal,
          meta,
          'PROJECT.STAFF_REMOVED',
          { type: 'Project', id },
          {
            after: { employeeId, projectRole: assignment.projectRole },
          },
        );
      },
    );
    return this.get(principal, id);
  }
}
