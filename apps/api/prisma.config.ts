import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration. The connection string comes from the environment only — never from the repo.
 * Migrations use DATABASE_MIGRATION_URL (DDL-capable role) when set, otherwise DATABASE_URL.
 * `prisma generate` doesn't connect, so a placeholder is used when no URL is configured.
 */
const url =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx scripts/db-seed.ts',
  },
  datasource: { url },
});
