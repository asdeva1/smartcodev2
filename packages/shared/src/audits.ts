import { z } from 'zod';

/** Contracts for the audit queue, Manager review and rework (Phase 9). Docs: 09-audit-lifecycle.md. */

const count = z.coerce
  .number({ error: 'Enter a number' })
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(9999, 'Must be at most 9999');

const remarks = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((v) => (v ? v : undefined));

/** Auditor result: PASS completes the chart; REVIEW_REQUIRED sends it to the Manager (never to rework directly). */
export const AUDIT_SUBMIT_RESULTS = ['PASS', 'REVIEW_REQUIRED'] as const;

/** "Audit Errors" and "Error Exceptions" are separate (D-11); Total Errors is computed by the server. */
export const auditSubmitSchema = z.object({
  auditErrors: count,
  errorExceptions: count,
  result: z.enum(AUDIT_SUBMIT_RESULTS),
  remarks,
});
export type AuditSubmit = z.infer<typeof auditSubmitSchema>;

/** The Manager's decision on a REVIEW_REQUIRED audit. A reason is required to reject. */
export const auditResolveSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.decision === 'APPROVED' || v.reason !== undefined, {
    path: ['reason'],
    message: 'Give a reason when you send a chart back for rework',
  });
export type AuditResolve = z.infer<typeof auditResolveSchema>;

export interface ProjectRef {
  id: string;
  name: string;
  client: string;
}

/** One chart waiting for the auditor. Production figures are read-only. */
export interface AuditQueueItem {
  id: string;
  chartId: string;
  status: string;
  project: ProjectRef;
  coder: string;
  loginName: string;
  pages: number | null;
  icds: number;
  dos: number;
  codedAt: string;
  isReAudit: boolean;
  version: number;
}

export interface AuditQueue {
  total: number;
  items: AuditQueueItem[];
}

export interface AuditSubmitted {
  chartId: string;
  auditId: string;
  result: (typeof AUDIT_SUBMIT_RESULTS)[number];
  chartStatus: string;
  auditErrors: number;
  errorExceptions: number;
  totalErrors: number;
}

/** A REVIEW_REQUIRED audit waiting for the Manager. */
export interface ReviewItem {
  auditId: string;
  id: string;
  chartId: string;
  project: ProjectRef;
  coder: string;
  auditor: string;
  pages: number | null;
  icds: number;
  dos: number;
  auditErrors: number;
  errorExceptions: number;
  totalErrors: number;
  remarks: string | null;
  auditedAt: string;
  isReAudit: boolean;
}

export interface ReviewQueue {
  total: number;
  items: ReviewItem[];
}

export interface AuditResolved {
  chartId: string;
  auditId: string;
  decision: 'APPROVED' | 'REJECTED';
  chartStatus: string;
}

/** A rework assigned to the coder. */
export interface ReworkItem {
  id: string;
  chartId: string;
  chart: string;
  status: string;
  reason: string;
  project: ProjectRef;
  pages: number | null;
  previousIcds: number;
  previousDos: number;
  assignedAt: string;
}

export interface ReworkList {
  total: number;
  items: ReworkItem[];
}

export const reworkSubmitSchema = z.object({ icds: count, dos: count });
export type ReworkSubmit = z.infer<typeof reworkSubmitSchema>;

export interface ReworkSubmitted {
  chartId: string;
  status: string;
  icds: number;
  dos: number;
}
