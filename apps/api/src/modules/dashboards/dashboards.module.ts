import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { ManagerDashboardService } from './manager-dashboard.service';
import { CoachDashboardService } from './coach-dashboard.service';
import { TeamLeadDashboardService } from './team-lead-dashboard.service';
import { VendorDashboardService } from './vendor-dashboard.service';

@Module({
  controllers: [DashboardsController],
  providers: [
    ManagerDashboardService,
    VendorDashboardService,
    TeamLeadDashboardService,
    CoachDashboardService,
  ],
})
export class DashboardsModule {}
