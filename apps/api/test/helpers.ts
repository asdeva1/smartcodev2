import { type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@smartcode/shared';
import { configureApp } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { PERMISSIONS_VERSION } from '../src/core/auth/principal';
import { TokenService } from '../src/core/auth/token.service';

/** Synthetic identifiers only (D-05). */
export const TEST_ORG_ID = '0192f000-0000-7000-8000-0000000000aa';

export const testEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'test',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_URL: 'http://localhost:3000',
  ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
  ...overrides,
});

export async function createTestApp(
  options: { controllers?: Type[]; env?: Record<string, string> } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(options.env))],
    controllers: options.controllers ?? [],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
  await app.init();
  return app;
}

export async function tokenFor(
  app: INestApplication,
  role: Role,
  vendorId: string | null = null,
): Promise<string> {
  return app.get(TokenService).signAccessToken({
    employeeId: `0192f000-0000-7000-8000-${role.length.toString().padStart(12, '0')}`,
    organizationId: TEST_ORG_ID,
    role,
    vendorId,
    sessionId: `test-session-${role}`,
    permissionsVersion: PERMISSIONS_VERSION,
  });
}
