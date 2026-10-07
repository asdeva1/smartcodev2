// Root ESLint flat config shared by every workspace package.
// Packages run `eslint .` from their own directory; this file is found by walking up.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/cdk.out/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      '**/public/brand/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      // Raw SQL must use tagged templates ($queryRaw`...`), never the Unsafe variants.
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message: 'Use $queryRaw tagged templates (SQL injection protection).',
        },
        {
          property: '$executeRawUnsafe',
          message: 'Use $executeRaw tagged templates (SQL injection protection).',
        },
      ],
    },
  },
  {
    files: ['**/scripts/**', '**/*.config.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
  {
    // NestJS dependency injection relies on emitted decorator metadata: constructor-injected classes must stay
    // runtime imports. Telling the parser lets consistent-type-imports keep those as value imports.
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
);
