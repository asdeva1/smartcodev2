import { parseDatabaseRuleViolation } from './rule-errors';

describe('parseDatabaseRuleViolation', () => {
  it('maps SC403 (role not allowed) to 403 FORBIDDEN', () => {
    const error = new Error(
      'Database error. Code: `SC403`. Message: `SC403: only an active Manager can resolve a REVIEW_REQUIRED audit`',
    );
    expect(parseDatabaseRuleViolation(error)).toEqual({
      status: 403,
      code: 'FORBIDDEN',
      detail: 'only an active Manager can resolve a REVIEW_REQUIRED audit',
    });
  });

  it('maps SC409 to 409 and a second resolution to AUDIT_ALREADY_RESOLVED', () => {
    expect(parseDatabaseRuleViolation(new Error('`SC409: allocation history is immutable`'))).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(
      parseDatabaseRuleViolation(new Error('Message: `SC409: this audit has already been resolved`')),
    ).toMatchObject({ status: 409, code: 'AUDIT_ALREADY_RESOLVED' });
  });

  it('maps SC422 to 422 and reads wrapped causes / meta', () => {
    expect(
      parseDatabaseRuleViolation({
        message: 'x',
        cause: new Error('SC422: the coder is not assigned to this project'),
      }),
    ).toEqual({
      status: 422,
      code: 'VALIDATION_FAILED',
      detail: 'the coder is not assigned to this project',
    });
    expect(parseDatabaseRuleViolation({ message: 'x', meta: { message: 'SC403: nope' } })).toMatchObject({
      status: 403,
    });
  });

  it('ignores everything else — internals are never forwarded', () => {
    expect(parseDatabaseRuleViolation(new Error('connection refused to db.internal:5432'))).toBeNull();
    expect(parseDatabaseRuleViolation(null)).toBeNull();
    expect(parseDatabaseRuleViolation('SC403: a string is not an error object')).toBeNull();
  });
});
