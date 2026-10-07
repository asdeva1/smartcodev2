/**
 * pnpm db:verify — structural verification of the database against what the application expects.
 * Phase 1 verifies the foundation (organizations table + migrations); Phase 2 extends REQUIRED_TABLES,
 * required enums, partial unique indexes, triggers, orphan/duplicate checks and the business-data CLEAN check.
 * Exit code 0 = all PASS.
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

const REQUIRED_TABLES = ['organizations'];
const REQUIRED_UNIQUE_INDEXES = ['organizations_slug_key'];

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const results: CheckResult[] = [];
  try {
    await withClient(url, async (client) => {
      results.push({ name: 'Connection', status: 'PASS', detail: describeDatabase(url) });

      const state = await migrationState(client, localMigrations());
      results.push({
        name: 'Migrations',
        status: state.failed.length || state.pending.length ? 'FAIL' : 'PASS',
        detail: `${state.applied.length} applied, ${state.pending.length} pending, ${state.failed.length} failed`,
      });

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
      );
      const present = new Set(tables.rows.map((r) => r.table_name));
      const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
      results.push({
        name: 'Required tables',
        status: missingTables.length ? 'FAIL' : 'PASS',
        detail: missingTables.length
          ? `missing: ${missingTables.join(', ')}`
          : `${REQUIRED_TABLES.length}/${REQUIRED_TABLES.length}`,
      });

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
      );
      const indexNames = new Set(indexes.rows.map((r) => r.indexname));
      const missingIdx = REQUIRED_UNIQUE_INDEXES.filter((i) => !indexNames.has(i));
      results.push({
        name: 'Unique indexes',
        status: missingIdx.length ? 'FAIL' : 'PASS',
        detail: missingIdx.length
          ? `missing: ${missingIdx.join(', ')}`
          : `${REQUIRED_UNIQUE_INDEXES.length}/${REQUIRED_UNIQUE_INDEXES.length}`,
      });

      if (present.has('organizations')) {
        const orgs = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM organizations',
        );
        const count = Number(orgs.rows[0]?.count ?? 0);
        results.push({
          name: 'System seed',
          status: count === 1 ? 'PASS' : count === 0 ? 'WARN' : 'FAIL',
          detail:
            count === 1
              ? '1 organization'
              : count === 0
                ? 'not seeded yet — run pnpm db:seed'
                : `${count} organizations (expected 1)`,
        });
      }

      results.push({
        name: 'Business data',
        status: 'CLEAN',
        detail: 'no business tables exist before Phase 2',
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
    printReport(`DATABASE VERIFY  (env=${process.env.APP_ENV ?? 'development'})`, results) ? 0 : 1,
  );
}

void main();
