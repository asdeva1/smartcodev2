import { Injectable } from '@nestjs/common';
import { type Env, durationToMs } from './env.schema';

/** Typed, read-only access to validated configuration. Inject this instead of reading process.env. */
@Injectable()
export class AppConfig {
  constructor(private readonly env: Env) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get appEnv(): Env['APP_ENV'] {
    return this.env.APP_ENV;
  }

  get isDeployed(): boolean {
    return this.env.APP_ENV === 'staging' || this.env.APP_ENV === 'production';
  }

  get corsOrigins(): string[] {
    const list = this.env.CORS_ALLOWED_ORIGINS ?? this.env.WEB_URL;
    return list
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  }

  /** Cookies are Secure everywhere except plain-HTTP local development/tests. */
  get secureCookies(): boolean {
    return this.env.APP_ENV !== 'development' && this.env.APP_ENV !== 'test';
  }

  /** Absolute link into the web app, built only from configuration (D-06). */
  webUrl(path: string, query: Record<string, string> = {}): string {
    const url = new URL(path, `${this.env.WEB_URL.replace(/\/+$/, '')}/`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  get brandAssetBaseUrl(): string {
    return this.env.BRAND_ASSET_BASE_URL ?? `${this.env.APP_URL.replace(/\/+$/, '')}/brand`;
  }

  ms(
    key:
      | 'ACCESS_TOKEN_TTL'
      | 'REFRESH_TOKEN_IDLE_TTL'
      | 'REFRESH_TOKEN_ABSOLUTE_TTL'
      | 'ACTIVATION_TOKEN_TTL'
      | 'RESET_TOKEN_TTL'
      | 'LOGIN_LOCK_DURATION',
  ): number {
    return durationToMs(this.env[key]);
  }
}
