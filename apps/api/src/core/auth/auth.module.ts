import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PasswordService } from './password.service';
import { PermissionGuard } from './permission.guard';
import { TokenService } from './token.service';

/**
 * Authentication foundation (Phase 1): token signing/verification, password hashing and the two global guards.
 * Login, refresh, activation and password-reset endpoints arrive in Phase 3.
 */
@Global()
@Module({
  providers: [
    TokenService,
    PasswordService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [TokenService, PasswordService],
})
export class AuthModule {}
