import { Global, Module } from '@nestjs/common';
import { ApprovalService } from '../approvals/approval.service';
import { ActivityLogService } from '../audit/activity-log.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Cross-cutting data services every business module reuses: notifications, the universal approval engine,
 * the activity timeline and the security audit log. (PrismaModule is global.)
 */
@Global()
@Module({
  providers: [NotificationService, ApprovalService, ActivityLogService, AuditLogService],
  exports: [NotificationService, ApprovalService, ActivityLogService, AuditLogService],
})
export class CoreDataModule {}
