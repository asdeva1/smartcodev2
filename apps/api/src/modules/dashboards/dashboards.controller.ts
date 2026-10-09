import { Controller, Get, Query } from '@nestjs/common';
import { type ManagerDashboardQuery, managerDashboardQuerySchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { ManagerDashboardService } from './manager-dashboard.service';

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly manager: ManagerDashboardService) {}

  /** Organization-wide figures, in-house and vendors combined (optionally one vendor or in-house only). */
  @Get('manager')
  @RequirePermission('dashboard.manager')
  managerDashboard(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(managerDashboardQuerySchema)) q: ManagerDashboardQuery,
  ) {
    return this.manager.dashboard(p, q);
  }
}
