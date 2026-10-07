import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';

/**
 * Sliding-window limiter for FAILED sign-ins, keyed by email+IP (strict) and by IP alone (loose). Applied to every
 * email — existing or not — so the response never reveals whether an account exists.
 * In-memory per API task (like the global throttler); the shared Redis store replaces it when Redis arrives.
 */
@Injectable()
export class LoginThrottle {
  private readonly windowMs = 15 * 60_000;
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly config: AppConfig) {}

  private prune(key: string, now: number): number[] {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  private keys(email: string, ip: string): { strict: string; loose: string } {
    return { strict: `e:${email}|${ip}`, loose: `i:${ip}` };
  }

  /** Seconds until another attempt is allowed, or 0 when allowed. */
  retryAfterSeconds(email: string, ip: string, now = Date.now()): number {
    const limit = this.config.get('RATE_LIMIT_LOGIN_PER_15M');
    const { strict, loose } = this.keys(email, ip);
    const waits: number[] = [];
    for (const [key, max] of [
      [strict, limit],
      [loose, limit * 10],
    ] as const) {
      const recent = this.prune(key, now);
      if (recent.length >= max) {
        const oldest = recent[recent.length - max] as number;
        waits.push(Math.ceil((oldest + this.windowMs - now) / 1000));
      }
    }
    return waits.length ? Math.max(...waits, 1) : 0;
  }

  recordFailure(email: string, ip: string, now = Date.now()): void {
    const { strict, loose } = this.keys(email, ip);
    for (const key of [strict, loose]) this.failures.set(key, [...this.prune(key, now), now]);
  }

  recordSuccess(email: string, ip: string): void {
    this.failures.delete(this.keys(email, ip).strict);
  }
}
