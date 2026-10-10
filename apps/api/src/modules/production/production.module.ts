import { Module } from '@nestjs/common';
import { CoderDashboardController } from './coder-dashboard.controller';
import { CoderDashboardService } from './coder-dashboard.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  controllers: [ProductionController, CoderDashboardController],
  providers: [ProductionService, CoderDashboardService],
})
export class ProductionModule {}
