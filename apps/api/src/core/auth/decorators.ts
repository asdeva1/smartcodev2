import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@smartcode/shared';
import type { Principal } from './principal';

export const IS_PUBLIC_KEY = 'smartcode:isPublic';
export const PERMISSIONS_KEY = 'smartcode:permissions';
export const AUTHENTICATED_ONLY_KEY = 'smartcode:authenticatedOnly';

/** No authentication (health, login, activation, password reset). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires an authenticated caller holding ALL listed permissions (docs/03-rbac-matrix.md). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Any authenticated caller (e.g. GET /auth/me, own notifications). Must be explicit. */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

export interface RequestWithPrincipal {
  principal?: Principal;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
  if (!req.principal) throw new Error('CurrentPrincipal used on a route without authentication');
  return req.principal;
});
