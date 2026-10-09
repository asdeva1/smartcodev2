import { Controller, Get, Param, Query } from '@nestjs/common';
import { type ChartRepositoryQuery, chartRepositoryQuerySchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { ChartRepositoryService } from './chart-repository.service';

@Controller('charts')
export class ChartsController {
  constructor(private readonly repository: ChartRepositoryService) {}

  /** Charts across every project the caller can see. */
  @Get()
  @RequirePermission('chart.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(chartRepositoryQuerySchema)) q: ChartRepositoryQuery,
  ) {
    return this.repository.list(p, q);
  }

  /** The full status history of one chart. */
  @Get(':id/timeline')
  @RequirePermission('chart.read')
  timeline(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.repository.timeline(p, id);
  }
}
