import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { type ManagerDashboardQuery, managerDashboardQuerySchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { ManagerDashboardService } from './manager-dashboard.service';
import { CoachDashboardService } from './coach-dashboard.service';
import { TeamLeadDashboardService } from './team-lead-dashboard.service';
import { VendorDashboardService } from './vendor-dashboard.service';

const vendorDashboardQuerySchema = z.object({ vendorId: z.string().uuid().optional() });

@Controller('dashboards')
export class DashboardsController {
  constructor(
    private readonly manager: ManagerDashboardService,
    private readonly vendor: VendorDashboardService,
    private readonly teamLead: TeamLeadDashboardService,
    private readonly coach: CoachDashboardService,
  ) {}

  /** Organization-wide figures, in-house and vendors combined (optionally one vendor or in-house only). */
  @Get('manager')
  @RequirePermission('dashboard.manager')
  managerDashboard(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(managerDashboardQuerySchema)) q: ManagerDashboardQuery,
  ) {
    return this.manager.dashboard(p, q);
  }

  /** A Vendor Admin's own vendor (the query is ignored); a Manager chooses a vendor with ?vendorId=. */
  @Get('vendor')
  @RequirePermission('dashboard.vendor')
  vendorDashboard(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(vendorDashboardQuerySchema)) q: { vendorId?: string },
  ) {
    return this.vendor.dashboard(p, q.vendorId);
  }

  /** The teams the caller leads: totals, pending audit/review/rework and a row per coder. */
  @Get('team-lead')
  @RequirePermission('dashboard.teamLead')
  teamLeadDashboard(@CurrentPrincipal() p: Principal) {
    return this.teamLead.dashboard(p);
  }

  /** Audit quality across the projects the caller (Quality Coach / SME) is staffed on. */
  @Get('coach')
  @RequirePermission('dashboard.groupCoach')
  coachDashboard(@CurrentPrincipal() p: Principal) {
    return this.coach.dashboard(p);
  }
}
