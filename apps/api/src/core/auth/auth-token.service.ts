import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import type { Prisma } from '../../generated/prisma/client';
import { ProblemException } from '../errors/problem';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, issueToken } from './opaque-token';

export type AuthTokenKind = 'ACTIVATION' | 'PASSWORD_RESET';
type Tx = Prisma.TransactionClient;

export const INVALID_LINK_MESSAGE =
  'This link is invalid, has expired or was already used. Ask your Manager to send a new activation link, or request a new password reset.';

/**
 * Activation and password-reset links (docs/06 §2): 256-bit random, stored as SHA-256 only, single use, expiring.
 * The raw value exists only in the email and is never returned by the API, logged or shown to a Manager.
 */
@Injectable()
export class AuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Issues a new link, revoking any live link of the same type for that employee (one live link at a time). */
  async issue(
    tx: Tx,
    employeeId: string,
    type: AuthTokenKind,
    issuedById: string | null,
  ): Promise<{ token: string; expiresAt: Date }> {
    await tx.authToken.updateMany({
      where: { employeeId, type, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const { token, hash } = issueToken();
    const expiresAt = new Date(
      Date.now() + this.config.ms(type === 'ACTIVATION' ? 'ACTIVATION_TOKEN_TTL' : 'RESET_TOKEN_TTL'),
    );
    await tx.authToken.create({
      data: { employeeId, type, tokenHash: hash, expiresAt, issuedById },
    });
    return { token, expiresAt };
  }

  /** Non-consuming check for the web form ("is this link still good?"). */
  async inspect(
    type: AuthTokenKind,
    token: string,
  ): Promise<{ valid: false } | { valid: true; fullName: string }> {
    const row = await this.prisma.client.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { employee: { select: { fullName: true, status: true } } },
    });
    const usable =
      row &&
      row.type === type &&
      row.usedAt === null &&
      row.revokedAt === null &&
      row.expiresAt > new Date() &&
      (type === 'ACTIVATION'
        ? row.employee.status === 'PENDING_ACTIVATION'
        : row.employee.status === 'ACTIVE');
    return usable ? { valid: true, fullName: row.employee.fullName } : { valid: false };
  }

  /**
   * Atomically consumes a link inside the caller's transaction. Race-safe: only one concurrent request can flip
   * `used_at`. Throws the same generic 400 for unknown, wrong-type, used, revoked and expired links.
   */
  async consume(tx: Tx, type: AuthTokenKind, token: string) {
    const row = await tx.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { employee: true },
    });
    if (!row || row.type !== type) throw invalidLink();
    const now = new Date();
    const claimed = await tx.authToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalidLink();
    return row.employee;
  }

  /** Invalidates every other live link of the employee (after activation / reset). */
  async revokeAllLive(tx: Tx, employeeId: string): Promise<void> {
    await tx.authToken.updateMany({
      where: { employeeId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export function invalidLink(): ProblemException {
  return new ProblemException(400, 'TOKEN_INVALID', INVALID_LINK_MESSAGE);
}
