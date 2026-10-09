import { Injectable } from '@nestjs/common';
import type { CoderDashboard } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, zonedDayStart } from '../projects/zoned-time';

/** "Today" for the coder dashboard is the India calendar day, the same day the team works to. */
const DASHBOARD_TIME_ZONE = 'Asia/Kolkata';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The coder's dashboard figures, all computed from the coder's own submitted work:
 * - CPH: charts submitted ÷ active hours (open → submit, minus time on hold).
 * - Audit %: error-based accuracy, (ICDs + DOS coded − total errors) ÷ (ICDs + DOS coded) × 100 across audited charts.
 */
@Injectable()
export class CoderDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(principal: Principal): Promise<CoderDashboard> {
    const db = this.prisma.client;
    const me = principal.employeeId;
    const todayStart = zonedDayStart(dayKey(new Date(), DASHBOARD_TIME_ZONE), DASHBOARD_TIME_ZONE);
    const submitted = {
      coderId: me,
      status: { in: ['SUBMITTED', 'SUPERSEDED'] as ('SUBMITTED' | 'SUPERSEDED')[] },
    };

    const [totalCharts, todayCharts, timed, audits, open, held] = await Promise.all([
      db.productionEntry.findMany({ where: submitted, distinct: ['chartId'], select: { chartId: true } }),
      db.productionEntry.findMany({
        where: { ...submitted, submittedAt: { gte: todayStart } },
        distinct: ['chartId'],
        select: { chartId: true },
      }),
      db.productionEntry.aggregate({
        where: { ...submitted, activeSeconds: { not: null } },
        _count: { _all: true },
        _sum: { activeSeconds: true },
      }),
      db.audit.findMany({
        where: { status: { not: 'IN_PROGRESS' }, productionEntry: { coderId: me } },
        select: { totalErrors: true, productionEntry: { select: { icds: true, dos: true } } },
      }),
      db.chartAllocation.count({
        where: {
          employeeId: me,
          status: 'ACTIVE',
          chart: { status: { in: ['ALLOCATED', 'IN_PRODUCTION'] } },
        },
      }),
      db.chartAllocation.count({
        where: {
          employeeId: me,
          status: 'ACTIVE',
          chart: { status: 'IN_PRODUCTION', heldAt: { not: null } },
        },
      }),
    ]);

    const hours = (timed._sum.activeSeconds ?? 0) / 3600;
    const cph = hours > 0 ? round1(timed._count._all / hours) : null;

    const units = audits.reduce((n, a) => n + a.productionEntry.icds + a.productionEntry.dos, 0);
    const errors = audits.reduce((n, a) => n + a.totalErrors, 0);
    let auditPercentage: number | null = null;
    if (audits.length > 0) {
      auditPercentage =
        units > 0 ? round1(Math.max(0, ((units - errors) / units) * 100)) : errors === 0 ? 100 : 0;
    }

    return {
      totalCoded: totalCharts.length,
      todayCoded: todayCharts.length,
      cph,
      activeHours: round1(hours),
      auditPercentage,
      auditedCharts: audits.length,
      totalErrors: errors,
      onHold: held,
      pendingWork: open,
    };
  }
}
