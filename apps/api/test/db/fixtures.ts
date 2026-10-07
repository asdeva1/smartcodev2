import { randomBytes } from 'node:crypto';
import type { Role } from '@smartcode/shared';
import type { TestDb } from './harness';

/**
 * Synthetic fixtures only (D-05). Rows are created through Prisma exactly as the application will, so the
 * generated client, the schema and the migrations are exercised together.
 */
export class Fixtures {
  organizationId = '';
  private seq = 0;

  constructor(private readonly db: TestDb) {}

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq.toString().padStart(3, '0')}${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  async org(): Promise<string> {
    const org = await this.db.prisma.organization.create({
      data: { name: 'Test Org', slug: `org-${randomBytes(4).toString('hex')}` },
    });
    this.organizationId = org.id;
    return org.id;
  }

  /** Creates the employee WITHOUT a password (PENDING_ACTIVATION) and, by default, activates them. */
  async employee(
    input: { role?: Role; vendorId?: string | null; active?: boolean; code?: string; email?: string } = {},
  ) {
    const code = input.code ?? this.next('EMP');
    const employee = await this.db.prisma.employee.create({
      data: {
        organizationId: this.organizationId,
        employeeCode: code,
        fullName: `Synthetic ${code}`,
        email: input.email ?? `${code.toLowerCase()}@example.test`,
        role: input.role ?? 'CODER',
        vendorId: input.vendorId ?? null,
      },
    });
    if (input.active === false) return employee;
    return this.db.prisma.employee.update({
      where: { id: employee.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
  }

  manager() {
    return this.employee({ role: 'MANAGER' });
  }

  vendor(name?: string) {
    const n = name ?? this.next('Vendor');
    return this.db.prisma.vendor.create({
      data: { organizationId: this.organizationId, code: n.toUpperCase(), name: n },
    });
  }

  client(name?: string) {
    return this.db.prisma.client.create({
      data: { organizationId: this.organizationId, name: name ?? this.next('Client') },
    });
  }

  async project(input: { vendorId?: string | null; clientId?: string; name?: string } = {}) {
    const clientId = input.clientId ?? (await this.client()).id;
    return this.db.prisma.project.create({
      data: {
        organizationId: this.organizationId,
        clientId,
        name: input.name ?? this.next('Project'),
        vendorId: input.vendorId ?? null,
      },
    });
  }

  loginName(value?: string) {
    return this.db.prisma.loginName.create({
      data: { organizationId: this.organizationId, value: value ?? this.next('SCLN') },
    });
  }

  assignLoginName(loginNameId: string, employeeId: string, assignedById: string) {
    return this.db.prisma.loginNameAssignment.create({ data: { loginNameId, employeeId, assignedById } });
  }

  assignProject(projectId: string, employeeId: string, projectRole: Role, assignedById: string) {
    return this.db.prisma.projectAssignment.create({
      data: {
        projectId,
        employeeId,
        projectRole: projectRole as 'TEAM_LEAD' | 'AUDITOR' | 'CODER' | 'GROUP_COACH',
        assignedById,
      },
    });
  }

  chart(projectId: string, chartRef?: string) {
    return this.db.prisma.chart.create({
      data: { organizationId: this.organizationId, projectId, chartRef: chartRef ?? this.next('CHART') },
    });
  }

  /** Manager, in-house project, an in-house coder with a login name and the project assignment. */
  async workspace() {
    const organizationId = await this.org();
    const manager = await this.manager();
    const project = await this.project();
    const coder = await this.employee({ role: 'CODER' });
    const auditor = await this.employee({ role: 'AUDITOR' });
    const loginName = await this.loginName();
    await this.assignLoginName(loginName.id, coder.id, manager.id);
    await this.assignProject(project.id, coder.id, 'CODER', manager.id);
    await this.assignProject(project.id, auditor.id, 'AUDITOR', manager.id);
    const chart = await this.chart(project.id);
    return { organizationId, manager, project, coder, auditor, loginName, chart };
  }

  allocate(
    chartId: string,
    loginNameId: string,
    employeeId: string,
    allocatedById: string,
    source: 'MANUAL' | 'CSV' | 'AUTOMATIC' = 'MANUAL',
  ) {
    return this.db.prisma.chartAllocation.create({
      data: { chartId, loginNameId, employeeId, allocatedById, source },
    });
  }

  setChartStatus(
    chartId: string,
    status: Parameters<TestDb['prisma']['chart']['update']>[0]['data']['status'],
  ) {
    return this.db.prisma.chart.update({ where: { id: chartId }, data: { status } });
  }

  /** Allocates the chart and moves it to ALLOCATED. */
  async allocated() {
    const w = await this.workspace();
    const allocation = await this.allocate(w.chart.id, w.loginName.id, w.coder.id, w.manager.id);
    await this.setChartStatus(w.chart.id, 'ALLOCATED');
    return { ...w, allocation };
  }

  /** Coder submits version 1 → chart CODED → PENDING_AUDIT. */
  async submitted() {
    const a = await this.allocated();
    await this.setChartStatus(a.chart.id, 'IN_PRODUCTION');
    const production = await this.db.prisma.productionEntry.create({
      data: {
        chartId: a.chart.id,
        coderId: a.coder.id,
        loginNameId: a.loginName.id,
        allocationId: a.allocation.id,
        pageCount: 12,
        icds: 5,
        dos: 2,
      },
    });
    const now = new Date();
    const submitted = await this.db.prisma.productionEntry.update({
      where: { id: production.id },
      data: { status: 'SUBMITTED', submittedAt: now, codedAt: now },
    });
    await this.setChartStatus(a.chart.id, 'CODED');
    await this.setChartStatus(a.chart.id, 'PENDING_AUDIT');
    return { ...a, production: submitted };
  }

  /** An audit the auditor has started but not submitted. */
  async auditInProgress(s: Awaited<ReturnType<Fixtures['submitted']>>) {
    return this.db.prisma.audit.create({
      data: {
        chartId: s.chart.id,
        productionEntryId: s.production.id,
        auditorId: s.auditor.id,
        auditErrors: 1,
        errorExceptions: 1,
      },
    });
  }

  /** Auditor submits REVIEW_REQUIRED → chart REVIEW_REQUIRED. */
  async reviewRequired() {
    const s = await this.submitted();
    const audit = await this.db.prisma.audit.create({
      data: {
        chartId: s.chart.id,
        productionEntryId: s.production.id,
        auditorId: s.auditor.id,
        auditErrors: 3,
        errorExceptions: 1,
        result: 'REVIEW_REQUIRED',
        status: 'REVIEW_REQUIRED',
        remarks: 'Synthetic findings',
      },
    });
    await this.setChartStatus(s.chart.id, 'REVIEW_REQUIRED');
    return { ...s, audit };
  }

  /** Manager rejects → REWORK created → chart REWORK. */
  async rejected() {
    const r = await this.reviewRequired();
    await this.db.prisma.auditResolution.create({
      data: {
        auditId: r.audit.id,
        decision: 'REJECTED',
        reason: 'Synthetic: code assignment incorrect',
        resolvedById: r.manager.id,
      },
    });
    const rework = await this.db.prisma.rework.create({
      data: {
        chartId: r.chart.id,
        auditId: r.audit.id,
        productionEntryId: r.production.id,
        assignedCoderId: r.coder.id,
        reason: 'Synthetic: code assignment incorrect',
        createdById: r.manager.id,
      },
    });
    await this.setChartStatus(r.chart.id, 'REWORK');
    return { ...r, rework };
  }

  /** Coder submits the corrected version 2 (v1 superseded) → chart RE_AUDIT. */
  async reworked() {
    const r = await this.rejected();
    await this.db.prisma.productionEntry.update({
      where: { id: r.production.id },
      data: { status: 'SUPERSEDED', isCurrent: false },
    });
    const v2 = await this.db.prisma.productionEntry.create({
      data: {
        chartId: r.chart.id,
        coderId: r.coder.id,
        loginNameId: r.loginName.id,
        allocationId: r.allocation.id,
        reworkId: r.rework.id,
        pageCount: 12,
        icds: 6,
        dos: 2,
      },
    });
    const now = new Date();
    const production2 = await this.db.prisma.productionEntry.update({
      where: { id: v2.id },
      data: { status: 'SUBMITTED', submittedAt: now, codedAt: now },
    });
    await this.db.prisma.rework.update({
      where: { id: r.rework.id },
      data: { status: 'SUBMITTED', completedAt: now },
    });
    await this.setChartStatus(r.chart.id, 'RE_AUDIT');
    return { ...r, production2 };
  }
}
