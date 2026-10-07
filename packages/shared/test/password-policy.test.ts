import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from '../src/index.js';

describe('password policy', () => {
  const ctx = { email: 'jane.doe@example.test', fullName: 'Jane Doe', employeeCode: 'EMP-0042' };

  it('accepts a long unique phrase', () => {
    expect(checkPasswordPolicy('Correct-Horse-Battery-7', ctx)).toBeNull();
  });
  it('requires at least 12 characters', () => {
    expect(checkPasswordPolicy('Short-1', ctx)).toMatch(/at least 12/);
  });
  it('rejects common passwords, including with a numeric suffix', () => {
    expect(checkPasswordPolicy('password1234', ctx)).toMatch(/too common/);
    expect(checkPasswordPolicy('Smartclues2026', ctx)).toMatch(/too common/);
  });
  it('rejects passwords that contain the person’s name, email name or Employee ID', () => {
    expect(checkPasswordPolicy('xx-jane-xx-Strong-9', ctx)).not.toBeNull();
    expect(checkPasswordPolicy('jane.doe-Strong-Phrase-9', ctx)).not.toBeNull();
    expect(checkPasswordPolicy('Strong-emp-0042-Phrase', ctx)).not.toBeNull();
  });
  it('rejects leading/trailing spaces and extremely repetitive strings', () => {
    expect(checkPasswordPolicy(' Correct-Horse-Battery-7', ctx)).toMatch(/space/);
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa', ctx)).toMatch(/repetitive/);
  });
  it('caps the length so hashing cannot be used for denial of service', () => {
    expect(checkPasswordPolicy('a1-'.repeat(60), ctx)).toMatch(/at most/);
  });
});
