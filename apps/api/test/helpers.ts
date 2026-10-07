import { type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@smartcode/shared';
import { configureApp } from '../src/app.factory';
import { SessionVerifier } from '../src/core/auth/session.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { withActor } from '../src/core/prisma/actor-transaction';
import type { TestDb } from './db/harness';
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

/**
 * Foundation tests exercise the guards without a database: any validly SIGNED access token is accepted as a live
 * session. (Phase 3's own suites use `createDbApp`, where sessions and employees are real.)
 */
const acceptSignedTokens: SessionVerifier = { verify: (claims) => Promise.resolve(claims) };

export async function createTestApp(
  options: { controllers?: Type[]; env?: Record<string, string> } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(options.env))],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(SessionVerifier)
    .useValue(acceptSignedTokens)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
  await app.init();
  return app;
}

/** Real application, real guards and sessions, wired to a throw-away PostgreSQL schema built from the migrations. */
export async function createDbApp(
  db: TestDb,
  options: { env?: Record<string, string> } = {},
): Promise<INestApplication> {
  const prismaStub = {
    isConfigured: true,
    get client() {
      return db.prisma;
    },
    transaction: (
      context: Parameters<typeof withActor>[1],
      fn: Parameters<typeof withActor>[2],
      opts?: { timeoutMs?: number },
    ) => withActor(db.prisma, context, fn, opts),
    check: () => Promise.resolve({ status: 'up', latencyMs: 1 }),
    onModuleDestroy: () => Promise.resolve(),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv({ MAIL_TRANSPORT: 'memory', ...options.env }))],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaStub)
    .compile();
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
