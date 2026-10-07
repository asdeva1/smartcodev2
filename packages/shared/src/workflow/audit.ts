import { WorkflowError } from '../errors.js';
import type { Role } from '../roles.js';
import type { AuditResult, AuditStatus, ResolutionDecision } from '../statuses.js';

/** Audit record state after the auditor submits a result. */
export function auditStatusForResult(result: AuditResult): AuditStatus {
  return result === 'PASS' ? 'PASSED' : 'REVIEW_REQUIRED';
}

export interface ResolveReviewInput {
  actorRole: Role;
  actorEmployeeId: string;
  auditorEmployeeId: string;
  auditStatus: AuditStatus;
  decision: ResolutionDecision;
  reason?: string | null;
}

/**
 * D-01 — only a MANAGER resolves REVIEW_REQUIRED, never the auditor who raised it.
 * Team Lead, Group Coach/SME, Auditor, Coder, Vendor Admin and HR are FORBIDDEN (API → 403).
 * Returns the resulting audit status.
 */
export function assertCanResolveReview(
  input: ResolveReviewInput,
): Extract<AuditStatus, 'APPROVED' | 'REJECTED'> {
  if (input.actorRole !== 'MANAGER') {
    throw new WorkflowError('FORBIDDEN', 'Only a Manager can resolve a review');
  }
  if (input.actorEmployeeId === input.auditorEmployeeId) {
    throw new WorkflowError('FORBIDDEN', 'An auditor cannot resolve their own review decision');
  }
  if (input.auditStatus === 'APPROVED' || input.auditStatus === 'REJECTED') {
    throw new WorkflowError('AUDIT_ALREADY_RESOLVED', 'This audit has already been resolved');
  }
  if (input.auditStatus !== 'REVIEW_REQUIRED') {
    throw new WorkflowError(
      'INVALID_TRANSITION',
      `Only REVIEW_REQUIRED audits can be resolved (was ${input.auditStatus})`,
    );
  }
  if (input.decision === 'REJECTED' && !input.reason?.trim()) {
    throw new WorkflowError('INVALID_TRANSITION', 'A reason is required when rejecting');
  }
  return input.decision;
}

/** D-11 — Total Errors is always Audit Errors + Error Exceptions (both kept as separate values). */
export function totalErrors(auditErrors: number, errorExceptions: number): number {
  for (const [name, value] of [
    ['auditErrors', auditErrors],
    ['errorExceptions', errorExceptions],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative integer`);
    }
  }
  return auditErrors + errorExceptions;
}
