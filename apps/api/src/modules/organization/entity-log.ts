import type { AuditAction } from '@smartcode/shared';
import type { ActivityLogService } from '../../core/audit/activity-log.service';
import type { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import type { Tx } from '../../core/prisma/actor-transaction';

/**
 * Writes the security audit entry and the human-readable activity entry for one change, inside the same
 * transaction as the change itself. Payloads carry identifiers and plain field values only.
 */
export async function logEntityChange(
  services: { audit: AuditLogService; activity: ActivityLogService },
  tx: Tx,
  principal: Principal,
  meta: RequestMeta,
  action: AuditAction,
  entity: { type: string; id: string },
  detail: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
): Promise<void> {
  await services.audit.record(
    {
      organizationId: principal.organizationId,
      actorId: principal.employeeId,
      actorRole: principal.role,
      action,
      entityType: entity.type,
      entityId: entity.id,
      ...(detail.before ? { before: detail.before } : {}),
      ...(detail.after ? { after: detail.after } : {}),
      ipAddress: meta.ip,
      requestId: meta.requestId,
    },
    tx,
  );
  await services.activity.record(
    {
      organizationId: principal.organizationId,
      actorId: principal.employeeId,
      action,
      entityType: entity.type,
      entityId: entity.id,
    },
    tx,
  );
}

/** True for a PostgreSQL unique-constraint violation surfaced by Prisma (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
