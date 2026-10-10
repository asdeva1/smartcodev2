import { Controller, Get, Query } from '@nestjs/common';
import {
  type ActivityLogQuery,
  type AuditLogQuery,
  activityLogQuerySchema,
  auditLogQuerySchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { LogsService } from './logs.service';

@Controller()
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** The security and business audit trail. Manager only. */
  @Get('audit-logs')
  @RequirePermission('auditLog.read')
  audit(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) q: AuditLogQuery,
  ) {
    return this.logs.audit(p, q);
  }

  /** The activity timeline, limited to the caller's scope. */
  @Get('activity')
  @RequirePermission('activityLog.read')
  activity(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(activityLogQuerySchema)) q: ActivityLogQuery,
  ) {
    return this.logs.activity(p, q);
  }
}
