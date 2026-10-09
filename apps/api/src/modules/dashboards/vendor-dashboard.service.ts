import { Injectable } from '@nestjs/common';
import type { CoderPerformanceRow, VendorDashboard } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, monthStart, zonedDayStart } from '../projects/zoned-time';
import { ManagerDashboardService, accuracy, round1 } from './manager-dashboard.service';

/**
 * The Vendor Admin's dashboard. Everything is limited to the caller's own vendor (taken from the session, never from
 * the request) and the coder table lists only that vendor's coders.
 */
@Injectable()
export class VendorDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ManagerDashboardService,
  ) {}

  async dashboard(principal: Principal): Promise<VendorDashboard> {
    const vendorId = principal.vendorId;
    if (!vendorId) throw new ProblemException(404, 'NOT_FOUND', 'Vendor not found');
    const db = this.prisma.client;
    const base = await this.manager.dashboard(principal, { vendorId });
    const vendor = { id: vendorId, name: base.filter?.name ?? '' };

    const tz = base.timeZone;
    const today = dayKey(new Date(), tz);
    const todayStart = zonedDayStart(today, tz);
    const monthStartAt = zonedDayStart(monthStart(today), tz);
    const [coders, entries, audits, open] = await Promise.all([
      db.employee.findMany({
        where: { vendorId, role: 'CODER', status: 'ACTIVE' },
        select: {
          id: true,
          fullName: true,
          loginNameAssignments: {
            where: { endedAt: null },
            select: { loginName: { select: { value: true } } },
          },
        },
        orderBy: { fullName: 'asc' },
      }),
      db.productionEntry.findMany({
        where: {
          status: { in: ['SUBMITTED', 'SUPERSEDED'] },
          submittedAt: { gte: monthStartAt },
          coder: { vendorId },
        },
        select: { coderId: true, chartId: true, pageCount: true, activeSeconds: true, submittedAt: true },
      }),
      db.audit.findMany({
        where: {
          status: { not: 'IN_PROGRESS' },
          auditedAt: { gte: monthStartAt },
          productionEntry: { coder: { vendorId } },
        },
        select: { totalErrors: true, productionEntry: { select: { coderId: true, icds: true, dos: true } } },
      }),
      db.chartAllocation.groupBy({
        by: ['employeeId'],
        where: {
          status: 'ACTIVE',
          employee: { vendorId },
          chart: { status: { in: ['ALLOCATED', 'IN_PRODUCTION'] } },
        },
        _count: { _all: true },
      }),
    ]);

    const rows: CoderPerformanceRow[] = coders.map((c) => {
      const mine = entries.filter((e) => e.coderId === c.id);
      const timed = mine.filter((e) => e.activeSeconds !== null);
      const hours = timed.reduce((n, e) => n + (e.activeSeconds ?? 0), 0) / 3600;
      const charts = (rows: typeof mine) => new Set(rows.map((e) => e.chartId)).size;
      return {
        coderId: c.id,
        fullName: c.fullName,
        loginName: c.loginNameAssignments[0]?.loginName.value ?? null,
        chartsToday: charts(mine.filter((e) => e.submittedAt !== null && e.submittedAt >= todayStart)),
        chartsMonth: charts(mine),
        pagesMonth: mine.reduce((n, e) => n + e.pageCount, 0),
        cph: hours > 0 ? round1(timed.length / hours) : null,
        auditPercentage: accuracy(
          audits
            .filter((a) => a.productionEntry.coderId === c.id)
            .map((a) => ({
              totalErrors: a.totalErrors,
              units: a.productionEntry.icds + a.productionEntry.dos,
            })),
        ),
        openCharts: open.find((o) => o.employeeId === c.id)?._count._all ?? 0,
      };
    });
    return { ...base, vendor, coders: rows };
  }
}
