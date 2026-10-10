import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type AuditResolve,
  type AuditSubmit,
  type ReworkSubmit,
  auditResolveSchema,
  auditSubmitSchema,
  reworkSubmitSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { AuditsService } from './audits.service';
import { ReworkService } from './rework.service';

/** Audit queue (Auditor), Manager review and Coder rework. */
@Controller()
export class AuditsController {
  constructor(
    private readonly audits: AuditsService,
    private readonly rework: ReworkService,
  ) {}

  @Get('audits/queue')
  @RequirePermission('audit.perform')
  queue(@CurrentPrincipal() p: Principal) {
    return this.audits.queue(p);
  }

  @Post('audits/charts/:id/submit')
  @RequirePermission('audit.perform')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(auditSubmitSchema)) body: AuditSubmit,
    @Meta() meta: RequestMeta,
  ) {
    return this.audits.submit(p, id, body, meta);
  }

  /** Only the Manager (`audit.resolveReview`) sees and resolves reviews — decision D-01. */
  @Get('audits/reviews')
  @RequirePermission('audit.resolveReview')
  reviews(@CurrentPrincipal() p: Principal) {
    return this.audits.reviews(p);
  }

  @Post('audits/:id/resolve')
  @RequirePermission('audit.resolveReview')
  @HttpCode(200)
  resolve(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(auditResolveSchema)) body: AuditResolve,
    @Meta() meta: RequestMeta,
  ) {
    return this.audits.resolve(p, id, body, meta);
  }

  @Get('rework/mine')
  @RequirePermission('rework.perform')
  myRework(@CurrentPrincipal() p: Principal) {
    return this.rework.mine(p);
  }

  @Post('rework/:id/submit')
  @RequirePermission('rework.perform')
  @HttpCode(200)
  submitRework(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(reworkSubmitSchema)) body: ReworkSubmit,
    @Meta() meta: RequestMeta,
  ) {
    return this.rework.submit(p, id, body, meta);
  }
}
