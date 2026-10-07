import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config.service';
import { ProblemException } from '../errors/problem';
import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE, CSRF_HEADER, REFRESH_TOKEN_COOKIE } from './principal';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameValue(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * CSRF defence for cookie-authenticated browsers (docs/06 §1): SameSite=Lax cookies + an Origin allow-list +
 * a double-submit token (`sc_csrf` cookie echoed in `X-CSRF-Token`) on every unsafe request that carries session
 * cookies. Bearer-token callers (scripts, mobile) are not cookie-borne and are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (typeof origin === 'string' && !this.config.corsOrigins.includes(origin.replace(/\/+$/, ''))) {
      throw new ProblemException(403, 'CSRF_FAILED', 'Request origin is not allowed');
    }

    if (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
      return true;
    }
    const cookies = req.cookies ?? {};
    if (!cookies[ACCESS_TOKEN_COOKIE] && !cookies[REFRESH_TOKEN_COOKIE]) return true;

    const cookie = cookies[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    if (typeof cookie !== 'string' || typeof header !== 'string' || !cookie || !sameValue(cookie, header)) {
      throw new ProblemException(
        403,
        'CSRF_FAILED',
        'The request could not be verified. Reload the page and try again.',
      );
    }
    return true;
  }
}
