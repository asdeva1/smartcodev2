#!/usr/bin/env node
/**
 * Fills the API runtime secret (DATABASE_URL, DATABASE_MIGRATION_URL, JWT keys) in AWS Secrets Manager.
 * Runs on the operator's machine with their AWS profile. Nothing secret is printed or written into the repo:
 * the values are generated or read in memory and sent to Secrets Manager through a short-lived 0600 temp file.
 *
 *   node scripts/populate-staging-secrets.mjs --profile smartcode-staging --region ap-south-1 \
 *        --app-secret-arn <AppSecretArn output> --db-secret-arn <RDS secret ARN>
 *
 * Refuses to overwrite existing keys unless --rotate is passed.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/--/)
    .filter(Boolean)
    .map((part) => {
      const [key, ...rest] = part.trim().split(/\s+/);
      return [key, rest.join(' ') || 'true'];
    }),
);
for (const required of ['profile', 'region', 'app-secret-arn', 'db-secret-arn']) {
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(1);
  }
}
const aws = (...a) =>
  execFileSync('aws', [...a, '--profile', args.profile, '--region', args.region], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
const getSecret = (arn) =>
  JSON.parse(
    aws(
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      arn,
      '--query',
      'SecretString',
      '--output',
      'text',
    ),
  );

const current = getSecret(args['app-secret-arn']);
if (current.JWT_PRIVATE_KEY && !args.rotate) {
  console.error(
    'The application secret is already populated. Pass --rotate to replace it (this signs everyone out).',
  );
  process.exit(1);
}
const db = getSecret(args['db-secret-arn']);
const user = encodeURIComponent(db.username);
const password = encodeURIComponent(db.password);
const base = `postgresql://${user}:${password}@${db.host}:${db.port}/${db.dbname ?? 'smartcode'}`;
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const value = JSON.stringify({
  // pg (runtime) needs no-verify because the RDS CA is not in Node's trust store; the link is still TLS-encrypted.
  DATABASE_URL: `${base}?sslmode=no-verify`,
  DATABASE_MIGRATION_URL: `${base}?sslmode=require`,
  JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
});
const dir = mkdtempSync(join(tmpdir(), 'sc-secret-'));
const file = join(dir, 'secret.json');
try {
  writeFileSync(file, value, { mode: 0o600 });
  aws(
    'secretsmanager',
    'put-secret-value',
    '--secret-id',
    args['app-secret-arn'],
    '--secret-string',
    `file://${file.replaceAll('\\', '/')}`,
  );
  console.log(
    'Application secret populated: DATABASE_URL, DATABASE_MIGRATION_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY.',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
