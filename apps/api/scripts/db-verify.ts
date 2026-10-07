/**
 * pnpm db:verify — structural verification of the database against what the application expects
 * (tables, enums, unique/partial indexes, CHECKs, triggers, foreign keys, duplicates, seed, business-data state).
 * Read-only. Exit code 0 = no FAIL.
 */
import { type CheckResult, describeDatabase, printReport, requireDatabaseUrl, withClient } from './lib';
import { verifyDatabase } from './verify-lib';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const results: CheckResult[] = [];
  try {
    await withClient(url, async (client) => {
      const started = performance.now();
      await client.query('SELECT 1');
      results.push({
        name: 'Connection',
        status: 'PASS',
        detail: `${describeDatabase(url)}, ${Math.round(performance.now() - started)} ms`,
      });
      results.push(...(await verifyDatabase(client)));
    });
  } catch (e) {
    results.push({
      name: 'Connection',
      status: 'FAIL',
      detail: (e as Error).message.replace(/\/\/[^@]*@/, '//***@'),
    });
  }
  process.exit(
    printReport(`DATABASE VERIFY  (env=${process.env.APP_ENV ?? 'development'})`, results) ? 0 : 1,
  );
}

void main();
