import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeLogPayload } from './redact';

export type DbClient = Pick<PrismaClient, 'activityLog' | 'auditLog'> | Prisma.TransactionClient;

export interface ActivityInput {
  organizationId: string;
  actorId?: string | null;
  /** UPPER_SNAKE or dotted, e.g. `CHART.ALLOCATED`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Counts and identifiers only — never credentials, tokens or PHI (forbidden keys are dropped). */
  metadata?: Record<string, unknown>;
}

/**
 * Human-readable activity timeline ("Manager X allocated 120 charts"). Append-only table. Pass the transaction
 * client to write the entry atomically with the business change.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: ActivityInput, db: DbClient = this.prisma.client): Promise<void> {
    await db.activityLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: (sanitizeLogPayload(input.metadata ?? {}) ?? {}) as Prisma.InputJsonObject,
      },
    });
  }
}
