import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { ManagerDashboardService } from './manager-dashboard.service';
import { VendorDashboardService } from './vendor-dashboard.service';

@Module({ controllers: [DashboardsController], providers: [ManagerDashboardService, VendorDashboardService] })
export class DashboardsModule {}
