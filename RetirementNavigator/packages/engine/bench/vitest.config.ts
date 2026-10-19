import { defineConfig } from 'vitest/config';

/** Benchmarks (`pnpm bench`): not part of `pnpm test`; results print and are written to bench/results/. */
export default defineConfig({
  test: { include: ['bench/**/*.bench.test.ts'], environment: 'node', testTimeout: 300_000 },
});
