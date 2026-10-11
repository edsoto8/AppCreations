import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One config for the app (Vite) and the unit tests (Vitest).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    // PixiJS alone is ~600 kB minified; keep the warning meaningful for our own code.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Simulation, iso math, store and save code are DOM-free, so the node environment is enough.
    environment: 'node',
  },
});
