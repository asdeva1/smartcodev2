import { isForbiddenLogKey, sanitizeLogPayload } from './redact';

describe('log payload sanitising', () => {
  it.each([
    'password',
    'newPassword',
    'passwordHash',
    'accessToken',
    'refresh_token',
    'tokenHash',
    'clientSecret',
    'x-api-key',
    'privateKey',
    'Authorization',
    'cookie',
    'patientName',
    'Patient_ID',
    'ssn',
    'MRN',
    'dateOfBirth',
    'DOB',
    'socialSecurityNumber',
  ])('treats %s as forbidden', (key) => {
    expect(isForbiddenLogKey(key)).toBe(true);
  });

  it.each(['count', 'method', 'loginName', 'employeeId', 'pageCount', 'icds', 'dos', 'reason', 'chartRef'])(
    'allows %s',
    (key) => {
      expect(isForbiddenLogKey(key)).toBe(false);
    },
  );

  it('drops forbidden keys at any depth and keeps the rest', () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    expect(
      sanitizeLogPayload({
        count: 2,
        password: 'x',
        nested: { accessToken: 'y', ok: true, list: [{ patientName: 'z', id: 1 }, 'plain', null] },
        when,
        skipped: undefined,
        notFinite: Infinity,
      }),
    ).toEqual({
      count: 2,
      nested: { ok: true, list: [{ id: 1 }, 'plain', null] },
      when: when.toISOString(),
      notFinite: null,
    });
  });

  it('handles primitives and unsupported values', () => {
    expect(sanitizeLogPayload('text')).toBe('text');
    expect(sanitizeLogPayload(false)).toBe(false);
    expect(sanitizeLogPayload(undefined)).toBeUndefined();
    expect(sanitizeLogPayload(() => 1)).toBeUndefined();
  });
});
