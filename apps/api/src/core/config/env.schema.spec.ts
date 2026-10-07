import { AppConfig } from './app-config.service';
import { InvalidConfigError, durationToMs, parseEnv } from './env.schema';

describe('environment configuration', () => {
  it('applies safe development defaults', () => {
    const env = parseEnv({});
    expect(env.APP_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.WEB_URL).toBe('http://localhost:3000');
    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
  });

  it('requires secrets and real https domains in production', () => {
    let error: unknown;
    try {
      parseEnv({ APP_ENV: 'production' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidConfigError);
    const problems = (error as InvalidConfigError).problems.join('\n');
    expect(problems).toContain('DATABASE_URL is required in production');
    expect(problems).toContain('JWT_PRIVATE_KEY is required');
    expect(problems).toContain('WEB_URL must not point to localhost');
    expect(problems).toContain('API_URL must use https');
  });

  it('never accepts a local database in production', () => {
    expect(() =>
      parseEnv({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        JWT_PRIVATE_KEY: 'k',
        JWT_PUBLIC_KEY: 'k',
        WEB_URL: 'https://app.example.test',
        API_URL: 'https://api.example.test',
        APP_URL: 'https://app.example.test',
      }),
    ).toThrow(/Production must not use a local database/);
  });

  it('does not echo secret values in error messages', () => {
    try {
      parseEnv({ APP_ENV: 'staging', JWT_PRIVATE_KEY: 'super-secret-value' });
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-value');
    }
    expect.assertions(1);
  });

  it('requires both halves of the JWT key pair', () => {
    expect(() => parseEnv({ JWT_PRIVATE_KEY: 'only-private' })).toThrow(/Set both/);
  });

  it('parses durations', () => {
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('7d')).toBe(604_800_000);
    expect(durationToMs('250ms')).toBe(250);
    expect(() => durationToMs('soon')).toThrow();
  });

  it('derives CORS origins and brand URL from configured domains', () => {
    const config = new AppConfig(
      parseEnv({ WEB_URL: 'http://localhost:3000/', APP_URL: 'http://localhost:3000' }),
    );
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.brandAssetBaseUrl).toBe('http://localhost:3000/brand');
    expect(config.ms('RESET_TOKEN_TTL')).toBe(1_800_000);
    expect(config.isDeployed).toBe(false);
    const listed = new AppConfig(parseEnv({ CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test/' }));
    expect(listed.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});
