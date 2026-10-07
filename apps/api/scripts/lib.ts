import 'dotenv/config';
import pg from 'pg';

/** Shared helpers for the automated database scripts — no manual SQL required (docs/02 §8). */

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP' | 'CLEAN';
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set. Copy .env.example to apps/api/.env (development) or configure the environment.',
    );
    process.exit(2);
  }
  return url;
}

/** Host + database name only — never credentials. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

export function isLocalDatabase(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1', 'postgres'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function printReport(title: string, results: CheckResult[]): boolean {
  const width = Math.max(...results.map((r) => r.name.length)) + 4;
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
  for (const r of results) {
    console.log(`${r.name.padEnd(width, '.')} ${r.status}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const ok = results.every((r) => r.status !== 'FAIL');
  console.log(`\nResult: ${ok ? 'OK' : 'FAILED'}\n`);
  return ok;
}

/** Applied/pending/failed migrations, read from Prisma's bookkeeping table and the migrations folder. */
export async function migrationState(
  client: pg.Client,
  localMigrations: string[],
): Promise<{ applied: string[]; failed: string[]; pending: string[]; tableExists: boolean }> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '_prisma_migrations') AS exists`,
  );
  if (!exists.rows[0]?.exists)
    return { applied: [], failed: [], pending: localMigrations, tableExists: false };
  const rows = await client.query<{
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
  const applied = rows.rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const failed = rows.rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const pending = localMigrations.filter((m) => !applied.includes(m));
  return { applied, failed, pending, tableExists: true };
}
