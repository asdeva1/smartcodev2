import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { type AppConfig } from '../config/app-config.service';
import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE, REFRESH_TOKEN_COOKIE } from './principal';

/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  const base = {
    secure: config.secureCookies,
    sameSite: 'lax' as const,
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
  const refreshMaxAge = Math.max(tokens.refreshExpiresAt.getTime() - Date.now(), 0);
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    path: '/',
    maxAge: config.ms('ACCESS_TOKEN_TTL'),
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshMaxAge,
  });
  // Readable by the web app, which echoes it in X-CSRF-Token (double-submit). Not a secret on its own.
  res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    ...base,
    httpOnly: false,
    path: '/',
    maxAge: refreshMaxAge,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  const base = {
    secure: config.secureCookies,
    sameSite: 'lax' as const,
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, httpOnly: true, path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base, path: '/' });
}
