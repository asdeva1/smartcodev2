import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { type ProductionSubmit, productionSubmitSchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { ProductionService } from './production.service';

/** Coder production — only the allocated coder (`production.submit`, own records). */
@Controller('production/charts')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post(':id/open')
  @RequirePermission('production.submit')
  @HttpCode(200)
  open(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.production.open(p, id);
  }

  @Post(':id/submit')
  @RequirePermission('production.submit')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(productionSubmitSchema)) body: ProductionSubmit,
    @Meta() meta: RequestMeta,
  ) {
    return this.production.submit(p, id, body, meta);
  }
}
