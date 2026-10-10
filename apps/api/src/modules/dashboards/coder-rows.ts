import type { CoderPerformanceRow } from '@smartcode/shared';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, monthStart, zonedDayStart } from '../projects/zoned-time';
import { accuracy, round1 } from './manager-dashboard.service';

/** One performance row per coder for this month in the organization's time zone (shared by Vendor and Team Lead views). */
export async function coderRows(
  prisma: PrismaService,
  coderIds: string[],
  timeZone: string,
): Promise<CoderPerformanceRow[]> {
  if (coderIds.length === 0) return [];
  const db = prisma.client;
  const today = dayKey(new Date(), timeZone);
  const todayStart = zonedDayStart(today, timeZone);
  const monthStartAt = zonedDayStart(monthStart(today), timeZone);
  const [coders, entries, audits, open] = await Promise.all([
    db.employee.findMany({
      where: { id: { in: coderIds }, role: 'CODER', status: 'ACTIVE' },
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
        coderId: { in: coderIds },
      },
      select: { coderId: true, chartId: true, pageCount: true, activeSeconds: true, submittedAt: true },
    }),
    db.audit.findMany({
      where: {
        status: { not: 'IN_PROGRESS' },
        auditedAt: { gte: monthStartAt },
        productionEntry: { coderId: { in: coderIds } },
      },
      select: { totalErrors: true, productionEntry: { select: { coderId: true, icds: true, dos: true } } },
    }),
    db.chartAllocation.groupBy({
      by: ['employeeId'],
      where: {
        status: 'ACTIVE',
        employeeId: { in: coderIds },
        chart: { status: { in: ['ALLOCATED', 'IN_PRODUCTION'] } },
      },
      _count: { _all: true },
    }),
  ]);
  return coders.map((c) => {
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
}
