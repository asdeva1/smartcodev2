import { Controller, Get, Query } from '@nestjs/common';
import { type ChartLookupQuery, chartLookupQuerySchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { AllocationService } from './allocation.service';

/** Chart Allocation — Manager only (`chart.allocate`). */
@Controller('allocation')
export class AllocationController {
  constructor(private readonly allocation: AllocationService) {}

  /** Search a Chart ID: Login Name, assigned employee, who allocated it and when. */
  @Get('charts')
  @RequirePermission('chart.allocate')
  search(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(chartLookupQuerySchema)) query: ChartLookupQuery,
  ) {
    return this.allocation.searchCharts(p, query.q);
  }
}
