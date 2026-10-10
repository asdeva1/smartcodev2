import { Controller, Get, Inject } from '@nestjs/common';
import { HR_INTEGRATION_POINTS, type HrIntegrationStatus } from '@smartcode/shared';
import { RequirePermission } from '../../core/auth/decorators';
import { HR_INTEGRATION, type HrIntegrationPort } from './hr-integration.port';

@Controller('hr-integration')
export class HrIntegrationController {
  constructor(@Inject(HR_INTEGRATION) private readonly adapter: HrIntegrationPort) {}

  /** Whether an HRMS is connected, and the integration points that would be used (D-09). */
  @Get('status')
  @RequirePermission('hrIntegration.read')
  status(): HrIntegrationStatus {
    return {
      configured: this.adapter.configured,
      adapter: this.adapter.name,
      identity: 'EMPLOYEE_ID',
      message: this.adapter.configured
        ? 'Smart HRMS is connected.'
        : 'Smart HRMS is not connected yet. It will be connected once its API specification is provided. Until then employees are managed in SmartCode.',
      points: [...HR_INTEGRATION_POINTS],
    };
  }
}
