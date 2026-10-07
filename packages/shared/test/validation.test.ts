import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINOLOGY,
  auditErrorCountsSchema,
  chartRefSchema,
  emailSchema,
  employeeCodeSchema,
  loginNameSchema,
  loginRequestSchema,
  paginationQuerySchema,
  passwordSchema,
  productionCountsSchema,
  term,
} from '../src/index.js';

describe('validation', () => {
  it('normalises email addresses', () => {
    expect(emailSchema.parse('  Coder.One@Example.TEST ')).toBe('coder.one@example.test');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('validates business identifiers', () => {
    expect(employeeCodeSchema.parse(' EMP-001 ')).toBe('EMP-001');
    expect(employeeCodeSchema.safeParse('').success).toBe(false);
    expect(employeeCodeSchema.safeParse('EMP 001').success).toBe(false);
    expect(chartRefSchema.parse('TEST-CHART-0001')).toBe('TEST-CHART-0001');
    expect(chartRefSchema.safeParse('=cmd()').success).toBe(false);
    expect(loginNameSchema.parse('sc.coder01')).toBe('sc.coder01');
    expect(loginNameSchema.safeParse('a').success).toBe(false);
  });

  it('enforces password length', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a-long-enough-passphrase').success).toBe(true);
  });

  it('parses login requests', () => {
    expect(loginRequestSchema.parse({ email: 'M@Example.test', password: 'x' })).toEqual({
      email: 'm@example.test',
      password: 'x',
    });
  });

  it('D-11: production counts are non-negative integers and have no JCD field', () => {
    expect(productionCountsSchema.parse({ pageCount: 10, icds: 4, dos: 2, jcd: 9 })).toEqual({
      pageCount: 10,
      icds: 4,
      dos: 2,
    });
    expect(productionCountsSchema.safeParse({ pageCount: -1, icds: 0, dos: 0 }).success).toBe(false);
    expect(Object.keys(productionCountsSchema.shape)).not.toContain('jcd');
  });

  it('D-11: audit errors and error exceptions are separate fields', () => {
    expect(Object.keys(auditErrorCountsSchema.shape).sort()).toEqual(['auditErrors', 'errorExceptions']);
  });

  it('pagination defaults and limits', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paginationQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('terminology (D-16)', () => {
  it('displays SPC as-is without expansion', () => {
    expect(term('SPC')).toBe('SPC');
    expect(DEFAULT_TERMINOLOGY.SPC).toBe('SPC');
  });
  it('supports organization overrides without code changes', () => {
    expect(term('SPC', { SPC: 'SPC Partner' })).toBe('SPC Partner');
    expect(term('SPC', { SPC: '   ' })).toBe('SPC');
  });
});
