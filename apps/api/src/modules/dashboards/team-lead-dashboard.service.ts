import { Injectable } from '@nestjs/common';
import type { TeamLeadDashboard } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, monthStart, zonedDayStart } from '../projects/zoned-time';
import { coderRows } from './coder-rows';
import { accuracy, round1 } from './manager-dashboard.service';

/**
 * The Team Lead workspace: the teams the caller leads (from the database, never the request), each current coder's
 * month, and what is waiting on the team (audit, review, rework).
 */
@Injectable()
export class TeamLeadDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(principal: Principal, requestedTeamId?: string): Promise<TeamLeadDashboard> {
    const db = this.prisma.client;
    const org = await db.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
      select: { timeZone: true },
    });
    // A Team Lead sees the teams they lead. The Manager opens any team by id (from a project or the team list).
    if (principal.role === 'MANAGER' && !requestedTeamId) {
      throw new ProblemException(422, 'VALIDATION_FAILED', 'Choose a team to view.');
    }
    const teams = await db.team.findMany({
      where:
        principal.role === 'MANAGER'
          ? { id: requestedTeamId, organizationId: principal.organizationId }
          : { teamLeadId: principal.employeeId, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (principal.role === 'MANAGER' && teams.length === 0) {
      throw new ProblemException(404, 'NOT_FOUND', 'Team not found');
    }
    const members = await db.teamMembership.findMany({
      where: {
        teamId: { in: teams.map((t) => t.id) },
        endedAt: null,
        employee: { role: 'CODER', status: 'ACTIVE' },
      },
      select: { employeeId: true },
    });
    const coderIds = [...new Set(members.map((m) => m.employeeId))];
    const coders = await coderRows(this.prisma, coderIds, org.timeZone);

    const today = dayKey(new Date(), org.timeZone);
    const monthFrom = monthStart(today);
    const monthStartAt = zonedDayStart(monthFrom, org.timeZone);
    const [audits, pendingAudit, reviewRequired, rework] = await Promise.all([
      db.audit.findMany({
        where: {
          status: { not: 'IN_PROGRESS' },
          auditedAt: { gte: monthStartAt },
          productionEntry: { coderId: { in: coderIds } },
        },
        select: { totalErrors: true, productionEntry: { select: { icds: true, dos: true } } },
      }),
      db.productionEntry.count({
        where: {
          coderId: { in: coderIds },
          status: 'SUBMITTED',
          chart: { status: { in: ['PENDING_AUDIT', 'RE_AUDIT'] } },
        },
      }),
      db.productionEntry.count({
        where: { coderId: { in: coderIds }, status: 'SUBMITTED', chart: { status: 'REVIEW_REQUIRED' } },
      }),
      db.rework.count({ where: { status: 'OPEN', assignedCoderId: { in: coderIds } } }),
    ]);

    const hoursCharts = coders.filter((c) => c.cph !== null);
    const sum = (f: (c: (typeof coders)[number]) => number) => coders.reduce((n, c) => n + f(c), 0);
    return {
      asOf: new Date().toISOString(),
      timeZone: org.timeZone,
      monthFrom,
      teams,
      totals: {
        coders: coders.length,
        openCharts: sum((c) => c.openCharts),
        chartsToday: sum((c) => c.chartsToday),
        chartsMonth: sum((c) => c.chartsMonth),
        pagesMonth: sum((c) => c.pagesMonth),
        // Average of the coders who have timed work; null when nobody does.
        cph: hoursCharts.length
          ? round1(hoursCharts.reduce((n, c) => n + (c.cph ?? 0), 0) / hoursCharts.length)
          : null,
        auditPercentage: accuracy(
          audits.map((a) => ({
            totalErrors: a.totalErrors,
            units: a.productionEntry.icds + a.productionEntry.dos,
          })),
        ),
        auditedCharts: audits.length,
        totalErrors: audits.reduce((n, a) => n + a.totalErrors, 0),
      },
      pending: { audit: pendingAudit, reviewRequired, rework },
      coders,
    };
  }
}
