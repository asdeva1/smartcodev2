import { Module } from '@nestjs/common';
import { HrIntegrationController } from './hr-integration.controller';
import { HR_INTEGRATION } from './hr-integration.port';
import { NullHrAdapter } from './null-hr.adapter';

@Module({
  controllers: [HrIntegrationController],
  providers: [{ provide: HR_INTEGRATION, useClass: NullHrAdapter }],
  exports: [HR_INTEGRATION],
})
export class HrIntegrationModule {}
