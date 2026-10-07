import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './validation.js';

/**
 * Server-side password policy (docs/06-authentication.md §1). Shared so the web form can give the same
 * feedback the API enforces. The API is authoritative; zxcvbn-style scoring and the breached-password check
 * (D-17) plug in behind this function later without changing callers.
 */
const COMMON_PASSWORDS = [
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'abc123',
  '123456',
  '123456789',
  '111111',
  'smartcode',
  'smartclues',
  'changeme',
];

export interface PasswordContext {
  email?: string;
  fullName?: string;
  employeeCode?: string;
}

/** Returns a user-facing message when the password is unacceptable, or null when it is fine. */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  if (password.trim() !== password) return 'Password must not start or end with a space';
  if (new Set(password).size < 5) return 'Password is too repetitive — use a longer phrase';

  const lower = password.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  for (const common of COMMON_PASSWORDS) {
    if (squashed === common || squashed.replace(/[0-9]+$/, '') === common) {
      return 'That password is too common — choose a longer, unique phrase';
    }
  }
  const forbidden: string[] = [];
  if (context.email) {
    const local = context.email.split('@')[0]?.toLowerCase() ?? '';
    if (local.length >= 4) forbidden.push(local);
  }
  if (context.employeeCode && context.employeeCode.length >= 4)
    forbidden.push(context.employeeCode.toLowerCase());
  for (const part of (context.fullName ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4) forbidden.push(part);
  }
  if (forbidden.some((f) => squashed.includes(f.replace(/[^a-z0-9]/g, '')))) {
    return 'Password must not contain your name, email or Employee ID';
  }
  return null;
}
