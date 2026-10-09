import { Injectable } from '@nestjs/common';
import type {
  VisitBadge,
  VisitCreate,
  VisitListQuery,
  VisitPage,
  VisitRecord,
  VisitStatus,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { createNotification } from '../notifications/notifications.service';
import { isUniqueViolation, logEntityChange } from '../organization/entity-log';
import { addDays, dayKey, zonedDayStart } from '../projects/zoned-time';

const INCLUDE = {
  visitor: true,
  host: { select: { id: true, fullName: true } },
} as const;
type Row = Prisma.VisitGetPayload<{ include: typeof INCLUDE }>;

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Visit not found');

function toRecord(r: Row): VisitRecord {
  return {
    id: r.id,
    status: r.status as VisitStatus,
    visitor: {
      id: r.visitor.id,
      fullName: r.visitor.fullName,
      company: r.visitor.company,
      phone: r.visitor.phone,
      email: r.visitor.email,
    },
    host: r.host,
    purpose: r.purpose,
    expectedAt: r.expectedAt?.toISOString() ?? null,
    badgeNumber: r.badgeNumber,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Visitor Management: HR and the Manager register a visit, name the host, check the visitor in (which issues a badge
 * number and tells the host) and out. A visit is never deleted; a visit that will not happen is cancelled.
 */
@Injectable()
export class VisitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  private async timeZone(principal: Principal): Promise<string> {
    return (
      await this.prisma.client.organization.findUniqueOrThrow({
        where: { id: principal.organizationId },
        select: { timeZone: true },
      })
    ).timeZone;
  }

  async list(principal: Principal, q: VisitListQuery): Promise<VisitPage> {
    const db = this.prisma.client;
    const tz = await this.timeZone(principal);
    const base: Prisma.VisitWhereInput = { organizationId: principal.organizationId };
    const filters: Prisma.VisitWhereInput[] = [];
    if (q.date) {
      const gte = zonedDayStart(q.date, tz);
      const lt = zonedDayStart(addDays(q.date, 1), tz);
      filters.push({
        OR: [{ createdAt: { gte, lt } }, { expectedAt: { gte, lt } }, { checkedInAt: { gte, lt } }],
      });
    }
    if (q.q) {
      filters.push({
        OR: [
          { visitor: { is: { fullName: { contains: q.q, mode: 'insensitive' } } } },
          { visitor: { is: { company: { contains: q.q, mode: 'insensitive' } } } },
          { host: { is: { fullName: { contains: q.q, mode: 'insensitive' } } } },
          { badgeNumber: { contains: q.q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.VisitWhereInput = {
      ...base,
      ...(q.status ? { status: q.status } : {}),
      ...(filters.length ? { AND: filters } : {}),
    };
    const [total, insideNow, rows] = await db.$transaction([
      db.visit.count({ where }),
      db.visit.count({ where: { ...base, status: 'CHECKED_IN' } }),
      db.visit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: INCLUDE,
      }),
    ]);
    return { items: rows.map(toRecord), page: q.page, pageSize: q.pageSize, total, insideNow };
  }

  /** Returning visitors, so the desk does not retype them. */
  async searchVisitors(principal: Principal, q: string | undefined) {
    const rows = await this.prisma.client.visitor.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { company: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { fullName: 'asc' },
      take: 10,
    });
    return rows.map((v) => ({
      id: v.id,
      fullName: v.fullName,
      company: v.company,
      phone: v.phone,
      email: v.email,
    }));
  }

  async create(principal: Principal, input: VisitCreate, meta: RequestMeta): Promise<VisitRecord> {
    const db = this.prisma.client;
    const host = await db.employee.findFirst({
      where: { id: input.hostId, organizationId: principal.organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!host) {
      throw new ProblemException(422, 'VALIDATION_FAILED', 'Choose an active employee as the host', [
        { field: 'hostId', message: 'Choose an active employee as the host' },
      ]);
    }
    const id = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Visit registered' },
      async (tx) => {
        const existing = input.email
          ? await tx.visitor.findFirst({
              where: { organizationId: principal.organizationId, email: input.email },
            })
          : null;
        const details = {
          fullName: input.fullName,
          company: input.company ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
        };
        const visitor = existing
          ? await tx.visitor.update({ where: { id: existing.id }, data: details })
          : await tx.visitor.create({ data: { organizationId: principal.organizationId, ...details } });
        const visit = await tx.visit.create({
          data: {
            organizationId: principal.organizationId,
            visitorId: visitor.id,
            hostId: input.hostId,
            purpose: input.purpose,
            expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
            notes: input.notes ?? null,
            registeredById: principal.employeeId,
          },
        });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'VISIT.REGISTERED',
          { type: 'Visit', id: visit.id },
          { after: { hostId: input.hostId } },
        );
        return visit.id;
      },
    );
    return input.checkIn ? this.checkIn(principal, id, meta) : this.get(principal, id);
  }

  private async load(principal: Principal, id: string): Promise<Row> {
    const row = await this.prisma.client.visit.findFirst({
      where: { id, organizationId: principal.organizationId },
      include: INCLUDE,
    });
    if (!row) throw notFound();
    return row;
  }

  async get(principal: Principal, id: string): Promise<VisitRecord> {
    return toRecord(await this.load(principal, id));
  }

  async checkIn(principal: Principal, id: string, meta: RequestMeta): Promise<VisitRecord> {
    const visit = await this.load(principal, id);
    if (visit.status !== 'EXPECTED') {
      throw new ProblemException(409, 'CONFLICT', 'Only an expected visit can be checked in');
    }
    const tz = await this.timeZone(principal);
    const day = dayKey(new Date(), tz).replaceAll('-', '');
    // Badge numbers count up through the day: V-20261010-001. A clash with another desk retries with the next number.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.prisma.transaction(
          { actorId: principal.employeeId, reason: 'Visitor checked in' },
          async (tx) => {
            const issued = await tx.visit.count({
              where: {
                organizationId: principal.organizationId,
                badgeNumber: { startsWith: `V-${day}-` },
              },
            });
            const badge = `V-${day}-${String(issued + 1 + attempt).padStart(3, '0')}`;
            const moved = await tx.visit.updateMany({
              where: { id, status: 'EXPECTED' },
              data: {
                status: 'CHECKED_IN',
                checkedInAt: new Date(),
                checkedInById: principal.employeeId,
                badgeNumber: badge,
              },
            });
            if (moved.count === 0) {
              throw new ProblemException(409, 'CONFLICT', 'Only an expected visit can be checked in');
            }
            await createNotification(tx, {
              organizationId: principal.organizationId,
              recipientId: visit.hostId,
              type: 'VISITOR_ARRIVED',
              subject: `${visit.visitor.fullName} has arrived`,
              message: visit.purpose,
              entityType: 'Visit',
              entityId: id,
            });
            await logEntityChange(
              { audit: this.audit, activity: this.activity },
              tx,
              principal,
              meta,
              'VISIT.CHECKED_IN',
              { type: 'Visit', id },
              { after: { badgeNumber: badge } },
            );
          },
        );
        return this.get(principal, id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ProblemException(409, 'CONFLICT', 'Could not issue a badge number. Try again.');
  }

  async checkOut(principal: Principal, id: string, meta: RequestMeta): Promise<VisitRecord> {
    await this.load(principal, id);
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Visitor checked out' },
      async (tx) => {
        const moved = await tx.visit.updateMany({
          where: { id, status: 'CHECKED_IN' },
          data: { status: 'CHECKED_OUT', checkedOutAt: new Date() },
        });
        if (moved.count === 0) {
          throw new ProblemException(
            409,
            'CONFLICT',
            'Only a visitor who is in the office can be checked out',
          );
        }
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'VISIT.CHECKED_OUT',
          { type: 'Visit', id },
        );
      },
    );
    return this.get(principal, id);
  }

  async cancel(principal: Principal, id: string, reason: string | undefined, meta: RequestMeta) {
    await this.load(principal, id);
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Visit cancelled' },
      async (tx) => {
        const moved = await tx.visit.updateMany({
          where: { id, status: 'EXPECTED' },
          data: { status: 'CANCELLED', ...(reason ? { notes: reason } : {}) },
        });
        if (moved.count === 0) {
          throw new ProblemException(409, 'CONFLICT', 'Only an expected visit can be cancelled');
        }
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'VISIT.CANCELLED',
          { type: 'Visit', id },
        );
      },
    );
    return this.get(principal, id);
  }

  async badge(principal: Principal, id: string): Promise<VisitBadge> {
    const v = await this.load(principal, id);
    if (!v.badgeNumber || !v.checkedInAt) {
      throw new ProblemException(409, 'CONFLICT', 'A badge is issued when the visitor checks in');
    }
    const tz = await this.timeZone(principal);
    return {
      badgeNumber: v.badgeNumber,
      visitorName: v.visitor.fullName,
      company: v.visitor.company,
      hostName: v.host.fullName,
      date: dayKey(v.checkedInAt, tz),
      checkedInAt: v.checkedInAt.toISOString(),
    };
  }
}
