import { describe, expect, it } from 'vitest';
import {
  MANAGER_ONLY_PERMISSIONS,
  PERMISSIONS,
  RBAC_MATRIX,
  ROLES,
  can,
  isPermission,
  isRole,
  permissionsFor,
  scopeFor,
} from '../src/index.js';

describe('RBAC matrix', () => {
  it('defines a grant table for every role', () => {
    expect(Object.keys(RBAC_MATRIX).sort()).toEqual([...ROLES].sort());
  });

  it('only references known permissions', () => {
    for (const role of ROLES) {
      for (const permission of Object.keys(RBAC_MATRIX[role])) {
        expect(isPermission(permission), `${role} → ${permission}`).toBe(true);
      }
    }
  });

  it.each(MANAGER_ONLY_PERMISSIONS)('%s is held by MANAGER and nobody else', (permission) => {
    expect(can('MANAGER', permission)).toBe(true);
    for (const role of ROLES.filter((r) => r !== 'MANAGER')) {
      expect(can(role, permission), `${role} must not hold ${permission}`).toBe(false);
    }
  });

  it('D-01: Team Lead and Group Coach cannot resolve reviews', () => {
    expect(can('TEAM_LEAD', 'audit.resolveReview')).toBe(false);
    expect(can('GROUP_COACH', 'audit.resolveReview')).toBe(false);
    expect(can('AUDITOR', 'audit.resolveReview')).toBe(false);
  });

  it('D-03: only Manager allocates charts and assigns login names', () => {
    expect(ROLES.filter((r) => can(r, 'chart.allocate'))).toEqual(['MANAGER']);
    expect(ROLES.filter((r) => can(r, 'loginName.assign'))).toEqual(['MANAGER']);
  });

  it('Manager is organization-wide, not project-scoped', () => {
    for (const permission of permissionsFor('MANAGER')) {
      expect(scopeFor('MANAGER', permission)).toBe('ORG');
    }
  });

  it('Manager does not code, audit or perform rework', () => {
    expect(can('MANAGER', 'production.submit')).toBe(false);
    expect(can('MANAGER', 'audit.perform')).toBe(false);
    expect(can('MANAGER', 'rework.perform')).toBe(false);
  });

  it('Vendor Admin is always vendor-scoped (except own notifications)', () => {
    for (const permission of permissionsFor('VENDOR_ADMIN')) {
      const scope = scopeFor('VENDOR_ADMIN', permission);
      expect(permission === 'notification.read' ? scope === 'SELF' : scope === 'VENDOR', permission).toBe(
        true,
      );
    }
  });

  it('only coders submit production and perform rework; only auditors audit', () => {
    expect(ROLES.filter((r) => can(r, 'production.submit'))).toEqual(['CODER']);
    expect(ROLES.filter((r) => can(r, 'rework.perform'))).toEqual(['CODER']);
    expect(ROLES.filter((r) => can(r, 'audit.perform'))).toEqual(['AUDITOR']);
  });

  it('every role can read its own notifications', () => {
    for (const role of ROLES) expect(can(role, 'notification.read')).toBe(true);
  });

  it('type guards', () => {
    expect(isRole('MANAGER')).toBe(true);
    expect(isRole('ADMIN')).toBe(false);
    expect(isPermission(PERMISSIONS[0])).toBe(true);
    expect(isPermission('chart.delete')).toBe(false);
  });
});
