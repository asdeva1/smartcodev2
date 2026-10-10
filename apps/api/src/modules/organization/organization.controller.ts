import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type OrganizationUpdate, organizationUpdateSchema } from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { OrganizationService } from './organization.service';

/** Organization profile and base settings. Manager only. */
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission('settings.manage')
  get(@CurrentPrincipal() p: Principal) {
    return this.organization.get(p);
  }

  @Patch()
  @RequirePermission('settings.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(organizationUpdateSchema)) body: OrganizationUpdate,
    @Meta() meta: RequestMeta,
  ) {
    return this.organization.update(p, body, meta);
  }
}
