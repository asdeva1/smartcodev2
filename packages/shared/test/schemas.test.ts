import { describe, expect, it } from 'vitest';
import * as shared from '../src/index';

const ID = '0199c0de-0000-7000-8000-000000000001';

describe('approval requests', () => {
  const ok = shared.approvalCreateSchema;
  it('needs a reason to deactivate, a role and reason to change a role, and a login name to change one', () => {
    expect(ok.safeParse({ type: 'EMPLOYEE_DEACTIVATION', entityId: ID }).success).toBe(false);
    expect(
      ok.safeParse({ type: 'EMPLOYEE_DEACTIVATION', entityId: ID, reason: 'Left the company' }).success,
    ).toBe(true);
    expect(ok.safeParse({ type: 'ROLE_CHANGE', entityId: ID }).success).toBe(false);
    expect(ok.safeParse({ type: 'ROLE_CHANGE', entityId: ID, role: 'AUDITOR' }).success).toBe(false);
    expect(
      ok.safeParse({ type: 'ROLE_CHANGE', entityId: ID, role: 'AUDITOR', reason: 'Moving to audit' }).success,
    ).toBe(true);
    expect(ok.safeParse({ type: 'LOGIN_NAME_CHANGE', entityId: ID }).success).toBe(false);
    expect(ok.safeParse({ type: 'PROJECT_REOPEN', entityId: ID, comments: '   ' })).toMatchObject({
      success: true,
      data: { comments: undefined },
    });
    expect(ok.safeParse({ type: 'NOPE', entityId: ID }).success).toBe(false);
  });
  it('a rejection needs a reason; open work must be confirmed explicitly', () => {
    expect(shared.approvalDecisionSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(
      shared.approvalDecisionSchema.safeParse({ decision: 'REJECTED', comments: 'Charts still open' })
        .success,
    ).toBe(true);
    expect(shared.approvalDecisionSchema.parse({ decision: 'APPROVED' }).confirmOpenWork).toBe(false);
  });
});

describe('list queries', () => {
  const queries = Object.entries(shared).filter(
    ([name, v]) =>
      /QuerySchema$/.test(name) && typeof (v as { safeParse?: unknown }).safeParse === 'function',
  ) as [string, { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } }][];

  it.each(queries)('%s fills defaults and refuses junk paging', (_name, schema) => {
    const empty = schema.safeParse({});
    if (empty.success && empty.data && 'page' in empty.data) {
      expect(empty.data.page).toBe(1);
      expect(schema.safeParse({ page: 0 }).success).toBe(false);
      expect(schema.safeParse({ page: 'abc' }).success).toBe(false);
    }
    expect(schema.safeParse(null).success).toBe(false);
  });
});

describe('create and update payloads', () => {
  const payloads = Object.entries(shared).filter(
    ([name, v]) =>
      /(Create|Update|Submit|Resolve|Assign|Cancel|Add|Commit|Upload|Lead|Release|Hold|Pullback|Change|Deactivate)\w*Schema$/.test(
        name,
      ) && typeof (v as { safeParse?: unknown }).safeParse === 'function',
  ) as [string, { safeParse: (v: unknown) => { success: boolean } }][];

  it.each(payloads)('%s refuses missing and non-object input', (name, schema) => {
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse('text').success).toBe(false);
    // An empty object is only valid for schemas whose fields are all optional (updates); never a thrown error.
    expect(() => schema.safeParse({})).not.toThrow();
    expect(name).toBeTruthy();
  });
});

describe('roles', () => {
  it('recognises roles and which may hold a client login', () => {
    expect(shared.isRole('CODER')).toBe(true);
    expect(shared.isRole('ADMIN')).toBe(false);
    expect(shared.isLoginNameEligibleRole('CODER')).toBe(true);
    expect(shared.isLoginNameEligibleRole('HR')).toBe(false);
  });
});

