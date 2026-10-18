import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // api.ts holds the frozen signatures; until a function is implemented it is a NotImplemented stub.
      // Implemented functions live in their modules (covered) and api.ts re-exports them.
      exclude: ['src/**/*.test.ts', 'src/api.ts', 'src/index.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
