/**
 * pnpm db:reset — LOCAL DEVELOPMENT ONLY. Drops and recreates the schema, re-applies migrations and the
 * system seed. Refuses to run unless APP_ENV=development (or test) AND the database host is local.
 */
import { execFileSync } from 'node:child_process';
import { describeDatabase, isLocalDatabase, requireDatabaseUrl } from './lib';

const url = requireDatabaseUrl();
const env = process.env.APP_ENV ?? 'development';

if (!['development', 'test'].includes(env) || !isLocalDatabase(url)) {
  console.error(
    `Refusing to reset ${describeDatabase(url)} (APP_ENV=${env}). db:reset only runs against a local development database.`,
  );
  process.exit(1);
}

console.log(`Resetting local database ${describeDatabase(url)} …`);
const run = (args: string[]) => execFileSync('pnpm', args, { stdio: 'inherit', env: process.env });
run(['exec', 'prisma', 'migrate', 'reset', '--force']);
run(['exec', 'tsx', 'scripts/db-seed.ts']);
console.log('Local database reset complete.');
