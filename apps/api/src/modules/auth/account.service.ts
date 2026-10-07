import { Injectable, Logger } from '@nestjs/common';
import { type Role, checkPasswordPolicy } from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import { AuthTokenService, type AuthTokenKind } from '../../core/auth/auth-token.service';
import { PasswordService } from '../../core/auth/password.service';
import type { RequestMeta } from '../../core/auth/request-meta';
import { SessionService } from '../../core/auth/session.service';
import { ProblemException } from '../../core/errors/problem';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { invalidLink } from '../../core/auth/auth-token.service';

/** Activation and password reset — the public, token-based part of the account lifecycle. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
    private readonly mail: MailService,
  ) {}

  check(type: AuthTokenKind, token: string) {
    return this.tokens.inspect(type, token);
  }

  /** PENDING_ACTIVATION → ACTIVE. The employee chooses the password; no one else ever sees it. */
  async activate(token: string, password: string, meta: RequestMeta): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const employee = await this.tokens.consume(tx, 'ACTIVATION', token);
      if (employee.status !== 'PENDING_ACTIVATION') throw invalidLink();
      this.assertPolicy(password, employee);
      const passwordHash = await this.passwords.hash(password);
      const now = new Date();
      await tx.credential.upsert({
        where: { employeeId: employee.id },
        create: { employeeId: employee.id, passwordHash },
        update: { passwordHash, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null },
      });
      await tx.employee.update({
        where: { id: employee.id },
        data: { status: 'ACTIVE', activatedAt: now, deactivatedAt: null },
      });
      await this.tokens.revokeAllLive(tx, employee.id);
      await this.sessions.revokeAllForEmployee(employee.id, {}, tx);
      await this.audit.record(
        {
          organizationId: employee.organizationId,
          actorId: employee.id,
          actorRole: employee.role as Role,
          action: 'EMPLOYEE.ACTIVATED',
          entityType: 'Employee',
          entityId: employee.id,
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      await this.activity.record(
        {
          organizationId: employee.organizationId,
          actorId: employee.id,
          action: 'EMPLOYEE.ACTIVATED',
          entityType: 'Employee',
          entityId: employee.id,
        },
        tx,
      );
    });
  }

  /**
   * Always succeeds from the caller's point of view (no account enumeration). Only an ACTIVE employee gets a link:
   * a pending account must activate, not reset; an inactive one cannot sign in at all.
   */
  async requestReset(email: string, meta: RequestMeta): Promise<void> {
    const employee = await this.prisma.client.employee.findUnique({
      where: { email },
      include: { credential: true },
    });
    if (!employee || employee.status !== 'ACTIVE' || !employee.credential) return;
    try {
      const { token } = await this.prisma.client.$transaction(async (tx) => {
        const issued = await this.tokens.issue(tx, employee.id, 'PASSWORD_RESET', employee.id);
        await this.audit.record(
          {
            organizationId: employee.organizationId,
            actorId: employee.id,
            actorRole: employee.role as Role,
            action: 'AUTH.PASSWORD_RESET_REQUESTED',
            entityType: 'Employee',
            entityId: employee.id,
            ipAddress: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return issued;
      });
      await this.mail.trySend(() => this.mail.sendPasswordReset(employee, token, 'self'), 'password-reset');
    } catch (error) {
      // Never let a failure here distinguish an existing account from an unknown one.
      this.logger.error(`Password reset request failed: ${(error as Error).name}`);
    }
  }

  /** Sets a new password from a reset link and ends every existing sign-in. */
  async reset(token: string, password: string, meta: RequestMeta): Promise<void> {
    const employee = await this.prisma.client.$transaction(async (tx) => {
      const found = await this.tokens.consume(tx, 'PASSWORD_RESET', token);
      if (found.status !== 'ACTIVE') throw invalidLink();
      this.assertPolicy(password, found);
      const passwordHash = await this.passwords.hash(password);
      await tx.credential.upsert({
        where: { employeeId: found.id },
        create: { employeeId: found.id, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      await this.tokens.revokeAllLive(tx, found.id);
      await this.sessions.revokeAllForEmployee(found.id, {}, tx);
      await this.audit.record(
        {
          organizationId: found.organizationId,
          actorId: found.id,
          actorRole: found.role as Role,
          action: 'AUTH.PASSWORD_RESET_COMPLETED',
          entityType: 'Employee',
          entityId: found.id,
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return found;
    });
    await this.mail.trySend(
      () =>
        this.mail.sendSecurityNotice(
          employee,
          'Your SmartCode password was reset',
          'The password for your SmartCode account was reset using an emailed link. All devices were signed out.',
        ),
      'security',
    );
  }

  private assertPolicy(
    password: string,
    employee: { email: string; fullName: string; employeeCode: string },
  ): void {
    const problem = checkPasswordPolicy(password, {
      email: employee.email,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
    });
    if (problem) {
      throw new ProblemException(422, 'VALIDATION_FAILED', problem, [
        { field: 'password', message: problem },
      ]);
    }
  }
}
