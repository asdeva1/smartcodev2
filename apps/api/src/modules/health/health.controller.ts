import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppConfig } from '../../core/config/app-config.service';
import { Public } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Liveness / readiness for the ALB, ECS and smoke tests (docs/11 §5).
 * Mounted outside the /api/v1 prefix. Responses never contain connection details.
 */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok', service: 'smartcode-api', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = await this.prisma.check();
    const ready = database.status === 'up';
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ready' : 'not_ready',
      environment: this.config.appEnv,
      checks: {
        database:
          database.status === 'up'
            ? { status: 'up', latencyMs: database.latencyMs }
            : { status: database.status },
      },
    };
  }
}
