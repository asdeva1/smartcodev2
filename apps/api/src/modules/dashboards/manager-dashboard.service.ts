import { Injectable } from '@nestjs/common';
import {
  IN_HOUSE_FILTER,
  type ManagerDashboard,
  type ManagerDashboardQuery,
  type ProductionFigures,
  type VendorPerformanceRow,
} from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { dayKey, monthStart, zonedDayStart } from '../projects/zoned-time';

export const round1 = (n: number) => Math.round(n * 10) / 10;
const NOT_FOUND = () => new ProblemException(404, 'NOT_FOUND', 'Vendor not found');

/** Error-based accuracy: (ICDs + DOS − errors) ÷ (ICDs + DOS) × 100; null when nothing was audited. */
export function accuracy(audits: { totalErrors: number; units: number }[]): number | null {
  if (audits.length === 0) return null;
  const units = audits.reduce((n, a) => n + a.units, 0);
  const errors = audits.reduce((n, a) => n + a.totalErrors, 0);
  return units > 0 ? round1(Math.max(0, ((units - errors) / units) * 100)) : errors === 0 ? 100 : 0;
}

/**
 * The Manager dashboard: organization-wide counts, production (today and this month), audit and rework status, CPH and
 * audit accuracy, and a performance row per vendor (in-house included). Days and months are the organization's own.
 */
