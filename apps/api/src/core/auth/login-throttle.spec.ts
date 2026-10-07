import type { AppConfig } from '../config/app-config.service';
import { LoginThrottle } from './login-throttle';

const config = { get: () => 5 } as unknown as AppConfig;

describe('LoginThrottle', () => {
  const now = 1_000_000;

  it('allows attempts until the per-email+IP limit of failures', () => {
    const t = new LoginThrottle(config);
    for (let i = 0; i < 4; i += 1) t.recordFailure('a@example.test', '1.1.1.1', now + i);
    expect(t.retryAfterSeconds('a@example.test', '1.1.1.1', now + 10)).toBe(0);
    t.recordFailure('a@example.test', '1.1.1.1', now + 5);
    expect(t.retryAfterSeconds('a@example.test', '1.1.1.1', now + 10)).toBeGreaterThan(0);
  });

  it('does not block other emails behind the same address until the looser IP limit', () => {
    const t = new LoginThrottle(config);
    for (let i = 0; i < 5; i += 1) t.recordFailure('a@example.test', '1.1.1.1', now + i);
    expect(t.retryAfterSeconds('b@example.test', '1.1.1.1', now + 10)).toBe(0);
  });

  it('blocks the whole address after many failures across emails', () => {
    const t = new LoginThrottle(config);
    for (let i = 0; i < 50; i += 1) t.recordFailure(`u${i}@example.test`, '2.2.2.2', now + i);
    expect(t.retryAfterSeconds('fresh@example.test', '2.2.2.2', now + 100)).toBeGreaterThan(0);
  });

  it('forgets failures after the 15 minute window and after a success', () => {
    const t = new LoginThrottle(config);
    for (let i = 0; i < 5; i += 1) t.recordFailure('a@example.test', '1.1.1.1', now);
    expect(t.retryAfterSeconds('a@example.test', '1.1.1.1', now + 1000)).toBeGreaterThan(0);
    expect(t.retryAfterSeconds('a@example.test', '1.1.1.1', now + 15 * 60_000 + 1)).toBe(0);
    t.recordSuccess('a@example.test', '1.1.1.1');
    expect(t.retryAfterSeconds('a@example.test', '1.1.1.1', now + 2000)).toBe(0);
  });
});
