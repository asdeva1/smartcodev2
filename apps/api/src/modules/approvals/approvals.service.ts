import { Injectable } from '@nestjs/common';
import {
  type ApprovalCreate,
  type ApprovalDecision,
  type ApprovalListQuery,
  type ApprovalPage,
  type ApprovalRecord,
  type ApprovalType,
  APPROVAL_TYPE_LABELS,
  can,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { EmployeesService } from '../employees/employees.service';
import { LoginNamesService } from '../employees/login-names.service';
import { createNotification } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';

/** Who may ask for what. A Manager decides, so a Manager never asks. */
const REQUESTERS: Record<ApprovalType, readonly string[]> = {
  EMPLOYEE_DEACTIVATION: ['TEAM_LEAD', 'HR', 'VENDOR_ADMIN', 'GROUP_COACH'],
  LOGIN_NAME_CHANGE: ['TEAM_LEAD', 'HR', 'VENDOR_ADMIN', 'GROUP_COACH'],
  PROJECT_CLOSURE: ['TEAM_LEAD', 'VENDOR_ADMIN', 'GROUP_COACH'],
};

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Approval request not found');

type Row = Prisma.ApprovalRequestGetPayload<{
  include: {
    requester: { select: { id: true; fullName: true; role: true } };
    resolvedBy: { select: { id: true; fullName: true } };
  };
}>;
const INCLUDE = {
  requester: { select: { id: true, fullName: true, role: true } },
  resolvedBy: { select: { id: true, fullName: true } },
} as const;

/**
 * Universal approval engine: a request (what, about whom or what, why), one step decided by a Manager, and on approval
 * the change is carried out by the same service that does it directly, with the Manager as the actor, so every rule
 * and audit entry of the direct action still applies.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
    private readonly employees: EmployeesService,
    private readonly loginNames: LoginNamesService,
    private readonly projects: ProjectsService,
  ) {}

  private async toRecords(rows: Row[]): Promise<ApprovalRecord[]> {
    const db = this.prisma.client;
    const employeeIds = rows.filter((r) => r.entityType === 'Employee').map((r) => r.entityId);
    const projectIds = rows.filter((r) => r.entityType === 'Project').map((r) => r.entityId);
    const [people, projects] = await Promise.all([
      employeeIds.length
        ? db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, fullName: true } })
        : [],
      projectIds.length
        ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const names = new Map<string, string>([
      ...people.map((p) => [p.id, p.fullName] as [string, string]),
      ...projects.map((p) => [p.id, p.name] as [string, string]),
    ]);
    return rows.map((r) => {
      const payload = (r.payload ?? {}) as { reason?: string; loginName?: string };
      return {
        id: r.id,
        type: r.type as ApprovalType,
        status: r.status,
        subject: names.get(r.entityId) ?? 'Unknown',
        entityId: r.entityId,
        requester: { id: r.requester.id, fullName: r.requester.fullName, role: r.requester.role },
        request: { reason: payload.reason ?? null, loginName: payload.loginName ?? null },
        comments: r.comments,
        decisionComments: r.decisionComments,
        resolvedBy: r.resolvedBy,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  async list(principal: Principal, q: ApprovalListQuery): Promise<ApprovalPage> {
    const db = this.prisma.client;
    const sees = can(principal.role, 'approval.decide') && q.scope === 'all';
    const base: Prisma.ApprovalRequestWhereInput = {
      organizationId: principal.organizationId,
      type: { in: ['EMPLOYEE_DEACTIVATION', 'LOGIN_NAME_CHANGE', 'PROJECT_CLOSURE'] },
      ...(sees ? {} : { requesterId: principal.employeeId }),
    };
    const where = { ...base, ...(q.status ? { status: q.status } : {}) };
    const [total, pendingCount, rows] = await db.$transaction([
      db.approvalRequest.count({ where }),
      db.approvalRequest.count({ where: { ...base, status: 'PENDING' } }),
      db.approvalRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: INCLUDE,
      }),
    ]);
    return { items: await this.toRecords(rows), page: q.page, pageSize: q.pageSize, total, pendingCount };
  }

  async create(principal: Principal, input: ApprovalCreate, meta: RequestMeta): Promise<ApprovalRecord> {
    if (!REQUESTERS[input.type].includes(principal.role)) {
      throw new ProblemException(
        403,
        'FORBIDDEN',
        principal.role === 'MANAGER'
          ? 'You can do this directly; it does not need approval'
          : 'You cannot ask for this',
      );
    }
    const db = this.prisma.client;
    const isProject = input.type === 'PROJECT_CLOSURE';
    // The requester must be able to see the person or project, with the same scope rules as everywhere else.
    if (isProject) {
      const project = await this.projects.load(principal, input.entityId);
      if (project.status === 'CLOSED')
        throw new ProblemException(409, 'CONFLICT', 'This project is already closed');
    } else {
      const person = await this.employees.get(principal, input.entityId);
      if (person.id === principal.employeeId) {
        throw new ProblemException(422, 'VALIDATION_FAILED', 'You cannot ask for this about yourself');
      }
      if (input.type === 'EMPLOYEE_DEACTIVATION' && person.status !== 'ACTIVE') {
        throw new ProblemException(409, 'CONFLICT', 'This person is not active');
      }
    }
    const pending = await db.approvalRequest.findFirst({
      where: { type: input.type, entityId: input.entityId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      throw new ProblemException(409, 'CONFLICT', 'There is already a pending request for this');
    }
    const managers = await db.employee.findMany({
      where: { organizationId: principal.organizationId, role: 'MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    const payload = {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.loginName ? { loginName: input.loginName } : {}),
    };
    const created = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Approval requested' },
      async (tx) => {
        const row = await tx.approvalRequest.create({
          data: {
            organizationId: principal.organizationId,
            type: input.type,
            entityType: isProject ? 'Project' : 'Employee',
            entityId: input.entityId,
            requesterId: principal.employeeId,
            comments: input.comments ?? null,
            payload,
            steps: { create: { stepOrder: 1, approverRole: 'MANAGER' } },
          },
          include: INCLUDE,
        });
        for (const m of managers) {
          await createNotification(tx, {
            organizationId: principal.organizationId,
            recipientId: m.id,
            type: 'APPROVAL_REQUESTED',
            subject: `Approval needed: ${APPROVAL_TYPE_LABELS[input.type]}`,
            message: `${row.requester.fullName} asked for this. Open Approvals to decide.`,
            entityType: 'ApprovalRequest',
            entityId: row.id,
          });
        }
        await this.audit.record(
          {
            organizationId: principal.organizationId,
            actorId: principal.employeeId,
            actorRole: principal.role,
            action: 'APPROVAL.REQUESTED',
            entityType: 'ApprovalRequest',
            entityId: row.id,
            after: { type: input.type, entityId: input.entityId },
            ipAddress: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        await this.activity.record(
          {
            organizationId: principal.organizationId,
            actorId: principal.employeeId,
            action: 'APPROVAL.REQUESTED',
            entityType: 'ApprovalRequest',
            entityId: row.id,
            metadata: { type: input.type },
          },
          tx,
        );
        return row;
      },
    );
    return (await this.toRecords([created]))[0]!;
  }

  async cancel(principal: Principal, id: string, meta: RequestMeta): Promise<ApprovalRecord> {
    const db = this.prisma.client;
    const found = await db.approvalRequest.findFirst({
      where: { id, requesterId: principal.employeeId, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!found) throw notFound();
    const row = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Approval cancelled' },
      async (tx) => {
        const moved = await tx.approvalRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'CANCELLED', resolvedAt: new Date() },
        });
        if (moved.count === 0)
          throw new ProblemException(409, 'CONFLICT', 'This request has already been decided');
        await tx.approvalStep.updateMany({
          where: { requestId: id, status: 'PENDING' },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });
        await this.audit.record(
          {
            organizationId: principal.organizationId,
            actorId: principal.employeeId,
            actorRole: principal.role,
            action: 'APPROVAL.CANCELLED',
            entityType: 'ApprovalRequest',
            entityId: id,
            ipAddress: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      },
    );
    return (await this.toRecords([row]))[0]!;
  }

  async decide(
    principal: Principal,
    id: string,
    input: ApprovalDecision,
    meta: RequestMeta,
  ): Promise<ApprovalRecord> {
    const db = this.prisma.client;
    const request = await db.approvalRequest.findFirst({
      where: {
        id,
        organizationId: principal.organizationId,
        type: { in: ['EMPLOYEE_DEACTIVATION', 'LOGIN_NAME_CHANGE', 'PROJECT_CLOSURE'] },
      },
      include: INCLUDE,
    });
    if (!request) throw notFound();
    if (request.status !== 'PENDING')
      throw new ProblemException(409, 'CONFLICT', 'This request has already been decided');
    const payload = (request.payload ?? {}) as { reason?: string; loginName?: string };

    const finish = (tx: Prisma.TransactionClient, status: 'APPROVED' | 'REJECTED') =>
      this.settle(tx, principal, meta, request, status, input.comments);

    if (input.decision === 'REJECTED') {
      const row = await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'Approval rejected' },
        (tx) => finish(tx, 'REJECTED'),
      );
      return (await this.toRecords([row]))[0]!;
    }

    // Do the work first, as the Manager. If it is refused (for example open work to confirm) the request stays
    // pending and nothing changes. The database allows a request to be decided only once, so a second Manager
    // deciding at the same moment is refused when the decision is recorded.
    await this.carryOut(
      principal,
      request.type as ApprovalType,
      request.entityId,
      payload,
      input.confirmOpenWork,
      meta,
    );
    const row = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Approval granted' },
      (tx) => finish(tx, 'APPROVED'),
    );
    return (await this.toRecords([row]))[0]!;
  }

  private async carryOut(
    manager: Principal,
    type: ApprovalType,
    entityId: string,
    payload: { reason?: string; loginName?: string },
    confirmOpenWork: boolean,
    meta: RequestMeta,
  ): Promise<void> {
    if (type === 'EMPLOYEE_DEACTIVATION') {
      await this.employees.deactivate(
        manager,
        entityId,
        { reason: payload.reason ?? 'Approved request', confirmOpenWork },
        meta,
      );
    } else if (type === 'LOGIN_NAME_CHANGE') {
      await this.loginNames.assign(manager, entityId, payload.loginName ?? '', meta);
    } else {
      await this.projects.update(manager, entityId, { status: 'CLOSED' }, meta);
    }
  }

  private async settle(
    tx: Prisma.TransactionClient,
    principal: Principal,
    meta: RequestMeta,
    request: Row,
    status: 'APPROVED' | 'REJECTED',
    comments: string | undefined,
  ): Promise<Row> {
    const now = new Date();
    const moved = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: {
        status,
        decision: status,
        decisionComments: comments ?? null,
        resolvedById: principal.employeeId,
        resolvedAt: now,
      },
    });
    if (moved.count === 0)
      throw new ProblemException(409, 'CONFLICT', 'This request has already been decided');
    await tx.approvalStep.updateMany({
      where: { requestId: request.id },
      data: { status, decidedById: principal.employeeId, comments: comments ?? null, decidedAt: now },
    });
    const label = APPROVAL_TYPE_LABELS[request.type as ApprovalType];
    await createNotification(tx, {
      organizationId: principal.organizationId,
      recipientId: request.requesterId,
      type: 'APPROVAL_DECIDED',
      subject: `${label}: ${status === 'APPROVED' ? 'approved' : 'rejected'}`,
      message: comments,
      entityType: 'ApprovalRequest',
      entityId: request.id,
    });
    await this.audit.record(
      {
        organizationId: principal.organizationId,
        actorId: principal.employeeId,
        actorRole: principal.role,
        action: status === 'APPROVED' ? 'APPROVAL.APPROVED' : 'APPROVAL.REJECTED',
        entityType: 'ApprovalRequest',
        entityId: request.id,
        after: { type: request.type, entityId: request.entityId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    await this.activity.record(
      {
        organizationId: principal.organizationId,
        actorId: principal.employeeId,
        action: status === 'APPROVED' ? 'APPROVAL.APPROVED' : 'APPROVAL.REJECTED',
        entityType: 'ApprovalRequest',
        entityId: request.id,
        metadata: { type: request.type },
      },
      tx,
    );
    return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include: INCLUDE });
  }
}
