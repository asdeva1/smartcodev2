import { Injectable } from '@nestjs/common';
import {
  type CsvPreview,
  type CsvResult,
  type PullbackResult,
  type SubmitToClientResult,
  ALLOCATION_CSV_COLUMNS,
  REPOSITORY_CSV_COLUMNS,
  type AssignChart,
  chartIdSchema,
  emailSchema,
  loginNameSchema,
  startsWithFormulaTrigger,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';
import { PrismaService } from '../../core/prisma/prisma.service';
import { type Draft, finish, markRepeats, readCsv } from '../employees/csv-import.service';
import { LoginNamesService } from '../employees/login-names.service';
import { logEntityChange } from '../organization/entity-log';
import { OPEN_CHART_STATUSES, ProjectsService } from './projects.service';

interface ParsedRow {
  email: string;
  loginName: string;
  chartRef: string;
  pages: number | null;
  pageBucket: string | null;
  remarks: string | null;
}

interface ApplyRow extends ParsedRow {
  line: number;
  employeeId: string;
  /** The chart already exists in the project's repository as PENDING_ALLOCATION. */
  existingChartId: string | null;
}

const MAX_PAGES = 100_000;

/**
 * Manual-project chart allocation and its reversals:
 *  - allocation file (Login Name, Email ID, Chart ID, Pages, Page Bucket, Remarks) → charts created and allocated
 *  - Manager pull-back of selected charts, submit finished charts to the client
 *  - client pull-back: every open allocation of the project ends and the coders' counts drop to zero
 * Every allocation goes through the same database-guarded rows as the other allocation entry points (source CSV).
 */
@Injectable()
export class ProjectAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly loginNames: LoginNamesService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  private async manualProject(principal: Principal, projectId: string) {
    const project = await this.projects.load(principal, projectId);
    if (project.allocationType !== 'MANUAL') {
      throw new ProblemException(
        422,
        'AUTOMATIC_PROJECT',
        'This project allocates charts automatically. File allocation is only available for Manual projects.',
      );
    }
    if (project.status !== 'ACTIVE') {
      throw new ProblemException(409, 'CONFLICT', 'Only an active project can receive charts');
    }
    return project;
  }

  // ───────── chart repository file (store charts, allocate later) ─────────

  async previewRepository(principal: Principal, projectId: string, csv: string): Promise<CsvPreview> {
    return (await this.validateRepository(principal, projectId, csv)).preview;
  }

  private async validateRepository(principal: Principal, projectId: string, csv: string) {
    await this.manualProject(principal, projectId);
    const { parsed, fileErrors } = readCsv(
      csv,
      REPOSITORY_CSV_COLUMNS.slice(0, 1),
      ['Password'],
      REPOSITORY_CSV_COLUMNS.slice(1),
    );
    if (!parsed || fileErrors.length) {
      return { preview: finish([], fileErrors), apply: [] as Omit<ParsedRow, 'email' | 'loginName'>[] };
    }
    const drafts: Draft[] = parsed.rows.map((row) => ({
      line: row.line,
      values: {
        'Chart ID': row.cells['chartid'] ?? '',
        Pages: row.cells['pages'] ?? '',
        'Page Bucket': row.cells['pagebucket'] ?? '',
        Remarks: row.cells['remarks'] ?? '',
      },
      errors: [],
      warnings: [],
      duplicate: false,
    }));
    const values = new Map<Draft, Omit<ParsedRow, 'email' | 'loginName'>>();
    for (const d of drafts) {
      const chartRef = chartIdSchema.safeParse(d.values['Chart ID']);
      if (!chartRef.success) d.errors.push(chartRef.error.issues[0]?.message ?? 'Chart ID is not valid');
      else if (startsWithFormulaTrigger(chartRef.data))
        d.errors.push('Chart ID cannot start with = + - or @');
      const pagesText = d.values.Pages ?? '';
      let pages: number | null = null;
      if (pagesText) {
        if (!/^\d+$/.test(pagesText) || Number(pagesText) > MAX_PAGES)
          d.errors.push(`Pages must be a whole number from 0 to ${MAX_PAGES}`);
        else pages = Number(pagesText);
      }
      const bucket = d.values['Page Bucket'] ?? '';
      if (bucket.length > 64) d.errors.push('Page Bucket must be at most 64 characters');
      else if (bucket && startsWithFormulaTrigger(bucket))
        d.errors.push('Page Bucket cannot start with = + - or @');
      const remarks = d.values.Remarks ?? '';
      if (remarks.length > 1000) d.errors.push('Remarks must be at most 1000 characters');
      else if (remarks && startsWithFormulaTrigger(remarks))
        d.errors.push('Remarks cannot start with = + - or @');
      if (chartRef.success && !d.errors.length)
        values.set(d, {
          chartRef: chartRef.data,
          pages,
          pageBucket: bucket || null,
          remarks: remarks || null,
        });
    }
    markRepeats(
      drafts,
      (d) => values.get(d)?.chartRef.toLowerCase() ?? null,
      (l) => `This Chart ID is repeated on line ${l.join(', ')}`,
    );
    const refs = [...new Set([...values.values()].map((v) => v.chartRef))];
    const existing = await this.prisma.client.chart.findMany({
      where: { projectId, chartRef: { in: refs } },
      select: { chartRef: true, status: true },
    });
    const byRef = new Map(existing.map((c) => [c.chartRef, c.status]));
    for (const d of drafts) {
      const v = values.get(d);
      if (!v || d.errors.length) continue;
      const status = byRef.get(v.chartRef);
      if (status) d.errors.push(`This Chart ID is already in the project (${status})`);
    }
    const preview = finish(drafts, []);
    const apply = preview.rows
      .map((r, i) => (r.status === 'VALID' ? values.get(drafts[i] as Draft) : undefined))
      .filter((x): x is Omit<ParsedRow, 'email' | 'loginName'> => Boolean(x));
    return { preview, apply };
  }

  /** Stores the charts of the file in the project's repository, waiting to be allocated. */
  async commitRepository(
    principal: Principal,
    projectId: string,
    csv: string,
    mode: 'valid-only' | 'all-or-nothing',
    meta: RequestMeta,
  ): Promise<CsvResult> {
    const { preview, apply } = await this.validateRepository(principal, projectId, csv);
    const blocked =
      preview.fileErrors.length > 0 ||
      (mode === 'all-or-nothing' && preview.valid !== preview.total) ||
      apply.length === 0;
    if (blocked) return { committed: false, created: 0, skipped: preview.total, createdIds: [], preview };
    const createdIds: string[] = [];
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'chart repository file' },
      async (tx) => {
        for (const row of apply) {
          const chart = await tx.chart.create({
            data: {
              organizationId: principal.organizationId,
              projectId,
              chartRef: row.chartRef,
              createdById: principal.employeeId,
              pages: row.pages,
              pageBucket: row.pageBucket,
              remarks: row.remarks,
            },
            select: { id: true },
          });
          createdIds.push(chart.id);
        }
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'PROJECT.CHARTS_IMPORTED',
          { type: 'Project', id: projectId },
          {
            after: {
              chartsCreated: apply.length,
              skipped: preview.total - apply.length,
              mode,
              repository: true,
            },
          },
        );
      },
      { timeoutMs: 120_000 },
    );
    return {
      committed: true,
      created: createdIds.length,
      skipped: preview.total - createdIds.length,
      createdIds,
      preview,
    };
  }

  /**
   * Manual "Add chart": allocates one chart that is already in the repository to a coder. The Login Name is linked to
   * the Email (when the coder has none yet) and the chart is allotted under it, using the same checks as the file.
   */
  async assign(
    principal: Principal,
    projectId: string,
    input: AssignChart,
    meta: RequestMeta,
  ): Promise<CsvResult> {
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [
      ALLOCATION_CSV_COLUMNS.join(','),
      [input.loginName, input.email, input.chartId, '', '', ''].map(quote).join(','),
    ].join('\n');
    const { preview, apply } = await this.validate(principal, projectId, csv);
    const row = apply[0];
    if (preview.fileErrors.length === 0 && preview.valid === 1 && row && !row.existingChartId) {
      throw new ProblemException(
        404,
        'NOT_FOUND',
        'This Chart ID is not in the project’s chart repository. Upload it with the CSV first.',
      );
    }
    return this.commit(principal, projectId, csv, 'all-or-nothing', meta);
  }

  // ───────── allocation file ─────────

  async preview(principal: Principal, projectId: string, csv: string): Promise<CsvPreview> {
    return (await this.validate(principal, projectId, csv)).preview;
  }

  private async validate(principal: Principal, projectId: string, csv: string) {
    const project = await this.manualProject(principal, projectId);
    const vendorId = project.vendor?.id ?? null;
    const { parsed, fileErrors } = readCsv(
      csv,
      ALLOCATION_CSV_COLUMNS.slice(0, 3),
      ['Password'],
      ALLOCATION_CSV_COLUMNS.slice(3),
    );
    if (!parsed || fileErrors.length) return { preview: finish([], fileErrors), apply: [] as ApplyRow[] };

    const drafts: Draft[] = parsed.rows.map((row) => ({
      line: row.line,
      values: {
        'Login Name': row.cells['loginname'] ?? '',
        'Email ID': row.cells['emailid'] ?? '',
        'Chart ID': row.cells['chartid'] ?? '',
        Pages: row.cells['pages'] ?? '',
        'Page Bucket': row.cells['pagebucket'] ?? '',
        Remarks: row.cells['remarks'] ?? '',
      },
      errors: [],
      warnings: [],
      duplicate: false,
    }));

    const values = new Map<Draft, ParsedRow>();
    for (const d of drafts) {
      const email = emailSchema.safeParse(d.values['Email ID']);
      const loginName = loginNameSchema.safeParse(d.values['Login Name']);
      const chartRef = chartIdSchema.safeParse(d.values['Chart ID']);
      if (!email.success)
        d.errors.push(d.values['Email ID'] ? 'Enter a valid Email ID' : 'Email ID is required');
      if (!loginName.success) d.errors.push(loginName.error.issues[0]?.message ?? 'Login Name is not valid');
      if (!chartRef.success) d.errors.push(chartRef.error.issues[0]?.message ?? 'Chart ID is not valid');
      else if (startsWithFormulaTrigger(chartRef.data))
        d.errors.push('Chart ID cannot start with = + - or @');

      const pagesText = d.values.Pages ?? '';
      let pages: number | null = null;
      if (pagesText) {
        if (!/^\d+$/.test(pagesText) || Number(pagesText) > MAX_PAGES) {
          d.errors.push(`Pages must be a whole number from 0 to ${MAX_PAGES}`);
        } else pages = Number(pagesText);
      }
      const bucket = d.values['Page Bucket'] ?? '';
      if (bucket.length > 64) d.errors.push('Page Bucket must be at most 64 characters');
      else if (bucket && startsWithFormulaTrigger(bucket))
        d.errors.push('Page Bucket cannot start with = + - or @');
      const remarks = d.values.Remarks ?? '';
      if (remarks.length > 1000) d.errors.push('Remarks must be at most 1000 characters');
      else if (remarks && startsWithFormulaTrigger(remarks))
        d.errors.push('Remarks cannot start with = + - or @');

      if (email.success && loginName.success && chartRef.success && !d.errors.length) {
        values.set(d, {
          email: email.data,
          loginName: loginName.data,
          chartRef: chartRef.data,
          pages,
          pageBucket: bucket || null,
          remarks: remarks || null,
        });
      }
    }

    markRepeats(
      drafts,
      (d) => values.get(d)?.chartRef.toLowerCase() ?? null,
      (l) => `This Chart ID is repeated on line ${l.join(', ')}`,
    );
    this.markConflicts(
      drafts,
      values,
      'email',
      'loginName',
      (l) => `This Email ID is given a different Login Name on line ${l.join(', ')}`,
    );
    this.markConflicts(
      drafts,
      values,
      'loginName',
      'email',
      (l) => `This Login Name is given to a different Email ID on line ${l.join(', ')}`,
    );

    const emails = [...new Set([...values.values()].map((v) => v.email))];
    const names = [...new Set([...values.values()].map((v) => v.loginName))];
    const refs = [...new Set([...values.values()].map((v) => v.chartRef))];

    const [employees, existingNames, existingCharts] = await Promise.all([
      this.prisma.client.employee.findMany({
        where: { organizationId: principal.organizationId, email: { in: emails } },
        include: { loginNameAssignments: { where: { endedAt: null }, include: { loginName: true } } },
      }),
      this.prisma.client.loginName.findMany({
        where: {
          organizationId: principal.organizationId,
          OR: names.map((value) => ({ value: { equals: value, mode: 'insensitive' as const } })),
        },
        include: { assignments: { where: { endedAt: null }, select: { employeeId: true } } },
      }),
      this.prisma.client.chart.findMany({
        where: { projectId, chartRef: { in: refs } },
        include: {
          allocations: {
            where: { status: 'ACTIVE' },
            take: 1,
            include: { employee: { select: { fullName: true } } },
          },
        },
      }),
    ]);
    const holders = await this.prisma.client.chartAllocation.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: employees.map((e) => e.id) }, status: 'ACTIVE' },
    });
    const withAllocations = new Set(holders.map((h) => h.employeeId));
    const byEmail = new Map(employees.map((e) => [e.email, e]));
    const byName = new Map(existingNames.map((n) => [n.value.toLowerCase(), n]));
    const chartByRef = new Map(existingCharts.map((c) => [c.chartRef, c]));

    const apply = new Map<Draft, ApplyRow>();
    for (const d of drafts) {
      const v = values.get(d);
      if (!v || d.errors.length) continue;
      const employee = byEmail.get(v.email);
      if (!employee) d.errors.push('No employee has this Email ID');
      else if (employee.role !== 'CODER') d.errors.push(`This employee is a ${employee.role}, not a Coder`);
      else if (employee.status === 'PENDING_ACTIVATION')
        d.errors.push('This coder has not activated their account yet');
      else if (employee.status !== 'ACTIVE') d.errors.push('This coder is inactive');
      else if ((employee.vendorId ?? null) !== vendorId) {
        d.errors.push(
          vendorId
            ? 'This coder does not belong to the project’s vendor'
            : 'Vendor coders cannot receive charts of an in-house project',
        );
      }
      if (employee) {
        const holdsName = employee.loginNameAssignments[0]?.loginName.value ?? null;
        const named = byName.get(v.loginName.toLowerCase());
        const nameHolder = named?.assignments[0];
        if (named && named.status !== 'ACTIVE') d.errors.push('This Login Name is retired');
        if (nameHolder && nameHolder.employeeId !== employee.id)
          d.errors.push('This Login Name is already assigned to another employee');
        if (holdsName && holdsName.toLowerCase() !== v.loginName.toLowerCase()) {
          if (withAllocations.has(employee.id))
            d.errors.push(`This coder already works under Login Name "${holdsName}" — use that Login Name`);
          else d.warnings.push(`Replaces the coder’s Login Name "${holdsName}"`);
        } else if (!holdsName) d.warnings.push(`Assigns Login Name "${v.loginName}" to this coder`);
      }
      const chart = chartByRef.get(v.chartRef);
      if (chart) {
        if (chart.status !== 'PENDING_ALLOCATION') {
          const who = chart.allocations[0]?.employee.fullName;
          d.errors.push(
            chart.status === 'ALLOCATED' || chart.status === 'IN_PRODUCTION'
              ? `This chart is already allocated${who ? ` to ${who}` : ''} — pull it back first`
              : `This chart is ${chart.status} and cannot be allocated again`,
          );
        } else d.warnings.push('The chart already exists and will be allocated');
      }
      if (!d.errors.length && employee) {
        apply.set(d, { ...v, line: d.line, employeeId: employee.id, existingChartId: chart?.id ?? null });
      }
    }
    const preview = finish(drafts, []);
    const rows = preview.rows
      .map((r, i) => (r.status === 'VALID' ? apply.get(drafts[i] as Draft) : undefined))
      .filter((x): x is ApplyRow => Boolean(x));
    return { preview, apply: rows };
  }

  /** Flags every row whose `key` value appears with more than one `other` value. */
  private markConflicts(
    drafts: Draft[],
    values: Map<Draft, ParsedRow>,
    key: 'email' | 'loginName',
    other: 'email' | 'loginName',
    message: (lines: number[]) => string,
  ) {
    const groups = new Map<string, Draft[]>();
    for (const d of drafts) {
      const v = values.get(d);
      if (!v) continue;
      const k = v[key].toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), d]);
    }
    for (const group of groups.values()) {
      const distinct = new Set(group.map((d) => (values.get(d) as ParsedRow)[other].toLowerCase()));
      if (distinct.size < 2) continue;
      for (const d of group) {
        const mine = (values.get(d) as ParsedRow)[other].toLowerCase();
        const lines = group
          .filter((o) => (values.get(o) as ParsedRow)[other].toLowerCase() !== mine)
          .map((o) => o.line);
        d.errors.push(message(lines));
      }
    }
  }

  async commit(
    principal: Principal,
    projectId: string,
    csv: string,
    mode: 'valid-only' | 'all-or-nothing',
    meta: RequestMeta,
  ): Promise<CsvResult> {
    const { preview, apply } = await this.validate(principal, projectId, csv);
    const blocked =
      preview.fileErrors.length > 0 ||
      (mode === 'all-or-nothing' && preview.valid !== preview.total) ||
      apply.length === 0;
    if (blocked) return { committed: false, created: 0, skipped: preview.total, createdIds: [], preview };

    // Caches of "already done in this transaction". Only safe when one transaction covers the whole file.
    const sharedSeen = { employees: new Set<string>(), staffed: new Set<string>() };
    let allocated = 0;
    let created = 0;
    const createdIds: string[] = [];
    const applyOne = async (tx: Tx, row: ApplyRow, seen = sharedSeen) => {
      const chartId = await this.allocateRow(tx, principal, projectId, row, seen, meta);
      createdIds.push(chartId);
      allocated += 1;
      if (!row.existingChartId) created += 1;
    };

    if (mode === 'all-or-nothing') {
      await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'allocation file' },
        async (tx) => {
          for (const row of apply) await applyOne(tx, row);
        },
        { timeoutMs: 120_000 },
      );
    } else {
      for (const row of apply) {
        try {
          await this.prisma.transaction({ actorId: principal.employeeId, reason: 'allocation file' }, (tx) =>
            applyOne(tx, row, { employees: new Set(), staffed: new Set() }),
          );
        } catch (error) {
          // Changed since the preview (re-validated at commit): leave this row out and keep going.
          if (!(error instanceof ProblemException) && !(error as { code?: string }).code) throw error;
        }
      }
    }
    await this.prisma.transaction({ actorId: principal.employeeId, reason: 'allocation file' }, (tx) =>
      logEntityChange(
        { audit: this.audit, activity: this.activity },
        tx,
        principal,
        meta,
        'PROJECT.CHARTS_IMPORTED',
        {
          type: 'Project',
          id: projectId,
        },
        { after: { allocated, chartsCreated: created, skipped: preview.total - allocated, mode } },
      ),
    );
    return { committed: true, created: allocated, skipped: preview.total - allocated, createdIds, preview };
  }

  private async allocateRow(
    tx: Tx,
    principal: Principal,
    projectId: string,
    row: ApplyRow,
    seen: { employees: Set<string>; staffed: Set<string> },
    meta: RequestMeta,
  ): Promise<string> {
    const log = { audit: this.audit, activity: this.activity };
    // 1. The coder is a member of the project (an assignment never creates an account).
    if (!seen.staffed.has(row.employeeId)) {
      const member = await tx.projectAssignment.findFirst({
        where: { projectId, employeeId: row.employeeId, projectRole: 'CODER', endedAt: null },
        select: { id: true },
      });
      if (!member) {
        await tx.projectAssignment.create({
          data: {
            projectId,
            employeeId: row.employeeId,
            projectRole: 'CODER',
            assignedById: principal.employeeId,
          },
        });
        await logEntityChange(
          log,
          tx,
          principal,
          meta,
          'PROJECT.STAFF_ASSIGNED',
          { type: 'Project', id: projectId },
          {
            after: { employeeId: row.employeeId, projectRole: 'CODER', source: 'allocation file' },
          },
        );
      }
      seen.staffed.add(row.employeeId);
    }
    // 2. The Login Name is assigned to that Email ID when it is not already theirs.
    if (!seen.employees.has(row.employeeId)) {
      await this.loginNames.assign(principal, row.employeeId, row.loginName, meta, tx);
      seen.employees.add(row.employeeId);
    }
    const loginName = await tx.loginName.findFirstOrThrow({
      where: {
        organizationId: principal.organizationId,
        value: { equals: row.loginName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    // 3. The chart joins the project's repository (or is updated if it was waiting there).
    const details = { pages: row.pages, pageBucket: row.pageBucket, remarks: row.remarks };
    const chart = row.existingChartId
      ? await tx.chart.update({
          where: { id: row.existingChartId },
          // A stored chart keeps the Pages / Page Bucket / Remarks it was uploaded with unless the row gives new ones.
          data: {
            ...(row.pages !== null ? { pages: row.pages } : {}),
            ...(row.pageBucket !== null ? { pageBucket: row.pageBucket } : {}),
            ...(row.remarks !== null ? { remarks: row.remarks } : {}),
          },
          select: { id: true },
        })
      : await tx.chart.create({
          data: {
            organizationId: principal.organizationId,
            projectId,
            chartRef: row.chartRef,
            createdById: principal.employeeId,
            ...details,
          },
          select: { id: true },
        });
    // 4. Allocation row (guarded by the database), then the chart moves to ALLOCATED.
    await tx.chartAllocation.create({
      data: {
        chartId: chart.id,
        loginNameId: loginName.id,
        employeeId: row.employeeId,
        allocatedById: principal.employeeId,
        source: 'CSV',
      },
    });
    await tx.chart.update({
      where: { id: chart.id },
      data: { status: 'ALLOCATED', allocatedAt: new Date() },
    });
    await logEntityChange(
      log,
      tx,
      principal,
      meta,
      'CHART.ALLOCATED',
      { type: 'Chart', id: chart.id },
      {
        after: { projectId, employeeId: row.employeeId, loginName: row.loginName, source: 'CSV' },
      },
    );
    return chart.id;
  }

  // ───────── pull back / submit to client ─────────

  /** Ends the open allocation of one chart and returns it to the repository. Caller must be in a transaction. */
  private async pullBackChart(
    tx: Tx,
    principal: Principal,
    chart: { id: string; status: string },
    meta: RequestMeta,
    cause: 'MANAGER' | 'CLIENT',
  ): Promise<void> {
    if (chart.status === 'IN_PRODUCTION') {
      // IN_PRODUCTION → ALLOCATED is a legal reallocation step; the allocation ends in between.
      await tx.chart.update({ where: { id: chart.id }, data: { status: 'ALLOCATED' } });
    }
    await tx.chartAllocation.updateMany({
      where: { chartId: chart.id, status: 'ACTIVE' },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        endReason: 'DEALLOCATED',
        endedById: principal.employeeId,
      },
    });
    await tx.chart.update({
      where: { id: chart.id },
      data: {
        status: 'PENDING_ALLOCATION',
        allocatedAt: null,
        workStartedAt: null,
        heldAt: null,
        holdReason: null,
        heldSeconds: 0,
      },
    });
    await logEntityChange(
      { audit: this.audit, activity: this.activity },
      tx,
      principal,
      meta,
      'CHART.DEALLOCATED',
      { type: 'Chart', id: chart.id },
      { after: { cause } },
    );
  }

  /** Manager pulls selected charts back from their coders. Only charts still with a coder can be pulled back. */
  async pullBack(
    principal: Principal,
    projectId: string,
    chartIds: string[],
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<PullbackResult> {
    await this.projects.load(principal, projectId);
    const result = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: reason ?? 'Manager pull-back' },
      async (tx) => {
        const charts = await tx.chart.findMany({
          // A chart the coder has on hold cannot be pulled back (it is skipped, not an error).
          where: {
            projectId,
            id: { in: chartIds },
            status: { in: [...OPEN_CHART_STATUSES] },
            heldAt: null,
          },
          select: { id: true, status: true },
        });
        for (const chart of charts) await this.pullBackChart(tx, principal, chart, meta, 'MANAGER');
        if (charts.length) {
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'PROJECT.CHARTS_PULLED_BACK',
            { type: 'Project', id: projectId },
            { after: { charts: charts.length, reason: reason ?? null } },
          );
        }
        return { pulledBack: charts.length, skipped: chartIds.length - charts.length };
      },
      { timeoutMs: 120_000 },
    );
    return result;
  }

  /**
   * The client pulled the project's charts back: every chart still with a coder returns to the repository and every
   * coder's allotment for this project drops to zero. Work already submitted for audit is not touched.
   */
  async clientPullback(
    principal: Principal,
    projectId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<PullbackResult> {
    await this.projects.load(principal, projectId);
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: `Client pull-back: ${reason}` },
      async (tx) => {
        const charts = await tx.chart.findMany({
          where: { projectId, status: { in: [...OPEN_CHART_STATUSES] } },
          select: { id: true, status: true },
        });
        for (const chart of charts) await this.pullBackChart(tx, principal, chart, meta, 'CLIENT');
        await tx.project.update({ where: { id: projectId }, data: { clientPullbackAt: new Date() } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'PROJECT.CLIENT_PULLBACK',
          { type: 'Project', id: projectId },
          { after: { charts: charts.length, reason } },
        );
        return { pulledBack: charts.length, skipped: 0 };
      },
      { timeoutMs: 120_000 },
    );
  }

  /** Hands finished (COMPLETED) charts back to the client. Charts that are not completed are skipped. */
  async submitToClient(
    principal: Principal,
    projectId: string,
    chartIds: string[] | undefined,
    meta: RequestMeta,
  ): Promise<SubmitToClientResult> {
    await this.projects.load(principal, projectId);
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Submitted to client' },
      async (tx) => {
        const eligible = await tx.chart.findMany({
          where: {
            projectId,
            status: 'COMPLETED',
            submittedToClientAt: null,
            ...(chartIds ? { id: { in: chartIds } } : {}),
          },
          select: { id: true },
        });
        if (eligible.length) {
          await tx.chart.updateMany({
            where: { id: { in: eligible.map((c) => c.id) } },
            data: { submittedToClientAt: new Date(), submittedToClientById: principal.employeeId },
          });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'PROJECT.SUBMITTED_TO_CLIENT',
            { type: 'Project', id: projectId },
            { after: { charts: eligible.length } },
          );
        }
        return {
          submitted: eligible.length,
          skipped: (chartIds?.length ?? eligible.length) - eligible.length,
        };
      },
      { timeoutMs: 60_000 },
    );
  }
}
