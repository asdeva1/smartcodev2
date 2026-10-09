import { z } from 'zod';
import type { Page } from './employees.js';

/**
 * Internal Audit (D-07, draft scope): the Manager independently re-scores a sample of already audited charts to check
 * the quality of the audits themselves. A review AGREES when the independent error count equals the auditor's total.
 */

export const INTERNAL_REVIEW_OUTCOMES = ['AGREE', 'DISAGREE'] as const;
export type InternalReviewOutcome = (typeof INTERNAL_REVIEW_OUTCOMES)[number];

export const internalSampleQuerySchema = z.object({
  projectId: z.uuid().optional(),
  size: z.coerce.number().int().min(1).max(50).default(10),
});
export type InternalSampleQuery = z.infer<typeof internalSampleQuerySchema>;

export const internalReviewCreateSchema = z.object({
  auditId: z.uuid({ error: 'Choose an audit to review' }),
  independentErrors: z.coerce
    .number({ error: 'Enter the number of errors you found' })
    .int()
    .min(0, 'Errors cannot be negative')
    .max(10_000),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type InternalReviewCreate = z.infer<typeof internalReviewCreateSchema>;

export const internalReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  outcome: z.enum(INTERNAL_REVIEW_OUTCOMES).optional(),
});
export type InternalReviewListQuery = z.infer<typeof internalReviewListQuerySchema>;

export interface InternalSampleItem {
  auditId: string;
  chartRef: string;
  project: string;
  coder: string | null;
  auditor: string;
  icds: number;
  dos: number;
  auditorErrors: number;
  auditedAt: string;
}

export interface InternalReviewRecord {
  id: string;
  auditId: string;
  chartRef: string;
  project: string;
  auditor: string;
  reviewer: string;
  auditorErrors: number;
  independentErrors: number;
  outcome: InternalReviewOutcome;
  notes: string | null;
  createdAt: string;
}

export interface InternalAuditorRow {
  auditorId: string;
  auditor: string;
  reviewed: number;
  agreed: number;
  agreementPct: number | null;
  /** Average of (independent − auditor) errors: positive means the auditor missed errors, negative means too strict. */
  averageGap: number | null;
}

export interface InternalAuditSummary {
  reviewed: number;
  agreed: number;
  agreementPct: number | null;
  auditors: InternalAuditorRow[];
}

export type InternalReviewPage = Page<InternalReviewRecord>;
