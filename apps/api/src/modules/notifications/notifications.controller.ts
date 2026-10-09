import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermission } from '../../core/auth/decorators';
import type { Principal } from '../../core/auth/principal';
import { UuidParamPipe } from '../employees/uuid-param.pipe';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notification.read')
  mine(@CurrentPrincipal() p: Principal) {
    return this.notifications.mine(p);
  }

  @Post('read-all')
  @RequirePermission('notification.read')
  @HttpCode(200)
  readAll(@CurrentPrincipal() p: Principal) {
    return this.notifications.markAllRead(p);
  }

  @Post(':id/read')
  @RequirePermission('notification.read')
  @HttpCode(204)
  async read(@CurrentPrincipal() p: Principal, @Param('id', new UuidParamPipe()) id: string) {
    await this.notifications.markRead(p, id);
  }
}