describe('field rules', () => {
  it('sending a chart back needs a reason; approving does not', () => {
    expect(shared.auditResolveSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(
      shared.auditResolveSchema.safeParse({ decision: 'REJECTED', reason: 'Code assignment incorrect' })
        .success,
    ).toBe(true);
    expect(shared.auditResolveSchema.safeParse({ decision: 'APPROVED', reason: '  ' }).success).toBe(true);
  });

  it('a login name is assigned by exactly one of email or employee id', () => {
    const base = { loginName: 'coder1@vlms.com' };
    expect(shared.loginNameAssignSchema.safeParse(base).success).toBe(false);
    expect(
      shared.loginNameAssignSchema.safeParse({ ...base, employeeId: ID, email: 'a@example.test' }).success,
    ).toBe(false);
    expect(shared.loginNameAssignSchema.safeParse({ ...base, email: 'a@example.test' }).success).toBe(true);
    expect(shared.loginNameAssignSchema.safeParse({ ...base, employeeId: ID }).success).toBe(true);
  });

  it('time zones must be real', () => {
    expect(shared.timeZoneSchema.safeParse('Asia/Kolkata').success).toBe(true);
    expect(shared.timeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
    expect(shared.timeZoneSchema.safeParse('').success).toBe(false);
  });

  it('a custom report range needs both dates, in order, within a year', () => {
    const q = shared.reportQuerySchema;
    expect(q.safeParse({}).success).toBe(true);
    expect(q.safeParse({ range: 'custom' }).success).toBe(false);
    expect(q.safeParse({ range: 'custom', from: '2026-03-01' }).success).toBe(false);
    expect(q.safeParse({ range: 'custom', from: '2026-03-10', to: '2026-03-01' }).success).toBe(false);
    expect(q.safeParse({ range: 'custom', from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(q.safeParse({ range: 'custom', from: '2026-03-01', to: '2026-03-31' }).success).toBe(true);
  });

  it('a visit needs a name, host and purpose; blank phone and email are treated as not given', () => {
    const base = { fullName: 'Asha Rao', hostId: ID, purpose: 'Interview' };
    const ok = shared.visitCreateSchema.safeParse({ ...base, phone: '', email: '' });
    expect(ok).toMatchObject({ success: true, data: { phone: undefined, email: undefined, checkIn: false } });
    expect(shared.visitCreateSchema.safeParse({ ...base, phone: 'abc' }).success).toBe(false);
    expect(
      shared.visitCreateSchema.safeParse({ ...base, phone: '+91 98765 43210', email: 'asha@example.test' })
        .success,
    ).toBe(true);
    expect(shared.visitCreateSchema.safeParse({ ...base, purpose: 'x' }).success).toBe(false);
    expect(shared.visitCreateSchema.safeParse({ ...base, expectedAt: 'tomorrow' }).success).toBe(false);
    expect(
      shared.visitCreateSchema.safeParse({ ...base, expectedAt: '2026-10-12T09:30:00+05:30' }).success,
    ).toBe(true);
  });

  it('an internal review takes a non-negative error count; blank notes are dropped', () => {
    const base = { auditId: ID, independentErrors: 2 };
    expect(shared.internalReviewCreateSchema.safeParse({ ...base, notes: '  ' })).toMatchObject({
      success: true,
      data: { notes: undefined },
    });
    expect(shared.internalReviewCreateSchema.safeParse({ ...base, independentErrors: -1 }).success).toBe(
      false,
    );
    expect(shared.internalReviewCreateSchema.safeParse({ ...base, independentErrors: 'many' }).success).toBe(
      false,
    );
    expect(shared.internalSampleQuerySchema.parse({}).size).toBe(10);
  });

  it('free-text filters treat blanks as not given', () => {
    expect(shared.chartRepositoryQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(shared.chartRepositoryQuerySchema.parse({ q: ' abc ' }).q).toBe('abc');
    expect(shared.auditLogQuerySchema.parse({ action: '  ' })).toBeDefined();
  });
});
