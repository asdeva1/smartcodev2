/**
 * Business / security audit-log actions (docs/16-security.md, Phase 2 §2.20). The database stores the action as a
 * validated string (`^[A-Z][A-Z0-9_.]*$`); this list is the vocabulary the application writes.
 * Audit-log payloads must never contain credentials, tokens or PHI — the database rejects such keys.
 */
export const AUDIT_ACTIONS = [
  'AUTH.LOGIN',
  'AUTH.LOGIN_FAILED',
  'AUTH.LOGOUT',
  'AUTH.REFRESH_REUSE_DETECTED',
  'AUTH.SESSIONS_REVOKED',
  'AUTH.PASSWORD_RESET_REQUESTED',
  'AUTH.PASSWORD_RESET_COMPLETED',
  'AUTH.PASSWORD_CHANGED',
  'BOOTSTRAP.MANAGER_CREATED',
  'EMPLOYEE.UPDATED',
  'EMPLOYEE.ACTIVATION_SENT',
  'EMPLOYEE.REACTIVATED',
  'EMPLOYEE.IMPORTED',
  'EMPLOYEE.PASSWORD_RESET_TRIGGERED',
  'EMPLOYEE.CREATED',
  'EMPLOYEE.ACTIVATED',
  'EMPLOYEE.ROLE_CHANGED',
  'EMPLOYEE.DEACTIVATED',
  'LOGIN_NAME.ASSIGNED',
  'LOGIN_NAME.ENDED',
  'CHART.ALLOCATED',
  'CHART.REALLOCATED',
  'CHART.DEALLOCATED',
  'PRODUCTION.SUBMITTED',
  'AUDIT.CREATED',
  'AUDIT.RESOLVED',
  'REWORK.CREATED',
  'REWORK.SUBMITTED',
  'REAUDIT.CREATED',
  'VENDOR.ACCESS',
  'PROJECT.STAFF_ASSIGNED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
