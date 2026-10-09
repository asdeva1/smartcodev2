import { Injectable } from '@nestjs/common';
import {
  type ActivityLogPage,
  type ActivityLogQuery,
  type AuditLogPage,
  type AuditLogQuery,
  scopeFor,
} from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { addDays, zonedDayStart } from '../projects/zoned-time';

const actorSelect = { select: { id: true, fullName: true, role: true } } as const;

/**
 * Audit log (security and business trail, Manager only) and Activity log (human-readable timeline). The activity log
 * is limited to what the caller's scope covers: everyone, a vendor's people, a team, the projects they work on, or
 * only themselves. A person never sees activity outside their scope.
 */
@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  private async period(principal: Principal, from?: string, to?: string) {
    if (!from && !to) return undefined;
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
      select: { timeZone: true },
    });
    return {
      ...(from ? { gte: zonedDayStart(from, org.timeZone) } : {}),
      ...(to ? { lt: zonedDayStart(addDays(to, 1), org.timeZone) } : {}),
    };
  }

  async audit(principal: Principal, q: AuditLogQuery): Promise<AuditLogPage> {
    const db = this.prisma.client;
    const createdAt = await this.period(principal, q.from, q.to);
    const where: Prisma.AuditLogWhereInput = {
      organizationId: principal.organizationId,
      ...(q.action ? { action: { startsWith: q.action.toUpperCase() } } : {}),
      ...(q.entityType ? { entityType: { equals: q.entityType, mode: 'insensitive' } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, rows] = await db.$transaction([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: actorSelect },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        outcome: r.outcome,
        actor: r.actor ? { id: r.actor.id, fullName: r.actor.fullName, role: r.actor.role } : null,
        ipAddress: r.ipAddress,
        requestId: r.requestId,
        before: r.beforeData,
        after: r.afterData,
        createdAt: r.createdAt.toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  /** Who the caller may see activity from, as a filter on the acting employee. */
  private async actorScope(principal: Principal): Promise<Prisma.ActivityLogWhereInput> {
    const scope = scopeFor(principal.role, 'activityLog.read');
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    const db = this.prisma.client;
    const org = { organizationId: principal.organizationId };
    if (scope === 'ORG') return org;
    if (scope === 'VENDOR') {
      return principal.vendorId
        ? { ...org, actor: { is: { vendorId: principal.vendorId } } }
        : { id: { in: [] } };
    }
    if (scope === 'TEAM') {
      const members = await db.teamMembership.findMany({
        where: { endedAt: null, team: { teamLeadId: principal.employeeId } },
        select: { employeeId: true },
      });
      return { ...org, actorId: { in: [principal.employeeId, ...members.map((m) => m.employeeId)] } };
    }
    if (scope === 'PROJECT') {
      const mine = await db.projectAssignment.findMany({
        where: { employeeId: principal.employeeId, endedAt: null },
        select: { projectId: true },
      });
      const people = await db.projectAssignment.findMany({
        where: { projectId: { in: mine.map((m) => m.projectId) }, endedAt: null },
        select: { employeeId: true },
      });
      return {
        ...org,
        actorId: { in: [...new Set([principal.employeeId, ...people.map((p) => p.employeeId)])] },
      };
    }
    return { ...org, actorId: principal.employeeId };
  }

  async activity(principal: Principal, q: ActivityLogQuery): Promise<ActivityLogPage> {
    const db = this.prisma.client;
    const createdAt = await this.period(principal, q.from, q.to);
    const where: Prisma.ActivityLogWhereInput = {
      AND: [
        await this.actorScope(principal),
        ...(q.action ? [{ action: { startsWith: q.action.toUpperCase() } }] : []),
        ...(createdAt ? [{ createdAt }] : []),
      ],
    };
    const [total, rows] = await db.$transaction([
      db.activityLog.count({ where }),
      db.activityLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: actorSelect },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: r.actor ? { id: r.actor.id, fullName: r.actor.fullName, role: r.actor.role } : null,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}
