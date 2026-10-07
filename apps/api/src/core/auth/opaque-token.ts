import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Single-use secret tokens (activation, password reset, refresh).
 * Only the SHA-256 hash is ever stored; the raw token exists only in the email link / cookie.
 */
export interface IssuedToken {
  /** 256-bit random, base64url — give to the user, never store or log. */
  token: string;
  /** SHA-256 hex — store this. */
  hash: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueToken(bytes = 32): IssuedToken {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A stored token is usable only if unused, not revoked and not expired. */
export function isTokenUsable(
  record: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return record.usedAt === null && record.revokedAt === null && record.expiresAt.getTime() > now.getTime();
}
