import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type Permission,
  type Role,
  type Scope,
  PERMISSIONS,
  checkPasswordPolicy,
  isLoginNameEligibleRole,
  scopeFor,
} from '@smartcode/shared';
import { AuditLogService } from '../../core/audit/audit-log.service';
import { PasswordService } from '../../core/auth/password.service';
import { LoginThrottle } from '../../core/auth/login-throttle';
import type { Principal } from '../../core/auth/principal';
import { PERMISSIONS_VERSION } from '../../core/auth/principal';
import { type IssuedSession, SessionService } from '../../core/auth/session.service';
import { TokenService } from '../../core/auth/token.service';
import { AppConfig } from '../../core/config/app-config.service';
import { ProblemException } from '../../core/errors/problem';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { RequestMeta } from '../../core/auth/request-meta';

export interface SessionProfile {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    email: string;
    role: Role;
    status: string;
    vendorId: string | null;
    loginName: string | null;
    loginNameEligible: boolean;
  };
  permissions: Partial<Record<Permission, Scope>>;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const GENERIC_LOGIN_FAILURE = 'Email or password is incorrect.';

/** Sign-in, refresh rotation, sign-out, password change and the session profile. */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /** A real argon2 hash of a throw-away value: unknown emails cost the same time as wrong passwords. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottle,
    private readonly audit: AuditLogService,
    private readonly config: AppConfig,
    private readonly mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash(`timing-equaliser-${Math.random()}`);
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ tokens: IssuedTokens; profile: SessionProfile }> {
    const wait = this.throttle.retryAfterSeconds(email, meta.ip);
    if (wait > 0) throw this.rateLimited(wait);

    const employee = await this.prisma.client.employee.findUnique({
      where: { email },
      include: { credential: true },
    });
    const credential = employee?.credential ?? null;

    // Unknown email, no password yet (pending activation) or pending after reactivation: indistinguishable from a
    // wrong password to the caller. Pending employees can never sign in — they must use their activation link.
    if (!employee || !credential || employee.status === 'PENDING_ACTIVATION') {
      await this.passwords.verify(this.dummyHash, password);
      this.throttle.recordFailure(email, meta.ip);
      if (employee)
        await this.recordFailure(
          employee,
          meta,
          employee.status === 'PENDING_ACTIVATION' ? 'PENDING_ACTIVATION' : 'NO_CREDENTIAL',
        );
      throw this.invalidCredentials();
    }

    const now = new Date();
    if (credential.lockedUntil && credential.lockedUntil > now) {
      this.throttle.recordFailure(email, meta.ip);
      await this.recordFailure(employee, meta, 'ACCOUNT_LOCKED');
      throw this.rateLimited(Math.ceil((credential.lockedUntil.getTime() - now.getTime()) / 1000));
    }

    const ok = await this.passwords.verify(credential.passwordHash, password);
    if (!ok) {
      await this.registerWrongPassword(employee.id, credential.failedAttempts, credential.lockedUntil);
      this.throttle.recordFailure(email, meta.ip);
      await this.recordFailure(employee, meta, 'WRONG_PASSWORD');
      throw this.invalidCredentials();
    }

    if (employee.status !== 'ACTIVE') {
      // Correct password but the account is inactive/locked: say so (the caller proved who they are).
      await this.recordFailure(employee, meta, `STATUS_${employee.status}`);
      throw new ProblemException(
        403,
        'ACCOUNT_UNAVAILABLE',
        'This account is not active. Contact your Manager.',
      );
    }

    if (credential.failedAttempts > 0 || credential.lockedUntil) {
      await this.prisma.client.credential.update({
        where: { employeeId: employee.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }
    if (this.passwords.needsRehash(credential.passwordHash)) {
      await this.prisma.client.credential.update({
        where: { employeeId: employee.id },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    }

    this.throttle.recordSuccess(email, meta.ip);
    const session = await this.sessions.create(employee.id, {
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      organizationId: employee.organizationId,
      actorId: employee.id,
      actorRole: employee.role as Role,
      action: 'AUTH.LOGIN',
      entityType: 'Employee',
      entityId: employee.id,
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
    return {
      tokens: await this.issueTokens(
        employee.id,
        employee.organizationId,
        employee.role as Role,
        employee.vendorId,
        session,
      ),
      profile: await this.profile(employee.id),
    };
  }

  /** Rotates the refresh token and issues a fresh access token. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedTokens> {
    const result = await this.sessions.rotate(refreshToken, {
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    if (result.outcome === 'reuse') {
      const employee = await this.prisma.client.employee.findUnique({
        where: { id: result.employeeId },
        select: { organizationId: true, role: true },
      });
      if (employee) {
        await this.audit.record({
          organizationId: employee.organizationId,
          actorId: result.employeeId,
          actorRole: employee.role as Role,
          action: 'AUTH.REFRESH_REUSE_DETECTED',
          entityType: 'Employee',
          entityId: result.employeeId,
          outcome: 'DENIED',
          ipAddress: meta.ip,
          requestId: meta.requestId,
        });
      }
      throw new ProblemException(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    }
    if (result.outcome === 'invalid') {
      throw new ProblemException(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    }
    const employee = await this.prisma.client.employee.findUniqueOrThrow({
      where: { id: result.employeeId },
      select: { organizationId: true, role: true, vendorId: true },
    });
    return this.issueTokens(
      result.employeeId,
      employee.organizationId,
      employee.role as Role,
      employee.vendorId,
      result.session,
    );
  }

  /** Ends the sign-in identified by a valid access token or, failing that, the refresh cookie. */
  async logout(
    identity: { principal?: Principal | undefined; refreshToken?: string | undefined },
    meta: RequestMeta,
  ): Promise<void> {
    let familyId: string | null = identity.principal?.sessionId ?? null;
    let employeeId: string | null = identity.principal?.employeeId ?? null;
    if (!familyId && identity.refreshToken) {
      const found = await this.sessions.familyOfRefreshToken(identity.refreshToken);
      familyId = found?.familyId ?? null;
      employeeId = found?.employeeId ?? null;
    }
    if (!familyId || !employeeId) return;
    await this.sessions.revokeFamily(familyId);
    const employee = await this.prisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, role: true },
    });
    if (employee) {
      await this.audit.record({
        organizationId: employee.organizationId,
        actorId: employeeId,
        actorRole: employee.role as Role,
        action: 'AUTH.LOGOUT',
        entityType: 'Employee',
        entityId: employeeId,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      });
    }
  }

  async profile(employeeId: string): Promise<SessionProfile> {
    const employee = await this.prisma.client.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { loginNameAssignments: { where: { endedAt: null }, include: { loginName: true } } },
    });
    const role = employee.role as Role;
    const permissions: Partial<Record<Permission, Scope>> = {};
    for (const permission of PERMISSIONS) {
      const scope = scopeFor(role, permission);
      if (scope) permissions[permission] = scope;
    }
    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        email: employee.email,
        role,
        status: employee.status,
        vendorId: employee.vendorId,
        loginName: employee.loginNameAssignments[0]?.loginName.value ?? null,
        loginNameEligible: isLoginNameEligibleRole(role),
      },
      permissions,
    };
  }

  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const employee = await this.prisma.client.employee.findUniqueOrThrow({
      where: { id: principal.employeeId },
      include: { credential: true },
    });
    if (
      !employee.credential ||
      !(await this.passwords.verify(employee.credential.passwordHash, currentPassword))
    ) {
      throw new ProblemException(422, 'VALIDATION_FAILED', 'The current password is incorrect', [
        { field: 'currentPassword', message: 'The current password is incorrect' },
      ]);
    }
    const problem = checkPasswordPolicy(newPassword, {
      email: employee.email,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
    });
    if (problem) {
      throw new ProblemException(422, 'VALIDATION_FAILED', problem, [
        { field: 'newPassword', message: problem },
      ]);
    }
    if (await this.passwords.verify(employee.credential.passwordHash, newPassword)) {
      throw new ProblemException(422, 'VALIDATION_FAILED', 'Choose a password you have not used', [
        { field: 'newPassword', message: 'Choose a password you have not used' },
      ]);
    }
    const hash = await this.passwords.hash(newPassword);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.credential.update({
        where: { employeeId: employee.id },
        data: { passwordHash: hash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      await this.sessions.revokeAllForEmployee(employee.id, { exceptFamilyId: principal.sessionId }, tx);
      await this.audit.record(
        {
          organizationId: employee.organizationId,
          actorId: employee.id,
          actorRole: employee.role as Role,
          action: 'AUTH.PASSWORD_CHANGED',
          entityType: 'Employee',
          entityId: employee.id,
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    await this.mail.trySend(
      () =>
        this.mail.sendSecurityNotice(
          employee,
          'Your SmartCode password was changed',
          'The password for your SmartCode account was just changed. Other devices have been signed out.',
        ),
      'security',
    );
  }

  // ───────── internals ─────────

  private async issueTokens(
    employeeId: string,
    organizationId: string,
    role: Role,
    vendorId: string | null,
    session: IssuedSession,
  ): Promise<IssuedTokens> {
    const accessToken = await this.tokens.signAccessToken({
      employeeId,
      organizationId,
      role,
      vendorId,
      sessionId: session.familyId,
      permissionsVersion: PERMISSIONS_VERSION,
    });
    return { accessToken, refreshToken: session.refreshToken, refreshExpiresAt: session.refreshExpiresAt };
  }

  private async registerWrongPassword(
    employeeId: string,
    failedAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    const max = this.config.get('LOGIN_MAX_FAILED_ATTEMPTS');
    // A lock that has expired starts a fresh count.
    const base = lockedUntil && lockedUntil <= new Date() ? 0 : failedAttempts;
    const next = base + 1;
    await this.prisma.client.credential.update({
      where: { employeeId },
      data:
        next >= max
          ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + this.config.ms('LOGIN_LOCK_DURATION')) }
          : { failedAttempts: next, ...(lockedUntil ? { lockedUntil: null } : {}) },
    });
  }

  private async recordFailure(
    employee: { id: string; organizationId: string; role: string },
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        organizationId: employee.organizationId,
        actorId: employee.id,
        actorRole: employee.role as Role,
        action: 'AUTH.LOGIN_FAILED',
        entityType: 'Employee',
        entityId: employee.id,
        outcome: 'DENIED',
        after: { reason },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      });
    } catch (error) {
      this.logger.error(`Could not record a failed sign-in: ${(error as Error).name}`);
    }
  }

  private invalidCredentials(): ProblemException {
    return new ProblemException(401, 'UNAUTHENTICATED', GENERIC_LOGIN_FAILURE);
  }

  private rateLimited(seconds: number): ProblemException {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return new ProblemException(
      429,
      'RATE_LIMITED',
      `Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`,
    );
  }
}
