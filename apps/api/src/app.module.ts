import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './core/auth/auth.module';
import { AppConfig } from './core/config/app-config.service';
import { ConfigModule } from './core/config/config.module';
import { CoreDataModule } from './core/data/core-data.module';
import { ProblemDetailsFilter } from './core/errors/problem-details.filter';
import { MailModule } from './core/mail/mail.module';
import { LoggingModule } from './core/logging/logging.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { HealthController } from './modules/health/health.controller';
import { AuthApiModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { MetaController } from './modules/meta/meta.controller';

/**
 * Root module. Business modules are registered here phase by phase (docs/14-implementation-roadmap.md).
 * Guard order: Throttler → Auth (who are you) → Permission (may you).
 */
@Module({})
export class AppModule {
  static forRoot(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggingModule,
        ThrottlerModule.forRootAsync({
          inject: [AppConfig],
          // In-memory store for Phase 1; Redis storage (shared across ECS tasks) arrives with Redis in Phase 3.
          useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.get('RATE_LIMIT_PER_MINUTE') }],
        }),
        PrismaModule,
        CoreDataModule,
        MailModule,
        AuthModule,
        AuthApiModule,
        EmployeesModule,
      ],
      controllers: [HealthController, MetaController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
