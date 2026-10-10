import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type ApprovalCreate,
  type ApprovalDecision,
  type ApprovalListQuery,
  approvalCreateSchema,
  approvalDecisionSchema,
  approvalListQuerySchema,
} from '@smartcode/shared';
import { AuthenticatedOnly, CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** A Manager sees every request; everyone else sees only the ones they asked for. */
  @Get()
  @AuthenticatedOnly()
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(approvalListQuerySchema)) q: ApprovalListQuery,
  ) {
    return this.approvals.list(p, q);
  }

  /** Ask for something. Who may ask for what is checked per request type. */
  @Post()
  @AuthenticatedOnly()
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(approvalCreateSchema)) body: ApprovalCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.approvals.create(p, body, meta);
  }

  @Post(':id/cancel')
  @AuthenticatedOnly()
  @HttpCode(200)
  cancel(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.approvals.cancel(p, id, meta);
  }

  @Post(':id/decision')
  @RequirePermission('approval.decide')
  @HttpCode(200)
  decide(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(approvalDecisionSchema)) body: ApprovalDecision,
    @Meta() meta: RequestMeta,
  ) {
    return this.approvals.decide(p, id, body, meta);
  }
}
