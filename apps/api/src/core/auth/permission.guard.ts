import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Permission, can } from '@smartcode/shared';
import { ProblemException } from '../errors/problem';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  type RequestWithPrincipal,
} from './decorators';

/**
 * Global authorization guard — deny by default.
 * A route must declare @Public(), @AuthenticatedOnly() or @RequirePermission(...); anything else is refused
 * (and a test fails CI). Data scope (vendor/team/project/self) is applied in the repository layer from Phase 3.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const principal = context.switchToHttp().getRequest<RequestWithPrincipal>().principal;
    if (!principal) throw new ProblemException(401, 'UNAUTHENTICATED', 'Authentication required');

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    if (required?.length) {
      if (required.every((p) => can(principal.role, p))) return true;
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)) return true;

    this.logger.error(
      `Route without an access policy was called: ${context.getClass().name}.${context.getHandler().name}`,
    );
    throw new ProblemException(403, 'FORBIDDEN', 'This route has no access policy');
  }
}
