import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AssignChart,
  type ChartIdList,
  type ClientPullback,
  type CsvCommit,
  type CsvUpload,
  type ProjectChartsQuery,
  type ProjectCreate,
  type ProjectLeadInput,
  type ProjectListQuery,
  type ProjectMemberAdd,
  type ProjectUpdate,
  type ReportQuery,
  type SubmitToClient,
  assignChartSchema,
  chartIdListSchema,
  clientPullbackSchema,
  csvCommitSchema,
  csvUploadSchema,
  projectChartsQuerySchema,
  projectCreateSchema,
  projectLeadSchema,
  projectListQuerySchema,
  projectMemberAddSchema,
  projectUpdateSchema,
  reportQuerySchema,
  submitToClientSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { ProjectAllocationService } from './project-allocation.service';
import { ProjectReportsService } from './project-reports.service';
import { ProjectsService } from './projects.service';

/**
 * Projects. Reads follow the caller's scope (Manager: all, Vendor Admin: own vendor, others: projects they are staffed
 * on). Creating, staffing and every allocation action are Manager-only.
 */
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly allocation: ProjectAllocationService,
    private readonly reports: ProjectReportsService,
  ) {}

  @Get()
  @RequirePermission('project.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(projectListQuerySchema)) q: ProjectListQuery,
  ) {
    return this.projects.list(p, q);
  }

  @Post()
  @RequirePermission('project.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(projectCreateSchema)) body: ProjectCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.projects.create(p, body, meta);
  }

  @Get('clients')
  @RequirePermission('project.read')
  clients(@CurrentPrincipal() p: Principal) {
    return this.projects.clients(p);
  }

  @Get(':id')
  @RequirePermission('project.read')
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.projects.get(p, id);
  }

  @Patch(':id')
  @RequirePermission('project.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(projectUpdateSchema)) body: ProjectUpdate,
    @Meta() meta: RequestMeta,
  ) {
    return this.projects.update(p, id, body, meta);
  }

  // ───── staffing ─────

  @Post(':id/lead')
  @RequirePermission('project.assignStaff')
  @HttpCode(200)
  setLead(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(projectLeadSchema)) body: ProjectLeadInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.projects.setLead(p, id, body.employeeId, meta);
  }

  @Post(':id/members')
  @RequirePermission('project.assignStaff')
  @HttpCode(200)
  addMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(projectMemberAddSchema)) body: ProjectMemberAdd,
    @Meta() meta: RequestMeta,
  ) {
    return this.projects.addMember(p, id, body, meta);
  }

  @Delete(':id/members/:employeeId')
  @RequirePermission('project.assignStaff')
  removeMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Param('employeeId', new UuidParamPipe()) employeeId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.projects.removeMember(p, id, employeeId, meta);
  }

  // ───── charts & allocation (Manual projects) ─────

  @Get(':id/charts')
  @RequirePermission('chart.read')
  charts(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Query(new ZodValidationPipe(projectChartsQuerySchema)) q: ProjectChartsQuery,
  ) {
    return this.projects.charts(p, id, q);
  }

  @Post(':id/allocation/preview')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  previewAllocation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(csvUploadSchema)) body: CsvUpload,
  ) {
    return this.allocation.preview(p, id, body.csv);
  }

  @Post(':id/allocation/commit')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  commitAllocation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(csvCommitSchema)) body: CsvCommit,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.commit(p, id, body.csv, body.mode, meta);
  }

  @Post(':id/charts/import/preview')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  previewRepository(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(csvUploadSchema)) body: CsvUpload,
  ) {
    return this.allocation.previewRepository(p, id, body.csv);
  }

  @Post(':id/charts/import/commit')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  commitRepository(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(csvCommitSchema)) body: CsvCommit,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.commitRepository(p, id, body.csv, body.mode, meta);
  }

  @Post(':id/charts/assign')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  assignChart(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(assignChartSchema)) body: AssignChart,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.assign(p, id, body, meta);
  }

  @Post(':id/charts/pull-back')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  pullBack(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(chartIdListSchema)) body: ChartIdList,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.pullBack(p, id, body.chartIds, body.reason, meta);
  }

  @Post(':id/charts/submit-to-client')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  submitToClient(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(submitToClientSchema)) body: SubmitToClient,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.submitToClient(p, id, body.chartIds, meta);
  }

  @Post(':id/client-pullback')
  @RequirePermission('chart.allocate')
  @HttpCode(200)
  clientPullback(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(clientPullbackSchema)) body: ClientPullback,
    @Meta() meta: RequestMeta,
  ) {
    return this.allocation.clientPullback(p, id, body.reason, meta);
  }

  // ───── live tracking & reports ─────

  @Get(':id/live')
  @RequirePermission('chart.read')
  live(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.reports.live(p, id);
  }

  @Get(':id/reports/production')
  @RequirePermission('report.read')
  production(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
  ) {
    return this.reports.production(p, id, q);
  }

  @Get(':id/reports/quality')
  @RequirePermission('report.read')
  quality(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
  ) {
    return this.reports.quality(p, id, q);
  }
}
