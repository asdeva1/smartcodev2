import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

export function localMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
    .sort();
}
