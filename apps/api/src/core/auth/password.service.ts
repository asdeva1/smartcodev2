import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id password hashing (docs/06-authentication.md).
 * Parameters follow OWASP guidance (m=19 MiB, t=2, p=1) and are re-tuned on the target task size.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** True when a stored hash was made with weaker parameters and should be upgraded at next login. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
