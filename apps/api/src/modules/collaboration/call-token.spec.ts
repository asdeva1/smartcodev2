import { createHmac } from 'node:crypto';
import { mintCallToken } from './call-token';

const SIGNING = 'x'.repeat(32);
const KEY_ID = 'k'.repeat(8);

describe('mintCallToken', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  const { token, expiresAt } = mintCallToken({
    keyId: KEY_ID,
    signingKey: SIGNING,
    room: 'sc-room',
    identity: 'emp-1',
    name: 'Asha Rao',
    ttlSeconds: 3600,
    now,
  });
  const [header, payload, signature] = token.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;

  it('is a signed HS256 token for exactly one room', () => {
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const expected = createHmac('sha256', SIGNING).update(`${header}.${payload}`).digest('base64url');
    expect(signature).toBe(expected);
    expect(claims).toMatchObject({
      iss: KEY_ID,
      sub: 'emp-1',
      name: 'Asha Rao',
      video: { room: 'sc-room', roomJoin: true },
    });
  });

  it('expires after the requested time', () => {
    expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 3600);
    expect(expiresAt.toISOString()).toBe('2026-10-10T11:00:00.000Z');
  });
});
