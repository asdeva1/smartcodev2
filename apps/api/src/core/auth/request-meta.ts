import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  requestId: string | null;
}

/** Client IP (the one trusted proxy hop is configured in app.factory), user agent and request id. */
export const Meta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: unknown }>();
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? 'unknown',
    userAgent: typeof ua === 'string' ? ua : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
});
