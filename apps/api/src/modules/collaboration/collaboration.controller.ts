import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CallTokenInput,
  type ChannelCreate,
  type ChannelMemberAdd,
  type DirectChannelInput,
  type MessageCreate,
  type MessageListQuery,
  type PeopleQuery,
  callTokenSchema,
  channelCreateSchema,
  channelMemberAddSchema,
  directChannelSchema,
  messageCreateSchema,
  messageListQuerySchema,
  peopleQuerySchema,
} from '@smartcode/shared';
import { AuthenticatedOnly, CurrentPrincipal } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { Meta, type RequestMeta } from '../../core/auth/request-meta';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { CollaborationService } from './collaboration.service';

/**
 * Chat, channels and calls for every signed-in person. Who may see what is decided in the service (vendor boundary,
 * membership), so each route is open to any authenticated caller and out-of-scope spaces are "not found".
 */
@Controller('collab')
export class CollaborationController {
  constructor(private readonly collab: CollaborationService) {}

  @Get('config')
  @AuthenticatedOnly()
  config() {
    return this.collab.settings();
  }

  @Get('people')
  @AuthenticatedOnly()
  people(@CurrentPrincipal() p: Principal, @Query(new ZodValidationPipe(peopleQuerySchema)) q: PeopleQuery) {
    return this.collab.people(p, q.q);
  }

  @Get('channels')
  @AuthenticatedOnly()
  list(@CurrentPrincipal() p: Principal) {
    return this.collab.list(p);
  }

  @Post('channels')
  @AuthenticatedOnly()
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(channelCreateSchema)) body: ChannelCreate,
    @Meta() meta: RequestMeta,
  ) {
    return this.collab.create(p, body, meta);
  }

  @Post('direct')
  @AuthenticatedOnly()
  @HttpCode(200)
  direct(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(directChannelSchema)) body: DirectChannelInput,
  ) {
    return this.collab.direct(p, body.employeeId);
  }

  @Get('channels/:id')
  @AuthenticatedOnly()
  get(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.collab.get(p, id);
  }

  @Post('channels/:id/join')
  @AuthenticatedOnly()
  @HttpCode(200)
  join(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    return this.collab.join(p, id);
  }

  @Post('channels/:id/archive')
  @AuthenticatedOnly()
  @HttpCode(204)
  async archive(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    await this.collab.archive(p, id, meta);
  }

  @Post('channels/:id/members')
  @AuthenticatedOnly()
  @HttpCode(200)
  addMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(channelMemberAddSchema)) body: ChannelMemberAdd,
    @Meta() meta: RequestMeta,
  ) {
    return this.collab.addMember(p, id, body.employeeId, meta);
  }

  @Delete('channels/:id/members/:employeeId')
  @AuthenticatedOnly()
  @HttpCode(204)
  async removeMember(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Param('employeeId', new UuidParamPipe()) employeeId: string,
    @Meta() meta: RequestMeta,
  ) {
    await this.collab.removeMember(p, id, employeeId, meta);
  }

  @Get('channels/:id/messages')
  @AuthenticatedOnly()
  messages(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Query(new ZodValidationPipe(messageListQuerySchema)) q: MessageListQuery,
  ) {
    return this.collab.messages(p, id, q);
  }

  @Post('channels/:id/messages')
  @AuthenticatedOnly()
  post(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(messageCreateSchema)) body: MessageCreate,
  ) {
    return this.collab.post(p, id, body);
  }

  @Post('channels/:id/read')
  @AuthenticatedOnly()
  @HttpCode(204)
  async read(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    await this.collab.markRead(p, id);
  }

  @Post('channels/:id/call')
  @AuthenticatedOnly()
  @HttpCode(200)
  call(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(callTokenSchema)) body: CallTokenInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.collab.callToken(p, id, body, meta);
  }

  @Patch('messages/:id')
  @AuthenticatedOnly()
  edit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(messageCreateSchema)) body: MessageCreate,
  ) {
    return this.collab.edit(p, id, body);
  }

  @Delete('messages/:id')
  @AuthenticatedOnly()
  @HttpCode(204)
  async remove(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    await this.collab.remove(p, id);
  }
}
