#!/usr/bin/env node
// Copies the brand assets (web crops, favicons and the untouched original) into a target directory,
// e.g. `apps/web/public/brand`. Run by the web app before dev/build so there is one asset source.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) {
  console.error('usage: smartcode-brand-sync <target-directory>');
  process.exit(1);
}

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const dest = resolve(process.cwd(), target);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['web', 'favicon', 'source']) {
  cpSync(join(assets, dir), join(dest, dir), { recursive: true });
}
console.log(`brand assets synced → ${dest}`);
