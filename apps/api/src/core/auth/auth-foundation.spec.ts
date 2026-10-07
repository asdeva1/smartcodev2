import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { AppConfig } from '../config/app-config.service';
import { parseEnv } from '../config/env.schema';
import { extractAccessToken } from './auth.guard';
import { hashToken, isTokenUsable, issueToken, tokenMatches } from './opaque-token';
import { PasswordService } from './password.service';
import { PERMISSIONS_VERSION, type Principal } from './principal';
import { InvalidAccessTokenError, TokenService } from './token.service';

const principal: Principal = {
  employeeId: '0192f000-0000-7000-8000-000000000001',
  organizationId: '0192f000-0000-7000-8000-0000000000aa',
  role: 'MANAGER',
  vendorId: null,
  sessionId: 'session-1',
  permissionsVersion: PERMISSIONS_VERSION,
};

async function tokenService(env: Record<string, string> = {}): Promise<TokenService> {
  const service = new TokenService(new AppConfig(parseEnv(env)));
  await service.onModuleInit();
  return service;
}

describe('PasswordService (argon2id)', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies', async () => {
    const hash = await passwords.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'wrong password!!')).resolves.toBe(false);
    expect(passwords.needsRehash(hash)).toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    await expect(passwords.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});

describe('opaque tokens (activation / reset / refresh)', () => {
  it('issues 256-bit tokens and stores only the hash', () => {
    const { token, hash } = issueToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(issueToken().token).not.toBe(token);
  });

  it('matches in constant time and rejects other tokens', () => {
    const { token, hash } = issueToken();
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches(issueToken().token, hash)).toBe(false);
    expect(tokenMatches(token, 'abcd')).toBe(false);
  });

  it('is usable only when unused, unrevoked and unexpired (single use)', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    const future = new Date('2026-10-07T11:00:00Z');
    expect(isTokenUsable({ usedAt: null, revokedAt: null, expiresAt: future }, now)).toBe(true);
    expect(isTokenUsable({ usedAt: now, revokedAt: null, expiresAt: future }, now)).toBe(false);
    expect(isTokenUsable({ usedAt: null, revokedAt: now, expiresAt: future }, now)).toBe(false);
    expect(isTokenUsable({ usedAt: null, revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});

describe('TokenService (ES256 access tokens)', () => {
  it('signs and verifies a principal round-trip', async () => {
    const tokens = await tokenService();
    const jwt = await tokens.signAccessToken(principal);
    const [header] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({ alg: 'ES256' });
    await expect(tokens.verifyAccessToken(jwt)).resolves.toEqual(principal);
  });

  it('rejects tokens signed by another key, tampered or expired', async () => {
    const a = await tokenService();
    const b = await tokenService();
    const jwt = await a.signAccessToken(principal);
    await expect(b.verifyAccessToken(jwt)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(a.verifyAccessToken(`${jwt}x`)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    const shortLived = await tokenService({ ACCESS_TOKEN_TTL: '0s' });
    const expired = await shortLived.signAccessToken(principal);
    await new Promise((r) => setTimeout(r, 1100));
    await expect(shortLived.verifyAccessToken(expired)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('loads configured PEM keys', async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    const tokens = await tokenService({
      JWT_PRIVATE_KEY: await exportPKCS8(pair.privateKey),
      JWT_PUBLIC_KEY: await exportSPKI(pair.publicKey),
      JWT_KEY_ID: 'test-key',
    });
    const jwt = await tokens.signAccessToken({ ...principal, role: 'CODER', vendorId: 'vendor-a' });
    await expect(tokens.verifyAccessToken(jwt)).resolves.toMatchObject({
      role: 'CODER',
      vendorId: 'vendor-a',
    });
    expect(await tokens.exportPublicKey()).toContain('BEGIN PUBLIC KEY');
  });
});

describe('access token extraction', () => {
  it('prefers a bearer header, then the httpOnly cookie', () => {
    expect(
      extractAccessToken({ headers: { authorization: 'Bearer abc' }, cookies: { sc_at: 'cookie' } }),
    ).toBe('abc');
    expect(extractAccessToken({ headers: {}, cookies: { sc_at: 'cookie' } })).toBe('cookie');
    expect(extractAccessToken({ headers: { authorization: 'Basic xyz' } })).toBeNull();
    expect(extractAccessToken({ headers: {} })).toBeNull();
  });
});
