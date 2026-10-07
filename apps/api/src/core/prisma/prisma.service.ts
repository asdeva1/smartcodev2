import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config.service';
import { PrismaClient } from '../../generated/prisma/client';
import { type ActorContext, type Tx, withActor } from './actor-transaction';

export type DatabaseStatus =
  { status: 'up'; latencyMs: number } | { status: 'down'; error: string } | { status: 'not_configured' };

/**
 * One Prisma client per process with a bounded pg pool (docs/02 §7): tasks × DATABASE_POOL_MAX must stay
 * within the RDS connection budget. The client is created lazily so the API can start (and report
 * "not ready") when no database is configured in local development.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private instance: PrismaClient | null = null;

  constructor(private readonly config: AppConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('DATABASE_URL'));
  }

  get client(): PrismaClient {
    if (!this.instance) {
      const connectionString = this.config.get('DATABASE_URL');
      if (!connectionString) throw new Error('DATABASE_URL is not configured');
      const adapter = new PrismaPg({ connectionString, max: this.config.get('DATABASE_POOL_MAX') });
      this.instance = new PrismaClient({ adapter });
    }
    return this.instance;
  }

  /** One transaction attributed to the acting employee — see `withActor`. */
  transaction<T>(
    context: ActorContext,
    fn: (tx: Tx) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return withActor(this.client, context, fn, options);
  }

  async check(): Promise<DatabaseStatus> {
    if (!this.isConfigured) return { status: 'not_configured' };
    const started = performance.now();
    try {
      await this.client.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      // Log the reason server-side; callers only see a generic state.
      this.logger.warn(`Database check failed: ${(e as Error).message}`);
      return { status: 'down', error: 'unreachable' };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.instance?.$disconnect();
  }
}
