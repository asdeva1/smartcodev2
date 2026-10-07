import type { ErrorCode } from '@smartcode/shared';

/**
 * Business-rule violations raised by PostgreSQL triggers carry a custom SQLSTATE (docs/02 §9):
 *   SC403 role not allowed · SC409 wrong state / immutable history · SC422 reference or eligibility rule.
 * Prisma surfaces them as "Database error. Code: `SC403`. Message: `SC403: only an active Manager …`".
 * The messages are written to be safe and meaningful for API clients; everything else is never forwarded.
 */
export interface DatabaseRuleViolation {
  status: 403 | 409 | 422;
  code: ErrorCode;
  detail: string;
}

const RULE = /\b(SC403|SC409|SC422)\b:\s*([^`\n]+)/;

function textOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const e = error as { message?: unknown; meta?: unknown; cause?: unknown };
  const parts = [typeof e.message === 'string' ? e.message : ''];
  if (e.meta) parts.push(JSON.stringify(e.meta));
  if (e.cause) parts.push(textOf(e.cause));
  return parts.join(' ');
}

export function parseDatabaseRuleViolation(error: unknown): DatabaseRuleViolation | null {
  const match = RULE.exec(textOf(error));
  if (!match) return null;
  const detail = (match[2] ?? '').trim();
  switch (match[1]) {
    case 'SC403':
      return { status: 403, code: 'FORBIDDEN', detail };
    case 'SC409':
      return {
        status: 409,
        code: /already been resolved/i.test(detail) ? 'AUDIT_ALREADY_RESOLVED' : 'CONFLICT',
        detail,
      };
    default:
      return { status: 422, code: 'VALIDATION_FAILED', detail };
  }
}
