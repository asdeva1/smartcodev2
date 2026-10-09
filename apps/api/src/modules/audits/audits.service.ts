import { Injectable } from '@nestjs/common';
import type {
  AuditQueue,
  AuditResolve,
  AuditResolved,
  AuditSubmit,
  AuditSubmitted,
  ReviewQueue,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createNotification } from '../notifications/notifications.service';
import { logEntityChange } from '../organization/entity-log';
import { projectScopeWhere } from '../projects/project-scope';

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Chart not found');

const chartInclude = {
  project: { select: { id: true, name: true, vendorId: true, client: { select: { name: true } } } },
  production: {
    where: { isCurrent: true },
    include: {
      coder: { select: { id: true, fullName: true } },
      loginName: { select: { value: true } },
    },
  },
} as const;

/**
 * Audit queue and Manager review (docs/09). Every coded chart is audited (D-02). The Auditor passes it or sends it
 * to the Manager; only the Manager resolves a review (D-01) — approve completes the chart, reject creates a rework.
 * The database enforces the same rules again, so a bug here can never put a chart in an impossible state.
 */
@Injectable()
export class AuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Charts of the auditor's projects waiting for audit or re-audit; never charts they coded themselves. */
  async queue(principal: Principal): Promise<AuditQueue> {
    const charts = await this.prisma.client.chart.findMany({
      where: {
        status: { in: ['PENDING_AUDIT', 'RE_AUDIT'] },
        project: {
          ...projectScopeWhere(principal),
          ...(principal.vendorId ? { vendorId: principal.vendorId } : {}),
        },
        production: { none: { isCurrent: true, coderId: principal.employeeId } },
      },
      include: chartInclude,
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    const items = charts.flatMap((c) => {
      const p = c.production[0];
      if (!p) return [];
      return [
        {
          id: c.id,
          chartId: c.chartRef,
          status: c.status,
          project: { id: c.project.id, name: c.project.name, client: c.project.client.name },
          coder: p.coder.fullName,
          loginName: p.loginName.value,
          pages: c.pages,
          icds: p.icds,
          dos: p.dos,
          codedAt: (p.submittedAt ?? p.createdAt).toISOString(),
          isReAudit: c.status === 'RE_AUDIT',
          version: p.version,
        },
      ];
    });
    return { total: items.length, items };
  }

  async submit(
    principal: Principal,
    chartId: string,
    input: AuditSubmit,
    meta: RequestMeta,
  ): Promise<AuditSubmitted> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Audit submitted' },
      async (tx) => {
        const chart = await tx.chart.findFirst({
          where: {
            id: chartId,
            project: {
              ...projectScopeWhere(principal),
              ...(principal.vendorId ? { vendorId: principal.vendorId } : {}),
            },
          },
          include: chartInclude,
        });
        const current = chart?.production[0];
        if (!chart || !current) throw notFound();
        if (current.coderId === principal.employeeId) throw notFound(); // never your own work
        if (chart.status !== 'PENDING_AUDIT' && chart.status !== 'RE_AUDIT') {
          throw new ProblemException(409, 'INVALID_TRANSITION', 'This chart is not waiting for audit');
        }
        const reAudit = chart.status === 'RE_AUDIT';

        const created = await tx.audit.create({
          data: {
            chartId,
            productionEntryId: current.id,
            auditorId: principal.employeeId,
            auditErrors: input.auditErrors,
            errorExceptions: input.errorExceptions,
          },
          select: { id: true },
        });
        const pass = input.result === 'PASS';
        const submitted = await tx.audit.update({
          where: { id: created.id },
          data: {
            result: input.result,
            status: pass ? 'PASSED' : 'REVIEW_REQUIRED',
            remarks: input.remarks ?? null,
            auditedAt: new Date(),
          },
          select: { totalErrors: true },
        });

        // The rework that produced this version is finished once its re-audit is done.
        if (reAudit && current.reworkId) {
          await tx.rework.update({
            where: { id: current.reworkId },
            data: { status: 'CLOSED' },
          });
        }

        let chartStatus: string;
        if (pass) {
          await tx.chart.update({
            where: { id: chartId },
            data: { status: 'AUDITED', auditedAt: new Date() },
          });
          await tx.chart.update({
            where: { id: chartId },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          chartStatus = 'COMPLETED';
        } else {
          await tx.chart.update({
            where: { id: chartId },
            data: { status: 'REVIEW_REQUIRED', auditedAt: new Date() },
          });
          chartStatus = 'REVIEW_REQUIRED';
        }

        // The coder is told as soon as an audit finds errors in their chart.
        if (submitted.totalErrors > 0) {
          await createNotification(tx, {
            organizationId: principal.organizationId,
            recipientId: current.coderId,
            type: 'AUDIT_ERRORS',
            subject: `Audit errors on chart ${chart.chartRef}`,
            message: `${submitted.totalErrors} error${submitted.totalErrors === 1 ? '' : 's'} found (${input.auditErrors} audit, ${input.errorExceptions} exception).`,
            entityType: 'Chart',
            entityId: chartId,
          });
        }

        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          reAudit ? 'REAUDIT.CREATED' : 'AUDIT.CREATED',
          { type: 'Chart', id: chartId },
          {
            after: {
              result: input.result,
              auditErrors: input.auditErrors,
              errorExceptions: input.errorExceptions,
              totalErrors: submitted.totalErrors,
            },
          },
        );
        return {
          chartId: chart.chartRef,
          auditId: created.id,
          result: input.result,
          chartStatus,
          auditErrors: input.auditErrors,
          errorExceptions: input.errorExceptions,
          totalErrors: submitted.totalErrors,
        };
      },
    );
  }

  /** Manager: audits waiting for a decision. */
  async reviews(principal: Principal): Promise<ReviewQueue> {
    const audits = await this.prisma.client.audit.findMany({
      where: { status: 'REVIEW_REQUIRED', chart: { organizationId: principal.organizationId } },
      include: {
        auditor: { select: { fullName: true } },
        chart: { include: chartInclude },
        productionEntry: { include: { coder: { select: { fullName: true } } } },
      },
      orderBy: { auditedAt: 'asc' },
      take: 200,
    });
    const items = audits.map((a) => ({
      auditId: a.id,
      id: a.chartId,
      chartId: a.chart.chartRef,
      project: {
        id: a.chart.project.id,
        name: a.chart.project.name,
        client: a.chart.project.client.name,
      },
      coder: a.productionEntry.coder.fullName,
      auditor: a.auditor.fullName,
      pages: a.chart.pages,
      icds: a.productionEntry.icds,
      dos: a.productionEntry.dos,
      auditErrors: a.auditErrors,
      errorExceptions: a.errorExceptions,
      totalErrors: a.totalErrors,
      remarks: a.remarks,
      auditedAt: a.auditedAt.toISOString(),
      isReAudit: a.isReAudit,
    }));
    return { total: items.length, items };
  }

  /** Manager decision. Approve → chart COMPLETED. Reject (reason required) → chart REWORK + rework for the coder. */
  async resolve(
    principal: Principal,
    auditId: string,
    input: AuditResolve,
    meta: RequestMeta,
  ): Promise<AuditResolved> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Manager review' },
      async (tx) => {
        const audit = await tx.audit.findFirst({
          where: { id: auditId, chart: { organizationId: principal.organizationId } },
          include: { chart: { select: { id: true, chartRef: true } }, productionEntry: true },
        });
        if (!audit) throw new ProblemException(404, 'NOT_FOUND', 'Audit not found');
        if (audit.status === 'APPROVED' || audit.status === 'REJECTED') {
          throw new ProblemException(409, 'AUDIT_ALREADY_RESOLVED', 'This audit has already been resolved');
        }
        if (audit.status !== 'REVIEW_REQUIRED') {
          throw new ProblemException(
            409,
            'INVALID_TRANSITION',
            'Only audits sent for review can be resolved',
          );
        }
        if (audit.auditorId === principal.employeeId) {
          throw new ProblemException(403, 'FORBIDDEN', 'You cannot resolve a review you performed yourself');
        }

        await tx.auditResolution.create({
          data: {
            auditId,
            decision: input.decision,
            reason: input.reason ?? null,
            resolvedById: principal.employeeId,
          },
        });

        if (input.decision === 'APPROVED') {
          await tx.chart.update({
            where: { id: audit.chartId },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
        } else {
          await tx.rework.create({
            data: {
              chartId: audit.chartId,
              auditId,
              productionEntryId: audit.productionEntryId,
              assignedCoderId: audit.productionEntry.coderId,
              reason: input.reason ?? '',
              createdById: principal.employeeId,
            },
          });
          await tx.chart.update({
            where: { id: audit.chartId },
            data: { status: 'REWORK', reworkCycle: { increment: 1 } },
          });
        }

        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'AUDIT.RESOLVED',
          { type: 'Audit', id: auditId },
          { after: { decision: input.decision, ...(input.reason ? { reason: input.reason } : {}) } },
        );
        if (input.decision === 'REJECTED') {
          await createNotification(tx, {
            organizationId: principal.organizationId,
            recipientId: audit.productionEntry.coderId,
            type: 'REWORK_ASSIGNED',
            subject: `Rework needed on chart ${audit.chart.chartRef}`,
            message: input.reason ?? 'The Manager sent this chart back for correction.',
            entityType: 'Chart',
            entityId: audit.chartId,
          });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'REWORK.CREATED',
            { type: 'Chart', id: audit.chartId },
            { after: { assignedCoderId: audit.productionEntry.coderId } },
          );
        }
        return {
          chartId: audit.chart.chartRef,
          auditId,
          decision: input.decision,
          chartStatus: input.decision === 'APPROVED' ? 'COMPLETED' : 'REWORK',
        };
      },
    );
  }
}
