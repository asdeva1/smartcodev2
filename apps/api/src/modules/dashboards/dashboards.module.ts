import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { ManagerDashboardService } from './manager-dashboard.service';

@Module({ controllers: [DashboardsController], providers: [ManagerDashboardService] })
export class DashboardsModule {}
