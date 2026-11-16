/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          charts: ['recharts'],
        },
      },
    },
  },
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    pool: 'threads',
  },
});
