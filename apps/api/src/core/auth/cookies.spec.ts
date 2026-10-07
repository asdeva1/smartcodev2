import type { Response } from 'express';
import type { AppConfig } from '../config/app-config.service';
import { clearAuthCookies, REFRESH_COOKIE_PATH, setAuthCookies } from './cookies';

function fakeResponse() {
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const cleared: { name: string; options: Record<string, unknown> }[] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      set.push({ name, value, options }),
    clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }),
  } as unknown as Response;
  return { res, set, cleared };
}
const config = (secure: boolean, domain?: string) =>
  ({
    secureCookies: secure,
    get: (key: string) => (key === 'COOKIE_DOMAIN' ? domain : undefined),
    ms: () => 15 * 60_000,
  }) as unknown as AppConfig;
const tokens = {
  accessToken: 'a.b.c',
  refreshToken: 'opaque',
  refreshExpiresAt: new Date(Date.now() + 3_600_000),
};

describe('auth cookies', () => {
  it('sets httpOnly access and refresh cookies and a readable CSRF cookie', () => {
    const { res, set } = fakeResponse();
    setAuthCookies(res, config(true), tokens);
    const by = Object.fromEntries(set.map((c) => [c.name, c]));
    expect(by.sc_at?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(by.sc_rt?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
    });
    expect(by.sc_csrf?.options).toMatchObject({ httpOnly: false, secure: true, sameSite: 'lax' });
    expect(by.sc_csrf?.value.length).toBeGreaterThanOrEqual(32);
  });
  it('limits the refresh cookie to the auth endpoints', () => {
    expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
  });
  it('honours COOKIE_DOMAIN and the secure flag from configuration', () => {
    const { res, set } = fakeResponse();
    setAuthCookies(res, config(false, 'example.test'), tokens);
    expect(set.every((c) => c.options.domain === 'example.test' && c.options.secure === false)).toBe(true);
  });
  it('issues a fresh CSRF value for every sign-in', () => {
    const a = fakeResponse();
    const b = fakeResponse();
    setAuthCookies(a.res, config(true), tokens);
    setAuthCookies(b.res, config(true), tokens);
    expect(a.set.find((c) => c.name === 'sc_csrf')?.value).not.toBe(
      b.set.find((c) => c.name === 'sc_csrf')?.value,
    );
  });
  it('clears all three cookies with the same path and domain they were set with', () => {
    const { res, cleared } = fakeResponse();
    clearAuthCookies(res, config(true, 'example.test'));
    expect(cleared.map((c) => c.name).sort()).toEqual(['sc_at', 'sc_csrf', 'sc_rt']);
    expect(cleared.find((c) => c.name === 'sc_rt')?.options.path).toBe(REFRESH_COOKIE_PATH);
    expect(cleared.every((c) => c.options.domain === 'example.test')).toBe(true);
  });
});
