/**
 * pnpm db:health — connection, latency, server version and migration status.
 * Exit code 0 = healthy, 1 = unhealthy. Safe to run against any environment (read-only).
 */
import {
  type CheckResult,
  describeDatabase,
  migrationState,
  printReport,
  requireDatabaseUrl,
  withClient,
} from './lib';
import { localMigrations } from './migrations';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const results: CheckResult[] = [];
  try {
    await withClient(url, async (client) => {
      const started = performance.now();
      const version = await client.query<{ server_version: string }>('SHOW server_version');
      results.push({
        name: 'Connection',
        status: 'PASS',
        detail: `${describeDatabase(url)}, ${Math.round(performance.now() - started)} ms, PostgreSQL ${version.rows[0]?.server_version}`,
      });
      const ssl = await client.query<{ ssl: boolean | null }>(
        'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      const encrypted = Boolean(ssl.rows[0]?.ssl);
      results.push({
        name: 'Encryption in transit',
        status: encrypted
          ? 'PASS'
          : process.env.APP_ENV === 'staging' || process.env.APP_ENV === 'production'
            ? 'FAIL'
            : 'WARN',
        detail: encrypted ? 'TLS' : 'not encrypted (acceptable for local development only)',
      });
      const local = localMigrations();
      const state = await migrationState(client, local);
      results.push({
        name: 'Migrations',
        status: state.failed.length ? 'FAIL' : state.pending.length ? 'WARN' : 'PASS',
        detail: `${state.applied.length} applied, ${state.pending.length} pending, ${state.failed.length} failed`,
      });
    });
  } catch (e) {
    results.push({
      name: 'Connection',
      status: 'FAIL',
      detail: (e as Error).message.replace(/\/\/[^@]*@/, '//***@'),
    });
  }
  process.exit(
    printReport(`DATABASE HEALTH  (env=${process.env.APP_ENV ?? 'development'})`, results) ? 0 : 1,
  );
}

void main();
