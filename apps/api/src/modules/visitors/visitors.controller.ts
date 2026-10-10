import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type VisitCreate,
  type VisitListQuery,
  visitCancelSchema,
  visitCreateSchema,
  visitListQuerySchema,
} from '@smartcode/shared';
import { z } from 'zod';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { VisitorsService } from './visitors.service';

const visitorSearchSchema = z.object({ q: z.string().trim().max(100).optional() });

/** Visitor Management. HR and the Manager (`visitor.manage`). */
@Controller()
export class VisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get('visits')
  @RequirePermission('visitor.manage')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(visitListQuerySchema)) q: VisitListQuery,
  ) {
    return this.visitors.list(p, q);
  }

  @Post('visits')
  @RequirePermission('visitor.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(visitCreateSchema)) body: VisitCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.visitors.create(p, body, meta);
  }

  @Get('visitors')
  @RequirePermission('visitor.manage')
  search(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(visitorSearchSchema)) q: { q?: string },
  ) {
    return this.visitors.searchVisitors(p, q.q);
  }

  @Get('visits/:id')
  @RequirePermission('visitor.manage')
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.visitors.get(p, id);
  }

  @Post('visits/:id/check-in')
  @RequirePermission('visitor.manage')
  @HttpCode(200)
  checkIn(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.visitors.checkIn(p, id, meta);
  }

  @Post('visits/:id/check-out')
  @RequirePermission('visitor.manage')
  @HttpCode(200)
  checkOut(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.visitors.checkOut(p, id, meta);
  }

  @Post('visits/:id/cancel')
  @RequirePermission('visitor.manage')
  @HttpCode(200)
  cancel(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(visitCancelSchema)) body: { reason?: string },
    @Meta() meta: RequestMeta,
  ) {
    return this.visitors.cancel(p, id, body.reason, meta);
  }

  @Get('visits/:id/badge')
  @RequirePermission('visitor.manage')
  badge(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.visitors.badge(p, id);
  }
}
