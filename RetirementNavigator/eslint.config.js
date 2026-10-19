import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/** Imports the pure engine must never use (enforces "no React/DOM/storage in the engine"). */
const engineBannedImports = {
  patterns: [
    { group: ['react', 'react-*', 'react/*', '@radix-ui/*', 'radix-ui'], message: 'The engine must not import React.' },
    { group: ['idb', 'idb/*'], message: 'The engine must not touch storage.' },
    { group: ['@rn/web', '**/apps/web/**'], message: 'The engine must not depend on the web app.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.es2023 } },
    rules: {
      'no-restricted-imports': ['error', engineBannedImports],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'fetch',
          'self',
          'crypto',
          'performance',
          'globalThis',
          'process',
        ].map((name) => ({ name, message: 'The engine is pure: no browser globals.' })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Inject a seeded PRNG instead.' },
        { object: 'Date', property: 'now', message: 'Inject the current year instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name='toFixed']", message: 'Never use toFixed for logic.' },
        { selector: "NewExpression[callee.name='Date']", message: 'Inject dates; do not read the clock.' },
      ],
    },
  },
  {
    files: ['packages/engine/src/**/*.test.ts', 'packages/engine/vitest.config.ts', 'packages/engine/bench/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is not allowed.',
        },
      ],
    },
  },
  {
    // The synthetic fixture rules are for tests only; the app must never use them.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/**/*.test.{ts,tsx}', 'apps/web/src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@rn/engine/testing', message: 'Synthetic fixture rules are for tests only.' }] },
      ],
    },
  },
  {
    // Tests index into arrays under noUncheckedIndexedAccess; a failed `!` fails the test, which is the point.
    files: ['**/*.test.{ts,tsx}', 'apps/web/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['apps/web/e2e/**/*.ts', 'apps/web/*.config.ts', 'apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
