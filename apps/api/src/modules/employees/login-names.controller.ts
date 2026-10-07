import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type CsvCommit,
  type CsvUpload,
  type LoginNameAssign,
  type LoginNameRelease,
  csvCommitSchema,
  csvUploadSchema,
  loginNameAssignSchema,
  loginNameReleaseSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { LoginNameImportService } from './csv-import.service';
import { LoginNamesService, loginNameListQuerySchema } from './login-names.service';
import { UuidParamPipe } from './uuid-param.pipe';

/**
 * SmartClues Login Names. Reading follows the employee scope; assigning, changing, releasing and the CSV import are
 * `loginName.assign` — held by the Manager and nobody else (HR, Vendor Admin, Team Lead, Auditor, Coder get 403).
 */
@Controller()
export class LoginNamesController {
  constructor(
    private readonly loginNames: LoginNamesService,
    private readonly imports: LoginNameImportService,
  ) {}

  @Get('login-names')
  @RequirePermission('loginName.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(loginNameListQuerySchema))
    q: ReturnType<typeof loginNameListQuerySchema.parse>,
  ) {
    return this.loginNames.list(p, q);
  }

  @Get('employees/:id/login-names')
  @RequirePermission('loginName.read')
  history(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.loginNames.history(p, id);
  }

  @Post('login-names/assignments')
  @RequirePermission('loginName.assign')
  @HttpCode(200)
  assign(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(loginNameAssignSchema)) body: LoginNameAssign,
    @Meta() meta: RequestMeta,
  ) {
    return this.loginNames.assign(p, body.employeeId, body.loginName, meta);
  }

  @Post('login-names/release')
  @RequirePermission('loginName.assign')
  @HttpCode(200)
  release(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(loginNameReleaseSchema)) body: LoginNameRelease,
    @Meta() meta: RequestMeta,
  ) {
    return this.loginNames.release(p, body.employeeId, meta);
  }

  @Post('login-names/import/preview')
  @RequirePermission('loginName.assign')
  @HttpCode(200)
  previewImport(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(csvUploadSchema)) body: CsvUpload,
  ) {
    return this.imports.preview(p, body.csv);
  }

  @Post('login-names/import/commit')
  @RequirePermission('loginName.assign')
  @HttpCode(200)
  commitImport(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(csvCommitSchema)) body: CsvCommit,
    @Meta() meta: RequestMeta,
  ) {
    return this.imports.commit(p, body.csv, body.mode, meta);
  }
}
