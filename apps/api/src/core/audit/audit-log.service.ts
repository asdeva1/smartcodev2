import { Injectable } from '@nestjs/common';
import type { AuditAction, Role } from '@smartcode/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { DbClient } from './activity-log.service';
import { sanitizeLogPayload } from './redact';

export interface AuditLogInput {
  organizationId: string;
  actorId?: string | null;
  actorRole?: Role | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

/**
 * Security / business audit log (login, employee creation, activation, role change, login-name assignment,
 * chart allocation, production, audit, Manager resolution, rework, re-audit, vendor access, project assignment).
 * Append-only in PostgreSQL. Credentials, tokens and PHI are stripped here and rejected by the database.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditLogInput, db: DbClient = this.prisma.client): Promise<void> {
    const json = (value: Record<string, unknown> | null | undefined) =>
      value ? ((sanitizeLogPayload(value) ?? {}) as Prisma.InputJsonObject) : undefined;
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        outcome: input.outcome ?? 'SUCCESS',
        beforeData: json(input.before),
        afterData: json(input.after),
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null,
      },
    });
  }
}
