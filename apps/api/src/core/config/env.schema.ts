import { z } from 'zod';

/**
 * Runtime configuration (docs/12-environment-configuration.md). Validated once at start-up;
 * the process refuses to start with a readable list of problems if anything is wrong.
 * Domains are configuration (D-06) — nothing in business logic hard-codes a host.
 */
const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/, 'Use a duration like 15m, 12h or 7d');
const url = z.url();
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['api', 'worker', 'task']).default('api'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: optionalString,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    WEB_URL: url.default('http://localhost:3000'),
    API_URL: url.default('http://localhost:4000'),
    APP_URL: url.default('http://localhost:3000'),
    CORS_ALLOWED_ORIGINS: optionalString,
    COOKIE_DOMAIN: optionalString,
    BRAND_ASSET_BASE_URL: optionalString,

    JWT_PRIVATE_KEY: optionalString,
    JWT_PUBLIC_KEY: optionalString,
    JWT_KEY_ID: z.string().default('dev'),
    ACCESS_TOKEN_TTL: duration.default('15m'),
    REFRESH_TOKEN_IDLE_TTL: duration.default('12h'),
    REFRESH_TOKEN_ABSOLUTE_TTL: duration.default('7d'),
    ACTIVATION_TOKEN_TTL: duration.default('72h'),
    RESET_TOKEN_TTL: duration.default('30m'),

    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCK_DURATION: duration.default('15m'),

    /**
     * Outbound email. `ses` in AWS; `smtp` for a local catcher (Mailpit); `file` writes messages to disk and
     * `memory` keeps them in-process — both are for development/tests only and refused when deployed.
     */
    MAIL_TRANSPORT: z.enum(['ses', 'smtp', 'file', 'memory']).default('file'),
    MAIL_FROM: optionalString,
    /** Audio/video calls and screen sharing (LiveKit). All three set = calls on; none = chat only. */
    LIVEKIT_URL: optionalString,
    LIVEKIT_KEY_ID: optionalString,
    LIVEKIT_SIGNING_KEY: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    MAIL_FILE_DIR: optionalString,
    AWS_REGION: optionalString,

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_LOGIN_PER_15M: z.coerce.number().int().min(1).default(5),
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    if (deployed) {
      for (const key of ['DATABASE_URL', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in ${env.APP_ENV}` });
      }
      for (const key of ['WEB_URL', 'API_URL', 'APP_URL'] as const) {
        if (/localhost|127\.0\.0\.1/.test(env[key])) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} must not point to localhost in ${env.APP_ENV}`,
          });
        }
        if (!env[key].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} must use https in ${env.APP_ENV}` });
        }
      }
    }
    if (deployed) {
      if (env.MAIL_TRANSPORT !== 'ses') {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_TRANSPORT'],
          message: `MAIL_TRANSPORT must be "ses" in ${env.APP_ENV}`,
        });
      }
      if (!env.MAIL_FROM) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_FROM'],
          message: `MAIL_FROM is required in ${env.APP_ENV}`,
        });
      }
      if (!env.AWS_REGION) {
        ctx.addIssue({
          code: 'custom',
          path: ['AWS_REGION'],
          message: `AWS_REGION is required in ${env.APP_ENV}`,
        });
      }
    }
    if (env.DATABASE_URL && env.APP_ENV === 'production' && /localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Production must not use a local database',
      });
    }
    if (Boolean(env.JWT_PRIVATE_KEY) !== Boolean(env.JWT_PUBLIC_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PUBLIC_KEY'],
        message: 'Set both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidConfigError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only variable names and rule messages are reported — never values.
    throw new InvalidConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Converts "15m" / "12h" / "7d" to milliseconds. */
export function durationToMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const n = Number(match[1]);
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h' | 'd'
  ];
  return n * unit;
}
