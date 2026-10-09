import { Injectable } from '@nestjs/common';
import type { CoachCoderRow, CoachDashboard, CoachProjectRow } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, monthStart, zonedDayStart } from '../projects/zoned-time';
import { accuracy } from './manager-dashboard.service';

/** The Quality Coach (SME) view: this month's audit quality across the projects the coach is staffed on. */
@Injectable()
export class CoachDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(principal: Principal): Promise<CoachDashboard> {
    const db = this.prisma.client;
    const org = await db.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
      select: { timeZone: true },
    });
    const monthFrom = monthStart(dayKey(new Date(), org.timeZone));
    const monthStartAt = zonedDayStart(monthFrom, org.timeZone);
    const projects = await db.project.findMany({
      where: {
        organizationId: principal.organizationId,
        assignments: { some: { employeeId: principal.employeeId, endedAt: null } },
      },
      select: { id: true, name: true, client: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const ids = projects.map((p) => p.id);
    const [audits, reviewCharts, rework] = await Promise.all([
      db.audit.findMany({
        where: {
          status: { not: 'IN_PROGRESS' },
          auditedAt: { gte: monthStartAt },
          chart: { projectId: { in: ids } },
        },
        select: {
          auditErrors: true,
          errorExceptions: true,
          totalErrors: true,
          chart: { select: { projectId: true } },
          productionEntry: {
            select: {
              icds: true,
              dos: true,
              coder: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
              loginName: { select: { value: true } },
            },
          },
        },
      }),
      db.chart.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids }, status: 'REVIEW_REQUIRED' },
        _count: { _all: true },
      }),
      db.rework.findMany({
        where: { status: 'OPEN', chart: { projectId: { in: ids } } },
        select: { chart: { select: { projectId: true } } },
      }),
    ]);
    const units = (a: (typeof audits)[number]) => ({
      totalErrors: a.totalErrors,
      units: a.productionEntry.icds + a.productionEntry.dos,
    });

    const projectRows: CoachProjectRow[] = projects.map((p) => {
      const mine = audits.filter((a) => a.chart.projectId === p.id);
      return {
        projectId: p.id,
        name: p.name,
        client: p.client.name,
        auditedCharts: mine.length,
        auditPercentage: accuracy(mine.map(units)),
        totalErrors: mine.reduce((n, a) => n + a.totalErrors, 0),
        reviewRequired: reviewCharts.find((r) => r.projectId === p.id)?._count._all ?? 0,
        openRework: rework.filter((r) => r.chart.projectId === p.id).length,
      };
    });

    const byCoder = new Map<string, typeof audits>();
    for (const a of audits) {
      const list = byCoder.get(a.productionEntry.coder.id) ?? [];
      list.push(a);
      byCoder.set(a.productionEntry.coder.id, list);
    }
    const coders: CoachCoderRow[] = [...byCoder.values()].map((list) => {
      const first = list[0]!.productionEntry;
      return {
        coderId: first.coder.id,
        fullName: first.coder.fullName,
        loginName: first.loginName.value,
        auditedCharts: list.length,
        auditPercentage: accuracy(list.map(units)),
        auditErrors: list.reduce((n, a) => n + a.auditErrors, 0),
        errorExceptions: list.reduce((n, a) => n + a.errorExceptions, 0),
        totalErrors: list.reduce((n, a) => n + a.totalErrors, 0),
      };
    });
    coders.sort(
      (a, b) =>
        (a.auditPercentage ?? 101) - (b.auditPercentage ?? 101) || a.fullName.localeCompare(b.fullName),
    );

    return {
      asOf: new Date().toISOString(),
      timeZone: org.timeZone,
      monthFrom,
      totals: {
        projects: projects.length,
        auditedCharts: audits.length,
        auditPercentage: accuracy(audits.map(units)),
        totalErrors: audits.reduce((n, a) => n + a.totalErrors, 0),
        reviewRequired: projectRows.reduce((n, p) => n + p.reviewRequired, 0),
        openRework: projectRows.reduce((n, p) => n + p.openRework, 0),
      },
      projects: projectRows,
      coders,
    };
  }
}
