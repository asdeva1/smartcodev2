import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  type BulkActivation,
  type CsvCommit,
  type CsvUpload,
  type DeactivateRequest,
  type EmployeeCreate,
  type EmployeeListQuery,
  type EmployeeUpdate,
  type RoleChange,
  bulkActivationSchema,
  csvCommitSchema,
  csvUploadSchema,
  deactivateSchema,
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeUpdateSchema,
  roleChangeSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { EmployeeImportService } from './csv-import.service';
import { EmployeesService } from './employees.service';
import { UuidParamPipe } from './uuid-param.pipe';

/**
 * Employee Directory API. Permission guard (role) → service (scope from the principal; out-of-scope = 404).
 * Nothing here accepts or returns a password, hash or token value.
 */
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly imports: EmployeeImportService,
  ) {}

  @Get()
  @RequirePermission('employee.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(employeeListQuerySchema)) q: EmployeeListQuery,
  ) {
    return this.employees.list(p, q);
  }

  /** The directory as a CSV file, with the same filters as the list. Static path — before `:id`. */
  @Get('export')
  @RequirePermission('employee.read')
  async export(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(employeeListQuerySchema)) q: EmployeeListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.employees.exportCsv(p, q);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.body);
  }

  /** Filter and form choices (vendors, teams, projects) within the caller's scope. Static path — before `:id`. */
  @Get('options')
  @RequirePermission('employee.read')
  options(@CurrentPrincipal() p: Principal) {
    return this.employees.options(p);
  }

  @Post()
  @RequirePermission('employee.create')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(employeeCreateSchema)) body: EmployeeCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.create(p, body, meta);
  }

  // ───── bulk (static paths before :id) ─────

  @Post('import/preview')
  @RequirePermission('employee.create')
  @HttpCode(200)
  previewImport(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(csvUploadSchema)) body: CsvUpload,
  ) {
    return this.imports.preview(p, body.csv);
  }

  @Post('import/commit')
  @RequirePermission('employee.create')
  @HttpCode(200)
  commitImport(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(csvCommitSchema)) body: CsvCommit,
    @Meta() meta: RequestMeta,
  ) {
    return this.imports.commit(p, body.csv, body.mode, meta);
  }

  @Post('activation-emails')
  @RequirePermission('employee.sendActivation')
  @HttpCode(200)
  sendActivationBulk(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(bulkActivationSchema)) body: BulkActivation,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.sendActivationBulk(p, body.employeeIds, meta);
  }

  // ───── one employee ─────

  @Get(':id/timeline')
  @RequirePermission('employee.read')
  timeline(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.employees.timeline(p, id);
  }

  @Get(':id')
  @RequirePermission('employee.read')
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.employees.get(p, id);
  }

  @Patch(':id')
  @RequirePermission('employee.update')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(employeeUpdateSchema)) body: EmployeeUpdate,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.update(p, id, body, meta);
  }

  @Post(':id/activation-email')
  @RequirePermission('employee.sendActivation')
  @HttpCode(200)
  sendActivation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.sendActivation(p, id, meta);
  }

  @Post(':id/password-reset')
  @RequirePermission('employee.triggerPasswordReset')
  @HttpCode(200)
  passwordReset(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.triggerPasswordReset(p, id, meta);
  }

  @Post(':id/deactivate')
  @RequirePermission('employee.deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(deactivateSchema)) body: DeactivateRequest,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.deactivate(p, id, body, meta);
  }

  @Post(':id/reactivate')
  @RequirePermission('employee.deactivate')
  @HttpCode(200)
  reactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.reactivate(p, id, meta);
  }

  /** Manager only (`employee.changeRole` is in MANAGER_ONLY_PERMISSIONS). */
  @Post(':id/role')
  @RequirePermission('employee.changeRole')
  @HttpCode(200)
  changeRole(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(roleChangeSchema)) body: RoleChange,
    @Meta() meta: RequestMeta,
  ) {
    return this.employees.changeRole(p, id, body, meta);
  }
}
