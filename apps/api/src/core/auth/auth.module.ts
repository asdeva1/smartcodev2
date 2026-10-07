import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthTokenService } from './auth-token.service';
import { CsrfGuard } from './csrf.guard';
import { LoginThrottle } from './login-throttle';
import { PasswordService } from './password.service';
import { PermissionGuard } from './permission.guard';
import { SessionService, SessionVerifier } from './session.service';
import { TokenService } from './token.service';

/**
 * Authentication core: token signing/verification, password hashing, sessions (rotating refresh tokens, families),
 * single-use activation/reset links, CSRF protection and the global guards. The HTTP endpoints live in
 * `modules/auth`.
 */
@Global()
@Module({
  providers: [
    TokenService,
    PasswordService,
    SessionService,
    { provide: SessionVerifier, useExisting: SessionService },
    AuthTokenService,
    LoginThrottle,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [TokenService, PasswordService, SessionService, SessionVerifier, AuthTokenService, LoginThrottle],
})
export class AuthModule {}
