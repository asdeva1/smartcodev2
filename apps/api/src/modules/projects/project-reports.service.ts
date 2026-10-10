import { Injectable } from '@nestjs/common';
import {
  type LiveTracking,
  type ProductionReport,
  type QualityReport,
  type ReportPeriod,
  type ReportQuery,
} from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { addDays, dayKey, monthStart, zonedDayStart } from './zoned-time';

const LIVE_DAYS = 14;

interface Person {
  id: string;
  fullName: string;
  loginName: string | null;
}

/**
 * Production report, Quality report and Live chart tracking of one project. Days are the organization's calendar
 * days (its time zone). "Today (Shift End)" is the full calendar day up to now — the end-of-shift view.
 */
@Injectable()
export class ProjectReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async timeZone(organizationId: string): Promise<string> {
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return org.timeZone;
  }

  private resolvePeriod(query: ReportQuery, timeZone: string, now: Date) {
    const today = dayKey(now, timeZone);
    let from = today;
    let to = today;
    if (query.range === 'month') from = monthStart(today);
    if (query.range === 'custom' && query.from && query.to) {
      from = query.from;
      to = query.to;
    }
    const period: ReportPeriod = { range: query.range, from, to, timeZone };
    return { period, start: zonedDayStart(from, timeZone), end: zonedDayStart(addDays(to, 1), timeZone) };
  }

  // ───────── production ─────────

  async production(principal: Principal, projectId: string, query: ReportQuery): Promise<ProductionReport> {
    await this.projects.load(principal, projectId);
    const timeZone = await this.timeZone(principal.organizationId);
    const { period, start, end } = this.resolvePeriod(query, timeZone, new Date());
    const entries = await this.prisma.client.productionEntry.findMany({
      where: {
        chart: { projectId },
        status: { in: ['SUBMITTED', 'SUPERSEDED'] },
        submittedAt: { gte: start, lt: end },
        ...this.ownWork(principal),
      },
      select: {
        chartId: true,
        pageCount: true,
        icds: true,
        dos: true,
        coder: { select: { id: true, fullName: true } },
        loginName: { select: { value: true } },
      },
    });
    const byCoder = new Map<
      string,
      { person: Person; charts: Set<string>; pages: number; icds: number; dos: number }
    >();
    for (const e of entries) {
      const row = byCoder.get(e.coder.id) ?? {
        person: { id: e.coder.id, fullName: e.coder.fullName, loginName: e.loginName.value },
        charts: new Set<string>(),
        pages: 0,
        icds: 0,
        dos: 0,
      };
      row.charts.add(e.chartId);
      row.pages += e.pageCount;
      row.icds += e.icds;
      row.dos += e.dos;
      byCoder.set(e.coder.id, row);
    }
    const rows = [...byCoder.values()]
      .map((r) => ({ coder: r.person, charts: r.charts.size, pages: r.pages, icds: r.icds, dos: r.dos }))
      .sort((a, b) => b.charts - a.charts || a.coder.fullName.localeCompare(b.coder.fullName));
    const totals = rows.reduce(
      (t, r) => ({
        charts: t.charts + r.charts,
        pages: t.pages + r.pages,
        icds: t.icds + r.icds,
        dos: t.dos + r.dos,
      }),
      { charts: 0, pages: 0, icds: 0, dos: 0 },
    );
    return { period, totals, rows };
  }

  // ───────── quality ─────────

  async quality(principal: Principal, projectId: string, query: ReportQuery): Promise<QualityReport> {
    await this.projects.load(principal, projectId);
    const timeZone = await this.timeZone(principal.organizationId);
    const { period, start, end } = this.resolvePeriod(query, timeZone, new Date());
    const audits = await this.prisma.client.audit.findMany({
      where: {
        chart: { projectId },
        status: { not: 'IN_PROGRESS' },
        auditedAt: { gte: start, lt: end },
        ...(principal.role === 'CODER' ? { productionEntry: { coderId: principal.employeeId } } : {}),
      },
      select: {
        status: true,
        auditErrors: true,
        errorExceptions: true,
        totalErrors: true,
        productionEntry: {
          select: {
            coder: { select: { id: true, fullName: true } },
            loginName: { select: { value: true } },
          },
        },
      },
    });
    type Acc = Omit<QualityReport['totals'], never>;
    const blank = (): Acc => ({
      audited: 0,
      passed: 0,
      reviewRequired: 0,
      rejected: 0,
      auditErrors: 0,
      errorExceptions: 0,
      totalErrors: 0,
    });
    const add = (acc: Acc, a: (typeof audits)[number]) => {
      acc.audited += 1;
      if (a.status === 'PASSED') acc.passed += 1;
      // Everything the auditor sent to the Manager, whether still open or already resolved.
      if (a.status === 'REVIEW_REQUIRED' || a.status === 'APPROVED' || a.status === 'REJECTED')
        acc.reviewRequired += 1;
      if (a.status === 'REJECTED') acc.rejected += 1;
      acc.auditErrors += a.auditErrors;
      acc.errorExceptions += a.errorExceptions;
      acc.totalErrors += a.totalErrors;
    };
    const byCoder = new Map<string, { person: Person; acc: Acc }>();
    const totals = blank();
    for (const a of audits) {
      const coder = a.productionEntry.coder;
      const row = byCoder.get(coder.id) ?? {
        person: { id: coder.id, fullName: coder.fullName, loginName: a.productionEntry.loginName.value },
        acc: blank(),
      };
      add(row.acc, a);
      add(totals, a);
      byCoder.set(coder.id, row);
    }
    const rows = [...byCoder.values()]
      .map((r) => ({ coder: r.person, ...r.acc }))
      .sort((a, b) => b.audited - a.audited || a.coder.fullName.localeCompare(b.coder.fullName));
    return { period, totals, rows };
  }

  /** A coder only sees their own numbers. */
  private ownWork(principal: Principal) {
    return principal.role === 'CODER' ? { coderId: principal.employeeId } : {};
  }

  // ───────── live tracking ─────────

  async live(principal: Principal, projectId: string): Promise<LiveTracking> {
    await this.projects.load(principal, projectId);
    const timeZone = await this.timeZone(principal.organizationId);
    const now = new Date();
    const today = dayKey(now, timeZone);
    const firstDay = addDays(today, -(LIVE_DAYS - 1));
    const since = zonedDayStart(firstDay, timeZone);
    const mine = principal.role === 'CODER';

    const [firstSubmissions, openAllocations, byStatus] = await Promise.all([
      // A chart is "done" on the day its coder first submitted it (version 1); later versions are rework.
      this.prisma.client.productionEntry.findMany({
        where: {
          chart: { projectId },
          version: 1,
          submittedAt: { gte: since },
          ...(mine ? { coderId: principal.employeeId } : {}),
        },
        select: {
          submittedAt: true,
          coder: { select: { id: true, fullName: true } },
          loginName: { select: { value: true } },
        },
      }),
      this.prisma.client.chartAllocation.findMany({
        where: {
          status: 'ACTIVE',
          chart: { projectId, status: { in: ['ALLOCATED', 'IN_PRODUCTION'] } },
          ...(mine ? { employeeId: principal.employeeId } : {}),
        },
        select: {
          chart: { select: { status: true } },
          employee: { select: { id: true, fullName: true } },
          loginName: { select: { value: true } },
        },
      }),
      this.prisma.client.chart.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
    ]);

    const perDay = new Map<string, number>();
    for (let i = 0; i < LIVE_DAYS; i += 1) perDay.set(addDays(firstDay, i), 0);
    const coders = new Map<
      string,
      { person: Person; doneToday: number; inProduction: number; allocated: number }
    >();
    const coder = (id: string, fullName: string, loginName: string | null) => {
      const found = coders.get(id) ?? {
        person: { id, fullName, loginName },
        doneToday: 0,
        inProduction: 0,
        allocated: 0,
      };
      coders.set(id, found);
      return found;
    };
    let doneToday = 0;
    for (const e of firstSubmissions) {
      if (!e.submittedAt) continue;
      const day = dayKey(e.submittedAt, timeZone);
      if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (day === today) {
        doneToday += 1;
        coder(e.coder.id, e.coder.fullName, e.loginName.value).doneToday += 1;
      }
    }
    for (const a of openAllocations) {
      const row = coder(a.employee.id, a.employee.fullName, a.loginName.value);
      if (a.chart.status === 'IN_PRODUCTION') row.inProduction += 1;
      else row.allocated += 1;
    }
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      asOf: now.toISOString(),
      timeZone,
      today,
      doneToday,
      inProduction: count('IN_PRODUCTION'),
      allocated: count('ALLOCATED'),
      pendingAllocation: count('PENDING_ALLOCATION'),
      days: [...perDay.entries()].map(([date, chartsDone]) => ({ date, chartsDone })),
      coders: [...coders.values()]
        .map((c) => ({
          coder: c.person,
          doneToday: c.doneToday,
          inProduction: c.inProduction,
          allocated: c.allocated,
        }))
        .sort((a, b) => b.doneToday - a.doneToday || a.coder.fullName.localeCompare(b.coder.fullName)),
    };
  }
}
