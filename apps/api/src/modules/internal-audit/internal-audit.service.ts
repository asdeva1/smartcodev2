import { Injectable } from '@nestjs/common';
import type {
  InternalAuditSummary,
  InternalReviewCreate,
  InternalReviewListQuery,
  InternalReviewPage,
  InternalReviewRecord,
  InternalSampleItem,
  InternalSampleQuery,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { logEntityChange } from '../organization/entity-log';

/** Audits that are final: passed, or a review that the Manager approved. Others are still moving. */
const FINAL_STATUSES = ['PASSED', 'APPROVED'] as const;

const AUDIT_INCLUDE = {
  chart: { select: { chartRef: true, project: { select: { name: true } } } },
  auditor: { select: { fullName: true } },
  productionEntry: { select: { icds: true, dos: true, coder: { select: { fullName: true } } } },
} as const;

const REVIEW_INCLUDE = {
  reviewer: { select: { fullName: true } },
  audit: { select: { auditor: { select: { fullName: true } }, chart: AUDIT_INCLUDE.chart } },
} as const;
type ReviewRow = Prisma.InternalAuditReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

function toRecord(r: ReviewRow): InternalReviewRecord {
  return {
    id: r.id,
    auditId: r.auditId,
    chartRef: r.audit.chart.chartRef,
    project: r.audit.chart.project.name,
    auditor: r.audit.auditor.fullName,
    reviewer: r.reviewer.fullName,
    auditorErrors: r.auditorErrors,
    independentErrors: r.independentErrors,
    outcome: r.outcome,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Internal Audit (draft scope, D-07): the Manager draws a random sample of audited charts, re-scores them
 * independently and records the result. The agreement rate per auditor shows who needs coaching.
 */
@Injectable()
export class InternalAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  /** A random sample of final audits that have not been reviewed yet. */
  async sample(principal: Principal, q: InternalSampleQuery): Promise<InternalSampleItem[]> {
    const rows = await this.prisma.client.audit.findMany({
      where: {
        status: { in: [...FINAL_STATUSES] },
        internalReview: { is: null },
        chart: {
          is: {
            organizationId: principal.organizationId,
            ...(q.projectId ? { projectId: q.projectId } : {}),
          },
        },
      },
      orderBy: { auditedAt: 'desc' },
      take: 500,
      include: AUDIT_INCLUDE,
    });
    // Fisher–Yates on the most recent 500, so the sample is random but never reaches far back.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
    return rows.slice(0, q.size).map((a) => ({
      auditId: a.id,
      chartRef: a.chart.chartRef,
      project: a.chart.project.name,
      coder: a.productionEntry.coder.fullName,
      auditor: a.auditor.fullName,
      icds: a.productionEntry.icds,
      dos: a.productionEntry.dos,
      auditorErrors: a.totalErrors,
      auditedAt: a.auditedAt.toISOString(),
    }));
  }

  async create(
    principal: Principal,
    input: InternalReviewCreate,
    meta: RequestMeta,
  ): Promise<InternalReviewRecord> {
    const audit = await this.prisma.client.audit.findFirst({
      where: { id: input.auditId, chart: { is: { organizationId: principal.organizationId } } },
      select: { id: true, status: true, totalErrors: true, internalReview: { select: { id: true } } },
    });
    if (!audit) throw new ProblemException(404, 'NOT_FOUND', 'Audit not found');
    if (!(FINAL_STATUSES as readonly string[]).includes(audit.status)) {
      throw new ProblemException(409, 'CONFLICT', 'Only a finished audit can be reviewed');
    }
    if (audit.internalReview) {
      throw new ProblemException(409, 'CONFLICT', 'This audit has already been reviewed');
    }
    const id = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Internal audit review' },
      async (tx) => {
        const row = await tx.internalAuditReview.create({
          data: {
            organizationId: principal.organizationId,
            auditId: audit.id,
            reviewerId: principal.employeeId,
            auditorErrors: audit.totalErrors,
            independentErrors: input.independentErrors,
            outcome: audit.totalErrors === input.independentErrors ? 'AGREE' : 'DISAGREE',
            notes: input.notes ?? null,
          },
        });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'INTERNAL_AUDIT.REVIEWED',
          { type: 'InternalAuditReview', id: row.id },
          { after: { auditId: audit.id, outcome: row.outcome } },
        );
        return row.id;
      },
    );
    const row = await this.prisma.client.internalAuditReview.findUniqueOrThrow({
      where: { id },
      include: REVIEW_INCLUDE,
    });
    return toRecord(row);
  }

  async list(principal: Principal, q: InternalReviewListQuery): Promise<InternalReviewPage> {
    const where: Prisma.InternalAuditReviewWhereInput = {
      organizationId: principal.organizationId,
      ...(q.outcome ? { outcome: q.outcome } : {}),
    };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.internalAuditReview.count({ where }),
      this.prisma.client.internalAuditReview.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: REVIEW_INCLUDE,
      }),
    ]);
    return { items: rows.map(toRecord), page: q.page, pageSize: q.pageSize, total };
  }

  async summary(principal: Principal): Promise<InternalAuditSummary> {
    const rows = await this.prisma.client.internalAuditReview.findMany({
      where: { organizationId: principal.organizationId },
      select: {
        outcome: true,
        auditorErrors: true,
        independentErrors: true,
        audit: { select: { auditorId: true, auditor: { select: { fullName: true } } } },
      },
    });
    const by = new Map<string, { name: string; n: number; agreed: number; gap: number }>();
    for (const r of rows) {
      const entry = by.get(r.audit.auditorId) ?? { name: r.audit.auditor.fullName, n: 0, agreed: 0, gap: 0 };
      entry.n += 1;
      if (r.outcome === 'AGREE') entry.agreed += 1;
      entry.gap += r.independentErrors - r.auditorErrors;
      by.set(r.audit.auditorId, entry);
    }
    const agreed = rows.filter((r) => r.outcome === 'AGREE').length;
    return {
      reviewed: rows.length,
      agreed,
      agreementPct: pct(agreed, rows.length),
      auditors: [...by.entries()]
        .map(([auditorId, e]) => ({
          auditorId,
          auditor: e.name,
          reviewed: e.n,
          agreed: e.agreed,
          agreementPct: pct(e.agreed, e.n),
          averageGap: Math.round((e.gap / e.n) * 10) / 10,
        }))
        .sort((a, b) => (a.agreementPct ?? 101) - (b.agreementPct ?? 101)),
    };
  }
}
