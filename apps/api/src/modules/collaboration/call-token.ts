import { createHmac } from 'node:crypto';

const b64 = (value: object | Buffer) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

/**
 * A LiveKit access token (an HS256 JWT signed with the API secret). Built here so the server needs no extra
 * package. The browser connects to the call service with it; it only opens one room.
 */
export function mintCallToken(input: {
  keyId: string;
  signingKey: string;
  room: string;
  identity: string;
  name: string;
  ttlSeconds: number;
  now?: Date;
}): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const exp = issuedAt + input.ttlSeconds;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: input.keyId,
    sub: input.identity,
    name: input.name,
    nbf: issuedAt - 5,
    iat: issuedAt,
    exp,
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signature = createHmac('sha256', input.signingKey).update(unsigned).digest();
  return { token: `${unsigned}.${b64(signature)}`, expiresAt: new Date(exp * 1000) };
}
