import { type Permission, type Role, scopeFor } from '@smartcode/shared';

/**
 * Workspace navigation, derived from the shared permission matrix so the menu can never offer something the
 * API would refuse. `available` flips to true as each module ships (docs/14-implementation-roadmap.md).
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  permission: Permission;
  group: 'Overview' | 'Operations' | 'Quality' | 'People' | 'Administration';
  available: boolean;
  /** Hide when the role only holds the permission for its own records (e.g. a coder's own profile). */
  requiresBroaderThanSelf?: boolean;
  /** Personal pages (a coder's own charts) are shown to that role only, even though the Manager holds every permission. */
  onlyRoles?: readonly Role[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'manager-dashboard',
    label: 'Manager dashboard',
    href: '/manager',
    permission: 'dashboard.manager',
    group: 'Overview',
    available: true,
  },
  {
    key: 'vendor-dashboard',
    label: 'Vendor dashboard',
    href: '/vendor',
    permission: 'dashboard.vendor',
    group: 'Overview',
    available: true,
    onlyRoles: ['VENDOR_ADMIN'],
  },
  {
    key: 'team-dashboard',
    label: 'My team',
    href: '/team-lead',
    permission: 'dashboard.teamLead',
    group: 'Overview',
    available: true,
    onlyRoles: ['TEAM_LEAD'],
  },
  {
    key: 'coach-dashboard',
    label: 'Quality coaching',
    href: '/sme',
    permission: 'dashboard.groupCoach',
    group: 'Overview',
    available: true,
    onlyRoles: ['GROUP_COACH'],
  },
  {
    key: 'coder-home',
    label: 'My charts',
    href: '/coder',
    permission: 'dashboard.coder',
    group: 'Overview',
    available: true,
    onlyRoles: ['CODER'],
  },
  {
    key: 'auditor-home',
    label: 'Audit queue',
    href: '/auditor',
    permission: 'audit.perform',
    group: 'Overview',
    available: true,
    onlyRoles: ['AUDITOR'],
  },
  {
    key: 'projects',
    label: 'Projects',
    href: '/projects',
    permission: 'project.read',
    group: 'Operations',
    available: true,
  },
  {
    key: 'charts',
    label: 'Chart repository',
    href: '/charts',
    permission: 'chart.read',
    group: 'Operations',
    available: true,
  },
  {
    key: 'allocation',
    label: 'Chart allocation',
    href: '/manager/allocation',
    permission: 'chart.allocate',
    group: 'Operations',
    available: true,
  },
  {
    key: 'reviews',
    label: 'Audit reviews',
    href: '/audit-reviews',
    permission: 'audit.resolveReview',
    group: 'Quality',
    available: true,
  },
  {
    key: 'rework',
    label: 'Rework',
    href: '/rework',
    permission: 'rework.perform',
    group: 'Quality',
    available: true,
    onlyRoles: ['CODER'],
  },
  {
    key: 'employees',
    label: 'Employee directory',
    href: '/manager/employees',
    permission: 'employee.read',
    group: 'People',
    available: true,
    requiresBroaderThanSelf: true,
  },
  {
    key: 'vendors',
    label: 'Vendors',
    href: '/manager/vendors',
    permission: 'vendor.read',
    group: 'People',
    available: true,
  },
  {
    key: 'teams',
    label: 'Teams',
    href: '/manager/teams',
    permission: 'team.read',
    group: 'People',
    available: true,
    requiresBroaderThanSelf: true,
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/reports',
    permission: 'report.read',
    group: 'Administration',
    available: true,
  },
  {
    key: 'audit-log',
    label: 'Audit log',
    href: '/audit-log',
    permission: 'auditLog.read',
    group: 'Administration',
    available: true,
  },
  {
    key: 'approvals',
    label: 'Approvals',
    href: '/approvals',
    permission: 'notification.read',
    group: 'Administration',
    available: true,
    onlyRoles: ['MANAGER', 'TEAM_LEAD', 'HR', 'VENDOR_ADMIN', 'GROUP_COACH'],
  },
  {
    key: 'visitors',
    label: 'Visitors',
    href: '/visitors',
    permission: 'visitor.manage',
    group: 'Operations',
    available: true,
  },
  {
    key: 'internal-audit',
    label: 'Internal audit',
    href: '/internal-audit',
    permission: 'internalAudit.access',
    group: 'Quality',
    available: true,
  },
  {
    key: 'hr-integration',
    label: 'Smart HRMS',
    href: '/hr-integration',
    permission: 'hrIntegration.read',
    group: 'People',
    available: true,
  },
  {
    key: 'activity',
    label: 'Activity',
    href: '/activity',
    permission: 'activityLog.read',
    group: 'Administration',
    available: true,
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/manager/settings',
    permission: 'settings.manage',
    group: 'Administration',
    available: true,
  },
];

export const NAV_GROUP_ORDER: readonly NavItem['group'][] = [
  'Overview',
  'Operations',
  'Quality',
  'People',
  'Administration',
];

export function navigationFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.onlyRoles && !item.onlyRoles.includes(role)) return false;
    const scope = scopeFor(role, item.permission);
    return scope !== null && !(item.requiresBroaderThanSelf && scope === 'SELF');
  });
}

export function groupedNavigation(role: Role): { group: NavItem['group']; items: NavItem[] }[] {
  const items = navigationFor(role);
  return NAV_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}
