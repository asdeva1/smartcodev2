import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { CoderDashboardService } from './coder-dashboard.service';

/** The signed-in coder's own dashboard figures. */
@Controller('production/dashboard')
export class CoderDashboardController {
  constructor(private readonly dashboard: CoderDashboardService) {}

  @Get()
  @RequirePermission('production.submit')
  mine(@CurrentPrincipal() p: Principal) {
    return this.dashboard.dashboard(p);
  }
}
