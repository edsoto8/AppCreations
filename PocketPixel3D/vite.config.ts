import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, strictPort: false },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
