import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Role } from '@smartcode/shared';
import { AppConfig } from '../config/app-config.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, issueToken } from './opaque-token';
import type { Principal } from './principal';
import { PERMISSIONS_VERSION } from './principal';

type Db = Prisma.TransactionClient | PrismaService['client'];

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  /** Opaque refresh token — set in the httpOnly cookie, never stored or logged in clear. */
  refreshToken: string;
  /** The session family — carried in the access token as `sid`. */
  familyId: string;
  sessionId: string;
  refreshExpiresAt: Date;
}

/**
 * Where the guard asks "is this session still good?". Overridable so foundation tests can exercise the guards
 * without a database.
 */
export abstract class SessionVerifier {
  /** Returns the live principal (role/vendor re-read from the database) or null when revoked/inactive. */
  abstract verify(claims: Principal): Promise<Principal | null>;
}

/**
 * Sessions are rows holding the SHA-256 of a rotating refresh token. A *family* is one sign-in: every rotation
 * adds a row to the family and revokes the previous one, so presenting an old refresh token (theft) revokes the
 * whole family. The access token carries the family id; the guard accepts it only while the family has a live row
 * AND the employee is ACTIVE — so deactivation, password reset and logout take effect on the very next request.
 */
@Injectable()
export class SessionService extends SessionVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async verify(claims: Principal): Promise<Principal | null> {
    const now = new Date();
    const live = await this.prisma.client.session.findFirst({
      where: {
        familyId: claims.sessionId,
        employeeId: claims.employeeId,
        revokedAt: null,
        expiresAt: { gt: now },
        employee: { status: 'ACTIVE' },
      },
      select: {
        employee: { select: { organizationId: true, role: true, vendorId: true } },
      },
    });
    if (!live) return null;
    return {
      employeeId: claims.employeeId,
      organizationId: live.employee.organizationId,
      role: live.employee.role as Role,
      vendorId: live.employee.vendorId,
      sessionId: claims.sessionId,
      permissionsVersion: PERMISSIONS_VERSION,
    };
  }

  /** Starts a new sign-in (new family). */
  async create(
    employeeId: string,
    context: SessionContext = {},
    db: Db = this.prisma.client,
  ): Promise<IssuedSession> {
    const familyId = randomUUID();
    return this.insertRow(db, employeeId, familyId, new Date(), context);
  }

  /** Rotates a refresh token: revokes the presented row and adds the next one to the same family. */
  async rotate(
    presented: string,
    context: SessionContext = {},
  ): Promise<
    | { outcome: 'rotated'; employeeId: string; session: IssuedSession }
    | { outcome: 'reuse'; employeeId: string }
    | { outcome: 'invalid' }
  > {
    const now = new Date();
    const row = await this.prisma.client.session.findUnique({ where: { tokenHash: hashToken(presented) } });
    if (!row) return { outcome: 'invalid' };
    if (row.revokedAt) {
      // A rotated-away or revoked token is being replayed — assume theft and end the whole sign-in.
      await this.revokeFamily(row.familyId);
      return { outcome: 'reuse', employeeId: row.employeeId };
    }
    if (row.expiresAt <= now) return { outcome: 'invalid' };

    const employee = await this.prisma.client.employee.findUnique({
      where: { id: row.employeeId },
      select: { status: true },
    });
    if (employee?.status !== 'ACTIVE') {
      await this.revokeFamily(row.familyId);
      return { outcome: 'invalid' };
    }

    return this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.session.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) {
        // Lost a race with a parallel refresh using the same token — treat as replay.
        await tx.session.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { outcome: 'reuse' as const, employeeId: row.employeeId };
      }
      const familyStart = await tx.session.findFirst({
        where: { familyId: row.familyId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const session = await this.insertRow(
        tx,
        row.employeeId,
        row.familyId,
        familyStart?.createdAt ?? now,
        context,
      );
      return { outcome: 'rotated' as const, employeeId: row.employeeId, session };
    });
  }

  private async insertRow(
    db: Db,
    employeeId: string,
    familyId: string,
    familyStartedAt: Date,
    context: SessionContext,
  ): Promise<IssuedSession> {
    const now = Date.now();
    const absoluteEnd = familyStartedAt.getTime() + this.config.ms('REFRESH_TOKEN_ABSOLUTE_TTL');
    const expiresAt = new Date(Math.min(now + this.config.ms('REFRESH_TOKEN_IDLE_TTL'), absoluteEnd));
    const { token, hash } = issueToken();
    const row = await db.session.create({
      data: {
        employeeId,
        familyId,
        tokenHash: hash,
        expiresAt,
        ipAddress: context.ipAddress?.slice(0, 64) ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { refreshToken: token, familyId, sessionId: row.id, refreshExpiresAt: expiresAt };
  }

  async revokeFamily(familyId: string, db: Db = this.prisma.client): Promise<number> {
    const result = await db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Ends every sign-in of an employee (deactivation, password reset/change), optionally keeping one family. */
  async revokeAllForEmployee(
    employeeId: string,
    options: { exceptFamilyId?: string } = {},
    db: Db = this.prisma.client,
  ): Promise<number> {
    const result = await db.session.updateMany({
      where: {
        employeeId,
        revokedAt: null,
        ...(options.exceptFamilyId ? { familyId: { not: options.exceptFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** The caller's own live sign-ins. */
  listLive(employeeId: string) {
    return this.prisma.client.session.findMany({
      where: { employeeId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        familyId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  /** Revokes one of the caller's own sign-ins by its live row id. */
  async revokeOwn(employeeId: string, sessionRowId: string): Promise<boolean> {
    const row = await this.prisma.client.session.findFirst({
      where: { id: sessionRowId, employeeId, revokedAt: null },
      select: { familyId: true },
    });
    if (!row) return false;
    await this.revokeFamily(row.familyId);
    return true;
  }

  /** Family of a refresh token (used by logout when the access token already expired). */
  async familyOfRefreshToken(token: string): Promise<{ familyId: string; employeeId: string } | null> {
    const row = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { familyId: true, employeeId: true },
    });
    return row;
  }
}
