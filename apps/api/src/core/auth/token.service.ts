import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { isRole } from '@smartcode/shared';
import {
  type CryptoKey,
  SignJWT,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
} from 'jose';
import { AppConfig } from '../config/app-config.service';
import type { Principal } from './principal';

const ALG = 'ES256';
const ISSUER = 'smartcode-api';
const AUDIENCE = 'smartcode';

export class InvalidAccessTokenError extends Error {
  constructor(message = 'Invalid or expired access token') {
    super(message);
    this.name = 'InvalidAccessTokenError';
  }
}

/**
 * Short-lived ES256 access tokens (docs/06-authentication.md).
 * Keys come from configuration (Secrets Manager in AWS). In local development without keys an
 * ephemeral key pair is generated at start-up (tokens die with the process) — never in staging/production,
 * where configuration validation refuses to start without keys.
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private keyId!: string;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const privatePem = this.config.get('JWT_PRIVATE_KEY');
    const publicPem = this.config.get('JWT_PUBLIC_KEY');
    if (privatePem && publicPem) {
      this.privateKey = await importPKCS8(privatePem.replace(/\\n/g, '\n'), ALG);
      this.publicKey = await importSPKI(publicPem.replace(/\\n/g, '\n'), ALG);
      this.keyId = this.config.get('JWT_KEY_ID');
      return;
    }
    if (this.config.isDeployed) throw new Error('JWT keys are required outside development');
    const pair = await generateKeyPair(ALG, { extractable: true });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.keyId = 'ephemeral-dev';
    this.logger.warn(
      'JWT keys not configured — using an ephemeral development key pair (run `pnpm --filter @smartcode/api keys:generate`).',
    );
  }

  async signAccessToken(principal: Principal): Promise<string> {
    return new SignJWT({
      org: principal.organizationId,
      role: principal.role,
      vid: principal.vendorId,
      sid: principal.sessionId,
      pv: principal.permissionsVersion,
    })
      .setProtectedHeader({ alg: ALG, kid: this.keyId, typ: 'JWT' })
      .setSubject(principal.employeeId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor((Date.now() + this.config.ms('ACCESS_TOKEN_TTL')) / 1000))
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const { sub, org, role, vid, sid, pv } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof org !== 'string' ||
        !isRole(role) ||
        !(vid === null || typeof vid === 'string') ||
        typeof sid !== 'string' ||
        typeof pv !== 'number'
      ) {
        throw new InvalidAccessTokenError('Malformed access token');
      }
      return {
        employeeId: sub,
        organizationId: org,
        role,
        vendorId: vid,
        sessionId: sid,
        permissionsVersion: pv,
      };
    } catch (e) {
      if (e instanceof InvalidAccessTokenError) throw e;
      throw new InvalidAccessTokenError();
    }
  }

  /** Public key (SPKI PEM) — safe to share with the web tier for optional redirect checks. */
  exportPublicKey(): Promise<string> {
    return exportSPKI(this.publicKey);
  }
}
