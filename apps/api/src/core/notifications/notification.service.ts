import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type NotificationDb = Pick<PrismaClient, 'notification'> | Prisma.TransactionClient;

export interface NotificationInput {
  organizationId: string;
  recipientId: string;
  /** UPPER_SNAKE or dotted type key, e.g. `AUDIT.REVIEW_REQUIRED`. Modules never hard-code delivery. */
  type: string;
  subject: string;
  /** Short text or reference. Never PHI. */
  message?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * The one boundary every module uses to notify people (in-app today; the email outbox plugs in behind the same
 * call later). Modules never write the `notifications` table themselves.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotificationInput, db: NotificationDb = this.prisma.client) {
    return db.notification.create({ data: { ...input } });
  }

  /** One notification per distinct recipient (e.g. every Manager when an audit needs review). */
  async notifyMany(
    recipientIds: readonly string[],
    input: Omit<NotificationInput, 'recipientId'>,
    db: NotificationDb = this.prisma.client,
  ): Promise<number> {
    const unique = [...new Set(recipientIds)];
    if (unique.length === 0) return 0;
    const result = await db.notification.createMany({
      data: unique.map((recipientId) => ({ ...input, recipientId })),
    });
    return result.count;
  }

  listFor(recipientId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.prisma.client.notification.findMany({
      where: { recipientId, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 50, 200),
    });
  }

  countUnread(recipientId: string): Promise<number> {
    return this.prisma.client.notification.count({ where: { recipientId, readAt: null } });
  }

  /** Marks one of the recipient's own notifications as read; false when it was not theirs or already read. */
  async markRead(recipientId: string, notificationId: string): Promise<boolean> {
    const result = await this.prisma.client.notification.updateMany({
      where: { id: notificationId, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count === 1;
  }
}
