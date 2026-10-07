import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { localMigrations, MIGRATIONS_DIR } from '../../scripts/migrations';

/**
 * Database test harness. Every spec file gets its OWN PostgreSQL schema built by replaying the real migration
 * files (the same SQL `prisma migrate deploy` runs), so tests exercise the actual constraints and triggers
 * without touching the development database's data. The schema is dropped afterwards.
 *
 * Synthetic data only (D-05).
 */

export const DATABASE_URL = process.env.DATABASE_URL;
const REQUIRED = process.env.REQUIRE_DATABASE_TESTS === '1';

/** `describe` that runs against PostgreSQL. Without DATABASE_URL it skips loudly — unless CI requires it, then it fails. */
export function describeDb(name: string, body: () => void): void {
  if (DATABASE_URL) {
    describe(name, body);
    return;
  }
  if (REQUIRED) {
    describe(name, () => {
      it('requires DATABASE_URL (REQUIRE_DATABASE_TESTS=1)', () => {
        throw new Error('DATABASE_URL is not set but database tests are required');
      });
    });
    return;
  }
  console.warn(`[database tests] "${name}" skipped — set DATABASE_URL to run against PostgreSQL`);
  describe.skip(name, body);
}

export interface TestDb {
  schema: string;
  prisma: PrismaClient;
  /** Raw SQL on the test schema (single connection, so `set_config(..., true)` behaves per statement). */
  sql: <T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  /** Runs several statements in one transaction on a dedicated connection. */
  tx: <T>(fn: (q: (text: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const url = DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const schema = `t_${randomBytes(6).toString('hex')}`;

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    await admin.query(`SET search_path TO "${schema}"`);
    for (const name of localMigrations()) {
      await admin.query(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
    }
  } catch (e) {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw e;
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  // The adapter gets its own pool whose sessions run with the test schema on the search_path, because the
  // database functions/triggers refer to tables unqualified (exactly as they do in production's `public`).
  const prismaPool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool, { schema }) });

  return {
    schema,
    prisma,
    sql: async (text, params) => (await pool.query(text, params as unknown[])).rows as never,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((text, params) => client.query(text, params as unknown[]));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await prisma.$disconnect();
      await prismaPool.end().catch(() => undefined);
      await pool.end();
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    },
  };
}

/** Rejects unless the promise fails with a PostgreSQL error matching SQLSTATE (and optionally message / constraint). */
export async function expectPgError(
  promise: Promise<unknown>,
  expected: { code: string; message?: RegExp; constraint?: string },
): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; message?: string; constraint?: string };
    expect({ code: err.code, message: err.message }).toMatchObject({ code: expected.code });
    if (expected.message) expect(err.message).toMatch(expected.message);
    if (expected.constraint) expect(err.constraint).toBe(expected.constraint);
    return;
  }
  throw new Error(`Expected SQLSTATE ${expected.code} but the statement succeeded`);
}

export const PG = {
  unique: '23505',
  foreignKey: '23503',
  check: '23514',
  /** Role not allowed (API → 403). */
  forbidden: 'SC403',
  /** Wrong state / immutable history (API → 409). */
  conflict: 'SC409',
  /** Reference or eligibility rule violated (API → 422). */
  invalid: 'SC422',
} as const;
