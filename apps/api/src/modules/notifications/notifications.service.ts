import { Injectable } from '@nestjs/common';
import type { NotificationList } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface NewNotification {
  organizationId: string;
  recipientId: string;
  type: string;
  subject: string;
  message?: string;
  entityType?: string;
  entityId?: string;
}

/** Creates a notification inside the caller's transaction, so it exists if and only if the event did. */
export async function createNotification(tx: Tx, n: NewNotification): Promise<void> {
  await tx.notification.create({
    data: {
      organizationId: n.organizationId,
      recipientId: n.recipientId,
      type: n.type,
      subject: n.subject,
      message: n.message ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    },
  });
}

/** Everyone sees only their own notifications (permission `notification.read`, scope SELF). */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(principal: Principal): Promise<NotificationList> {
    const db = this.prisma.client;
    const [unread, rows] = await Promise.all([
      db.notification.count({ where: { recipientId: principal.employeeId, readAt: null } }),
      db.notification.findMany({
        where: { recipientId: principal.employeeId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
      }),
    ]);
    return {
      unread,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        subject: r.subject,
        message: r.message,
        entityType: r.entityType,
        entityId: r.entityId,
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async markRead(principal: Principal, id: string): Promise<void> {
    const row = await this.prisma.client.notification.findFirst({
      where: { id, recipientId: principal.employeeId },
      select: { id: true, readAt: true },
    });
    if (!row) throw new ProblemException(404, 'NOT_FOUND', 'Notification not found');
    if (row.readAt) return; // already read: nothing to do
    await this.prisma.client.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(principal: Principal): Promise<{ marked: number }> {
    const r = await this.prisma.client.notification.updateMany({
      where: { recipientId: principal.employeeId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: r.count };
  }
}
