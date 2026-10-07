#!/usr/bin/env node
// pnpm env:check [file] — compares a local env file (default apps/api/.env) with .env.example.
// Reports missing / unknown variable NAMES only; values are never printed.
import { existsSync, readFileSync } from 'node:fs';

const target = process.argv[2] ?? 'apps/api/.env';
const names = (file) =>
  new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(l)?.[1])
      .filter(Boolean),
  );

const expected = names('.env.example');
if (!existsSync(target)) {
  console.error(`${target} not found. Copy .env.example to ${target} and fill in local values.`);
  process.exit(1);
}
const actual = names(target);
const unknown = [...actual].filter((n) => !expected.has(n));
const required = ['APP_ENV', 'DATABASE_URL'];
const missing = required.filter((n) => !actual.has(n));

console.log(`${target}: ${actual.size} variables set, ${expected.size} documented in .env.example`);
if (unknown.length) console.warn(`Not documented in .env.example: ${unknown.join(', ')}`);
if (missing.length) {
  console.error(`Missing required: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Environment file OK.');