@Injectable()
export class ManagerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(principal: Principal, query: ManagerDashboardQuery): Promise<ManagerDashboard> {
    const db = this.prisma.client;
    const org = await db.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
      select: { timeZone: true },
    });
    const now = new Date();
    const today = dayKey(now, org.timeZone);
    const monthFrom = monthStart(today);
    const todayStart = zonedDayStart(today, org.timeZone);
    const monthStartAt = zonedDayStart(monthFrom, org.timeZone);

    // Vendor filter: one vendor, in-house only, or everything.
    let filter: ManagerDashboard['filter'] = null;
    let vendorWhere: { vendorId?: string | null } = {};
    if (query.vendorId === IN_HOUSE_FILTER) {
      filter = { vendorId: null, name: 'In-house' };
      vendorWhere = { vendorId: null };
    } else if (query.vendorId) {
      const vendor = await db.vendor.findFirst({
        where: { id: query.vendorId, organizationId: principal.organizationId },
        select: { id: true, name: true },
      });
      if (!vendor) throw NOT_FOUND();
      filter = { vendorId: vendor.id, name: vendor.name };
      vendorWhere = { vendorId: vendor.id };
    }
    const inProject = { project: { is: vendorWhere } };

    const [
      projects,
      teams,
      staff,
      charts,
      pendingAudits,
      completedAudits,
      reworks,
      entries,
      monthAudits,
      vendors,
    ] = await Promise.all([
      db.project.count({ where: { status: 'ACTIVE', ...vendorWhere } }),
      db.team.count({ where: { status: 'ACTIVE', ...vendorWhere } }),
      db.employee.groupBy({
        by: ['role'],
        where: { status: 'ACTIVE', role: { in: ['TEAM_LEAD', 'AUDITOR', 'CODER'] }, ...vendorWhere },
        _count: { _all: true },
      }),
      db.chart.groupBy({ by: ['status'], where: { ...inProject }, _count: { _all: true } }),
      db.chart.count({ where: { status: { in: ['PENDING_AUDIT', 'RE_AUDIT'] }, ...inProject } }),
      db.audit.count({ where: { status: { not: 'IN_PROGRESS' }, chart: inProject } }),
      db.rework.count({ where: { status: 'OPEN', chart: inProject } }),
      db.productionEntry.findMany({
        where: {
          status: { in: ['SUBMITTED', 'SUPERSEDED'] },
          submittedAt: { gte: monthStartAt },
          chart: inProject,
        },
        select: {
          chartId: true,
          pageCount: true,
          icds: true,
          dos: true,
          activeSeconds: true,
          submittedAt: true,
          chart: { select: { project: { select: { vendorId: true } } } },
        },
      }),
      db.audit.findMany({
        where: { status: { not: 'IN_PROGRESS' }, auditedAt: { gte: monthStartAt }, chart: inProject },
        select: {
          totalErrors: true,
          productionEntry: {
            select: {
              icds: true,
              dos: true,
              chart: { select: { project: { select: { vendorId: true } } } },
            },
          },
        },
      }),
      db.vendor.findMany({
        where: {
          organizationId: principal.organizationId,
          ...(filter?.vendorId ? { id: filter.vendorId } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const roleCount = (role: string) => staff.find((s) => s.role === role)?._count._all ?? 0;
    const byStatus: Record<string, number> = {};
    for (const c of charts) byStatus[c.status] = c._count._all;
    const sum = (...statuses: string[]) => statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0);

    const figures = (rows: typeof entries): ProductionFigures => ({
      charts: new Set(rows.map((r) => r.chartId)).size,
      pages: rows.reduce((n, r) => n + r.pageCount, 0),
      icds: rows.reduce((n, r) => n + r.icds, 0),
      dos: rows.reduce((n, r) => n + r.dos, 0),
    });
    const hoursOf = (rows: typeof entries) => {
      const timed = rows.filter((r) => r.activeSeconds !== null);
      return { count: timed.length, hours: timed.reduce((n, r) => n + (r.activeSeconds ?? 0), 0) / 3600 };
    };
    const cphOf = (rows: typeof entries) => {
      const t = hoursOf(rows);
      return t.hours > 0 ? round1(t.count / t.hours) : null;
    };
    const auditUnits = (rows: typeof monthAudits) =>
      rows.map((a) => ({
        totalErrors: a.totalErrors,
        units: a.productionEntry.icds + a.productionEntry.dos,
      }));

    const todayEntries = entries.filter((e) => e.submittedAt !== null && e.submittedAt >= todayStart);

    // One performance row per vendor, plus in-house, from the same month of data.
    const rowFor = async (vendorId: string | null, name: string): Promise<VendorPerformanceRow> => {
      const mine = entries.filter((e) => e.chart.project.vendorId === vendorId);
      const myToday = todayEntries.filter((e) => e.chart.project.vendorId === vendorId);
      const myAudits = monthAudits.filter((a) => a.productionEntry.chart.project.vendorId === vendorId);
      const [activeCoders, completedCharts] = await Promise.all([
        db.employee.count({ where: { status: 'ACTIVE', role: 'CODER', vendorId } }),
        db.chart.count({ where: { status: 'COMPLETED', project: { is: { vendorId } } } }),
      ]);
      const f = figures(mine);
      return {
        vendorId,
        name,
        activeCoders,
        chartsToday: figures(myToday).charts,
        chartsMonth: f.charts,
        pagesMonth: f.pages,
        cph: cphOf(mine),
        auditPercentage: accuracy(auditUnits(myAudits)),
        completedCharts,
      };
    };
    const rows: VendorPerformanceRow[] = [];
    if (!filter || filter.vendorId === null) rows.push(await rowFor(null, 'In-house'));
    if (!filter || filter.vendorId !== null) for (const v of vendors) rows.push(await rowFor(v.id, v.name));

    const month = hoursOf(entries);
    return {
      asOf: now.toISOString(),
      timeZone: org.timeZone,
      monthFrom,
      filter,
      people: {
        projects,
        teams,
        activeTeamLeads: roleCount('TEAM_LEAD'),
        activeAuditors: roleCount('AUDITOR'),
        activeCoders: roleCount('CODER'),
      },
      charts: {
        total: Object.values(byStatus).reduce((n, v) => n + v, 0),
        completed: sum('COMPLETED'),
        pendingAllocation: sum('PENDING_ALLOCATION'),
        inProgress: sum('ALLOCATED', 'IN_PRODUCTION'),
        pendingAudit: pendingAudits,
        reviewRequired: sum('REVIEW_REQUIRED'),
        pendingRework: reworks,
        byStatus,
      },
      audits: { pending: pendingAudits, completed: completedAudits },
      production: { today: figures(todayEntries), month: figures(entries) },
      performance: {
        cph: cphOf(entries),
        activeHours: round1(month.hours),
        auditPercentage: accuracy(auditUnits(monthAudits)),
        auditedCharts: monthAudits.length,
        totalErrors: monthAudits.reduce((n, a) => n + a.totalErrors, 0),
      },
      vendors: rows,
    };
  }
}
