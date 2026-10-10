import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type TeamCreate,
  type TeamListQuery,
  type TeamMemberAdd,
  type TeamUpdate,
  teamCreateSchema,
  teamListQuerySchema,
  teamMemberAddSchema,
  teamUpdateSchema,
} from '@smartcode/shared';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { TeamsService } from './teams.service';

/** Team API. Reads follow `team.read` scope; changes need `team.manage` (Manager, or Vendor Admin for own vendor). */
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('team.read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(teamListQuerySchema)) q: TeamListQuery,
  ) {
    return this.teams.list(p, q);
  }

  @Post()
  @RequirePermission('team.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(teamCreateSchema)) body: TeamCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.create(p, body, meta);
  }

  @Get(':id')
  @RequirePermission('team.read')
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.teams.get(p, id);
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(teamUpdateSchema)) body: TeamUpdate,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.update(p, id, body, meta);
  }

  @Post(':id/deactivate')
  @RequirePermission('team.manage')
  @HttpCode(200)
  deactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.deactivate(p, id, meta);
  }

  @Post(':id/reactivate')
  @RequirePermission('team.manage')
  @HttpCode(200)
  reactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.reactivate(p, id, meta);
  }

  @Post(':id/members')
  @RequirePermission('team.manage')
  @HttpCode(200)
  addMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(teamMemberAddSchema)) body: TeamMemberAdd,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.addMember(p, id, body.employeeId, meta);
  }

  @Delete(':id/members/:employeeId')
  @RequirePermission('team.manage')
  removeMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Param('employeeId', new UuidParamPipe()) employeeId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.teams.removeMember(p, id, employeeId, meta);
  }
}
