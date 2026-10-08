import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type VendorCreate,
  type VendorListQuery,
  type VendorUpdate,
  vendorCreateSchema,
  vendorListQuerySchema,
  vendorUpdateSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { VendorsService } from './vendors.service';

/** Vendor API. Reads: Manager (all) and Vendor Admin (own vendor). Writes: Manager only (`vendor.manage`). */
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermission('vendor.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(vendorListQuerySchema)) q: VendorListQuery,
  ) {
    return this.vendors.list(p, q);
  }

  @Post()
  @RequirePermission('vendor.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(vendorCreateSchema)) body: VendorCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.vendors.create(p, body, meta);
  }

  @Get(':id')
  @RequirePermission('vendor.read')
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.vendors.get(p, id);
  }

  @Patch(':id')
  @RequirePermission('vendor.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(vendorUpdateSchema)) body: VendorUpdate,
    @Meta() meta: RequestMeta,
  ) {
    return this.vendors.update(p, id, body, meta);
  }

  @Post(':id/deactivate')
  @RequirePermission('vendor.manage')
  @HttpCode(200)
  deactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.vendors.deactivate(p, id, meta);
  }

  @Post(':id/reactivate')
  @RequirePermission('vendor.manage')
  @HttpCode(200)
  reactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.vendors.reactivate(p, id, meta);
  }
}
