import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ActivationRequest,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type TokenCheckRequest,
  activationRequestSchema,
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  tokenCheckRequestSchema,
} from '@smartcode/shared';
import type { Request, Response } from 'express';
import { AuthenticatedOnly, CurrentPrincipal, Public } from '../../core/auth/decorators';
import { clearAuthCookies, setAuthCookies } from '../../core/auth/cookies';
import { extractAccessToken } from '../../core/auth/auth.guard';
import { type Principal, REFRESH_TOKEN_COOKIE } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { SessionService } from '../../core/auth/session.service';
import { TokenService } from '../../core/auth/token.service';
import { AppConfig } from '../../core/config/app-config.service';
import { ProblemException } from '../../core/errors/problem';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';

/**
 * Per-IP limits on the public token endpoints, on top of the global limit. Sign-in has its own limiter that counts
 * only FAILED attempts per email+IP (see LoginThrottle), so a whole office behind one address can sign in normally.
 */
const PUBLIC_LIMIT = { default: { limit: 60, ttl: 15 * 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, profile } = await this.auth.login(body.email, body.password, meta);
    setAuthCookies(res, this.config, tokens);
    return profile;
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(@Req() req: Request, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    if (!presented) throw new ProblemException(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    try {
      const issued = await this.auth.refresh(presented, meta);
      setAuthCookies(res, this.config, issued);
      const claims = await this.tokens.verifyAccessToken(issued.accessToken);
      return this.auth.profile(claims.employeeId);
    } catch (error) {
      clearAuthCookies(res, this.config);
      throw error;
    }
  }

  /** Public so an expired access token can still sign out; identifies the sign-in from the token or refresh cookie. */
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: Request, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    let principal: Principal | undefined;
    const access = extractAccessToken(req);
    if (access) principal = await this.tokens.verifyAccessToken(access).catch(() => undefined);
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    await this.auth.logout({ principal, refreshToken }, meta);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  @AuthenticatedOnly()
  me(@CurrentPrincipal() principal: Principal) {
    return this.auth.profile(principal.employeeId);
  }

  @Get('my-account')
  @AuthenticatedOnly()
  myAccount(@CurrentPrincipal() principal: Principal) {
    return this.auth.myAccount(principal.employeeId);
  }

  @Post('tokens/check')
  @Public()
  @HttpCode(200)
  @Throttle(PUBLIC_LIMIT)
  check(@Body(new ZodValidationPipe(tokenCheckRequestSchema)) body: TokenCheckRequest) {
    return this.accounts.check(body.type, body.token);
  }

  @Post('activation')
  @Public()
  @HttpCode(204)
  @Throttle(PUBLIC_LIMIT)
  async activate(
    @Body(new ZodValidationPipe(activationRequestSchema)) body: ActivationRequest,
    @Meta() meta: RequestMeta,
  ) {
    await this.accounts.activate(body.token, body.password, meta);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async forgot(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
    @Meta() meta: RequestMeta,
  ) {
    await this.accounts.requestReset(body.email, meta);
    return { accepted: true };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  @Throttle(PUBLIC_LIMIT)
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
    @Meta() meta: RequestMeta,
  ) {
    await this.accounts.reset(body.token, body.password, meta);
  }

  @Post('password/change')
  @AuthenticatedOnly()
  @HttpCode(204)
  async change(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Meta() meta: RequestMeta,
  ) {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword, meta);
  }

  @Get('sessions')
  @AuthenticatedOnly()
  async listSessions(@CurrentPrincipal() principal: Principal) {
    const rows = await this.sessions.listLive(principal.employeeId);
    return rows.map((row) => ({
      id: row.id,
      current: row.familyId === principal.sessionId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  @Delete('sessions/:id')
  @AuthenticatedOnly()
  @HttpCode(204)
  async revokeSession(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const revoked = await this.sessions.revokeOwn(principal.employeeId, id);
    if (!revoked) throw new ProblemException(404, 'NOT_FOUND', 'Session not found');
  }
}
