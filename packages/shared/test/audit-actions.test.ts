import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/index.js';

describe('audit actions', () => {
  it('match the database format check and are unique', () => {
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[A-Z][A-Z0-9_.]{1,63}$/);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('cover every action the specification requires to be audited', () => {
    for (const required of [
      'AUTH.LOGIN',
      'AUTH.LOGOUT',
      'EMPLOYEE.CREATED',
      'EMPLOYEE.ACTIVATED',
      'EMPLOYEE.ROLE_CHANGED',
      'LOGIN_NAME.ASSIGNED',
      'CHART.ALLOCATED',
      'PRODUCTION.SUBMITTED',
      'AUDIT.CREATED',
      'AUDIT.RESOLVED',
      'REWORK.CREATED',
      'REAUDIT.CREATED',
      'VENDOR.ACCESS',
      'PROJECT.STAFF_ASSIGNED',
    ]) {
      expect(AUDIT_ACTIONS).toContain(required);
    }
  });
});
