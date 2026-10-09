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
import { AllocationModule } from './modules/allocation/allocation.module';
import { AuthApiModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { MetaController } from './modules/meta/meta.controller';
import { OrganizationModule } from './modules/organization/organization.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { LogsModule } from './modules/logs/logs.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ProductionModule } from './modules/production/production.module';
import { AuditsModule } from './modules/audits/audits.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TeamsModule } from './modules/teams/teams.module';
import { VendorsModule } from './modules/vendors/vendors.module';

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
        OrganizationModule,
        VendorsModule,
        TeamsModule,
        AllocationModule,
        ProjectsModule,
        ProductionModule,
        NotificationsModule,
        DashboardsModule,
        LogsModule,
        ApprovalsModule,
        AuditsModule,
      ],
      controllers: [HealthController, MetaController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
