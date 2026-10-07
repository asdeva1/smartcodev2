/**
 * pnpm --filter @smartcode/api keys:generate — creates an ES256 key pair for LOCAL development and appends it
 * to apps/api/.env (git-ignored, mode 600). Keys are never printed. Staging/production keys live only in
 * AWS Secrets Manager.
 */
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

async function main(): Promise<void> {
  if (process.env.APP_ENV && !['development', 'test'].includes(process.env.APP_ENV)) {
    console.error('keys:generate is for local development only.');
    process.exit(1);
  }
  const envFile = join(__dirname, '..', '.env');
  const current = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  if (/^JWT_PRIVATE_KEY=/m.test(current)) {
    console.log('JWT keys already present in apps/api/.env — nothing to do.');
    return;
  }
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const oneLine = (pem: string) => JSON.stringify(pem.trim()).replace(/^"|"$/g, '');
  const block = `\n# Local development ES256 key pair (generated ${new Date().toISOString()})\nJWT_KEY_ID=dev-local\nJWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"\nJWT_PUBLIC_KEY="${oneLine(await exportSPKI(publicKey))}"\n`;
  if (existsSync(envFile)) appendFileSync(envFile, block);
  else writeFileSync(envFile, block.trimStart());
  chmodSync(envFile, 0o600);
  console.log('Development JWT keys written to apps/api/.env (git-ignored).');
}

void main();
