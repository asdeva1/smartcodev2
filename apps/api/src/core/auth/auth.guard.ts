import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';
import { IS_PUBLIC_KEY, type RequestWithPrincipal } from './decorators';
import { ACCESS_TOKEN_COOKIE, PERMISSIONS_VERSION } from './principal';
import { SessionVerifier } from './session.service';
import { TokenService } from './token.service';

/**
 * Global authentication guard. Every route requires a valid access token unless marked @Public().
 * Token source: `sc_at` httpOnly cookie (web) or `Authorization: Bearer` (mobile V2 / scripts).
 * After the signature check the session must still be live and the employee ACTIVE (database check), and the
 * role/vendor are re-read from the database — so deactivation, logout, password reset and role changes apply to the
 * very next request, not at token expiry.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();
    const token = extractAccessToken(req);
    if (!token) throw new ProblemException(401, 'UNAUTHENTICATED', 'Authentication required');

    try {
      const principal = await this.tokens.verifyAccessToken(token);
      if (principal.permissionsVersion !== PERMISSIONS_VERSION) {
        throw new ProblemException(401, 'UNAUTHENTICATED', 'Session must be renewed');
      }
      const live = await this.sessions.verify(principal);
      if (!live) throw new ProblemException(401, 'UNAUTHENTICATED', 'Invalid or expired session');
      req.principal = live;
      return true;
    } catch (e) {
      if (e instanceof ProblemException) throw e;
      throw new ProblemException(401, 'UNAUTHENTICATED', 'Invalid or expired session');
    }
  }
}

export function extractAccessToken(
  req: Pick<Request, 'headers'> & { cookies?: Record<string, string> },
): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();
    if (value) return value;
  }
  const cookie = req.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : null;
}
