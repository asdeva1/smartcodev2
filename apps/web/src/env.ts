import { z } from 'zod';

/**
 * Public configuration (docs/12-environment-configuration.md). Only NEXT_PUBLIC_* values exist here — the
 * web app holds no secrets. Each variable is referenced explicitly so Next.js can inline it at build time.
 * Domains are configuration (D-06); localhost is the development default.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
});

export type PublicEnv = z.infer<typeof schema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const blankToUndefined = Object.fromEntries(
    Object.entries(source).map(([k, v]) => [k, v?.trim() ? v.trim() : undefined]),
  );
  const env = schema.parse(blankToUndefined);
  if (env.NEXT_PUBLIC_APP_ENV === 'production' || env.NEXT_PUBLIC_APP_ENV === 'staging') {
    for (const key of ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_APP_URL'] as const) {
      if (/localhost|127\.0\.0\.1/.test(env[key])) {
        throw new Error(`${key} must not point to localhost in ${env.NEXT_PUBLIC_APP_ENV}`);
      }
    }
  }
  return env;
}

export const env = parsePublicEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

export const API_BASE = `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1`;
