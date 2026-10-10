import type { Role } from './roles.js';

/**
 * Permission catalogue and role → permission → scope matrix (docs/03-rbac-matrix.md).
 * This is the single definition used by the API (guards + scope layer) and the web app (navigation).
 * The API always re-checks; the web app only uses it to show or hide UI.
 */
export const PERMISSIONS = [
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.deactivate',
  'employee.changeRole',
  'employee.sendActivation',
  'employee.triggerPasswordReset',
  'loginName.read',
  'loginName.assign',
  'vendor.manage',
  'vendor.read',
  'team.manage',
  'team.read',
  'client.manage',
  'project.manage',
  'project.read',
  'project.assignStaff',
  'chart.import',
  'chart.read',
  'chart.allocate',
  'production.submit',
  'production.read',
  'audit.perform',
  'audit.read',
  'audit.resolveReview',
  'rework.read',
  'rework.perform',
  'dashboard.manager',
  'dashboard.vendor',
  'dashboard.teamLead',
  'dashboard.groupCoach',
  'dashboard.auditor',
  'dashboard.coder',
  'report.read',
  'report.hr',
  'approval.decide',
  'notification.read',
  'auditLog.read',
  'activityLog.read',
  'settings.manage',
  'system.admin',
  'visitor.manage',
  'internalAudit.access',
  'hrIntegration.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * ORG      organization-wide
 * VENDOR   own vendor only
 * TEAM     own team(s)
 * PROJECT  assigned projects
 * SELF     own records only
 */
export const SCOPES = ['ORG', 'VENDOR', 'TEAM', 'PROJECT', 'SELF'] as const;
export type Scope = (typeof SCOPES)[number];

type Grants = Partial<Record<Permission, Scope>>;

const MANAGER: Grants = Object.fromEntries(
  PERMISSIONS.filter(
    // Managers do not code, audit or perform rework; they hold every other permission organization-wide.
    (p) => !['production.submit', 'audit.perform', 'rework.perform'].includes(p),
  ).map((p) => [p, 'ORG' as const]),
);

export const RBAC_MATRIX: Readonly<Record<Role, Grants>> = {
  MANAGER,
  HR: {
    'employee.read': 'ORG',
    'employee.update': 'ORG',
    'team.read': 'ORG',
    'report.hr': 'ORG',
    'activityLog.read': 'ORG',
    'notification.read': 'SELF',
    'visitor.manage': 'ORG',
    'hrIntegration.read': 'ORG',
  },
  GROUP_COACH: {
    'employee.read': 'PROJECT',
    'loginName.read': 'PROJECT',
    'team.read': 'PROJECT',
    'project.read': 'PROJECT',
    'chart.read': 'PROJECT',
    'production.read': 'PROJECT',
    'audit.read': 'PROJECT',
    'rework.read': 'PROJECT',
    'dashboard.groupCoach': 'PROJECT',
    'report.read': 'PROJECT',
    'activityLog.read': 'PROJECT',
    'notification.read': 'SELF',
  },
  TEAM_LEAD: {
    'employee.read': 'TEAM',
    'loginName.read': 'TEAM',
    'team.read': 'TEAM',
    'project.read': 'PROJECT',
    'chart.read': 'TEAM',
    'production.read': 'TEAM',
    'audit.read': 'TEAM',
    'rework.read': 'TEAM',
    'dashboard.teamLead': 'TEAM',
    'report.read': 'TEAM',
    'activityLog.read': 'TEAM',
    'notification.read': 'SELF',
  },
  AUDITOR: {
    'loginName.read': 'PROJECT',
    'project.read': 'PROJECT',
    'chart.read': 'PROJECT',
    'production.read': 'PROJECT',
    'audit.perform': 'PROJECT',
    'audit.read': 'PROJECT',
    'rework.read': 'PROJECT',
    'dashboard.auditor': 'SELF',
    'report.read': 'PROJECT',
    'activityLog.read': 'SELF',
    'notification.read': 'SELF',
  },
  CODER: {
    'employee.read': 'SELF',
    'employee.update': 'SELF',
    'loginName.read': 'SELF',
    'team.read': 'SELF',
    'project.read': 'PROJECT',
    'chart.read': 'SELF',
    'production.submit': 'SELF',
    'production.read': 'SELF',
    'audit.read': 'SELF',
    'rework.read': 'SELF',
    'rework.perform': 'SELF',
    'dashboard.coder': 'SELF',
    'report.read': 'SELF',
    'activityLog.read': 'SELF',
    'notification.read': 'SELF',
  },
  VENDOR_ADMIN: {
    'employee.read': 'VENDOR',
    'employee.create': 'VENDOR',
    'employee.update': 'VENDOR',
    'employee.deactivate': 'VENDOR',
    'employee.sendActivation': 'VENDOR',
    'employee.triggerPasswordReset': 'VENDOR',
    'loginName.read': 'VENDOR',
    'vendor.read': 'VENDOR',
    'team.manage': 'VENDOR',
    'team.read': 'VENDOR',
    'project.read': 'VENDOR',
    'chart.read': 'VENDOR',
    'production.read': 'VENDOR',
    'audit.read': 'VENDOR',
    'rework.read': 'VENDOR',
    'dashboard.vendor': 'VENDOR',
    'report.read': 'VENDOR',
    'activityLog.read': 'VENDOR',
    'notification.read': 'SELF',
  },
};

/** Permissions only a Manager may ever hold. Enforced by tests so the matrix can't drift. */
export const MANAGER_ONLY_PERMISSIONS: readonly Permission[] = [
  'employee.changeRole',
  'audit.resolveReview',
  'chart.allocate',
  'chart.import',
  'loginName.assign',
  'vendor.manage',
  'client.manage',
  'project.manage',
  'project.assignStaff',
  'settings.manage',
  'system.admin',
  'auditLog.read',
  'dashboard.manager',
];

export function scopeFor(role: Role, permission: Permission): Scope | null {
  return RBAC_MATRIX[role][permission] ?? null;
}

export function can(role: Role, permission: Permission): boolean {
  return scopeFor(role, permission) !== null;
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}
