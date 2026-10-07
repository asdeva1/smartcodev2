import type { Config } from 'jest';

const shared = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  // The generated Prisma client imports its siblings as './x.js'; map those to the TypeScript sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
} satisfies Config;

/**
 * unit         src/**\/*.spec.ts — no external services.
 * integration  test/**\/*.int-spec.ts — real HTTP stack; database checks run when DATABASE_URL is set
 *              (CI provides a PostgreSQL service).
 */
const config: Config = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/generated/**',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: './coverage',
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    { ...shared, displayName: 'integration', testMatch: ['<rootDir>/test/**/*.int-spec.ts'] },
  ],
};

export default config;
