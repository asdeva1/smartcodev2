import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  type InternalReviewCreate,
  type InternalReviewListQuery,
  type InternalSampleQuery,
  internalReviewCreateSchema,
  internalReviewListQuerySchema,
  internalSampleQuerySchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { InternalAuditService } from './internal-audit.service';

/** Internal Audit workspace. Manager only (`internalAudit.access`). */
@Controller('internal-audit')
export class InternalAuditController {
  constructor(private readonly internal: InternalAuditService) {}

  @Get('sample')
  @RequirePermission('internalAudit.access')
  sample(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(internalSampleQuerySchema)) q: InternalSampleQuery,
  ) {
    return this.internal.sample(p, q);
  }

  @Get('summary')
  @RequirePermission('internalAudit.access')
  summary(@CurrentPrincipal() p: Principal) {
    return this.internal.summary(p);
  }

  @Get('reviews')
  @RequirePermission('internalAudit.access')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(internalReviewListQuerySchema)) q: InternalReviewListQuery,
  ) {
    return this.internal.list(p, q);
  }

  @Post('reviews')
  @RequirePermission('internalAudit.access')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(internalReviewCreateSchema)) body: InternalReviewCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.internal.create(p, body, meta);
  }
}
