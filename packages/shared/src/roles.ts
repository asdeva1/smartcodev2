/**
 * Roles (docs/03-rbac-matrix.md). Stored as a PostgreSQL enum; permissions are code.
 * Vendor staff use TEAM_LEAD / AUDITOR / CODER with a vendorId; their scope is intersected with their vendor.
 */
export const ROLES = [
  'MANAGER',
  'HR',
  'GROUP_COACH',
  'TEAM_LEAD',
  'AUDITOR',
  'CODER',
  'VENDOR_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  MANAGER: 'Manager',
  HR: 'HR',
  GROUP_COACH: 'Group Coach / SME',
  TEAM_LEAD: 'Team Lead',
  AUDITOR: 'Auditor',
  CODER: 'Coder',
  VENDOR_ADMIN: 'Vendor Admin',
};

/** Roles a Vendor Admin may create inside their own vendor. */
export const VENDOR_STAFF_ROLES: readonly Role[] = ['TEAM_LEAD', 'AUDITOR', 'CODER'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
