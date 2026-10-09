import { Injectable } from '@nestjs/common';
import type { HrEmployeeSnapshot, HrIntegrationPort } from './hr-integration.port';

/** Default adapter: no HRMS is connected, so nothing is read or written. */
@Injectable()
export class NullHrAdapter implements HrIntegrationPort {
  readonly name = 'none';
  readonly configured = false;

  async findByEmployeeId(): Promise<HrEmployeeSnapshot | null> {
    return null;
  }
}
