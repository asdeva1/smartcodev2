import { z } from 'zod';
import type { Page } from './employees.js';

/** Audit log (Manager) and Activity log (everyone, limited to their own scope). */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-09');
const optionalText = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => (v ? v : undefined));
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const auditLogQuerySchema = z.object({
  ...pagination,
  /** Matches the start of the action, e.g. `CHART` or `AUTH.LOGIN`. */
  action: optionalText,
  entityType: optionalText,
  actorId: z.uuid().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const activityLogQuerySchema = z.object({
  ...pagination,
  action: optionalText,
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>;

export interface LogActor {
  id: string;
  fullName: string;
  role: string | null;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  actor: LogActor | null;
  ipAddress: string | null;
  requestId: string | null;
  /** What changed, already screened by the database for secrets and PHI. */
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface ActivityLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: LogActor | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AuditLogPage = Page<AuditLogRecord>;
export type ActivityLogPage = Page<ActivityLogRecord>;
