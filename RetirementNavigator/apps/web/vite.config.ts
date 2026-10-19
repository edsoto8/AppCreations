/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { CSP } from './csp';

/**
 * The CSP meta tag is injected into the production build only: Vite HMR needs a websocket that
 * connect-src 'none' would block.
 */

function cspPlugin(): Plugin {
  return {
    name: 'rn-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
      if (!html.includes('<meta charset="UTF-8" />'))
        throw new Error('index.html must declare <meta charset="UTF-8" />');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${meta}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // Never inline assets as data: URIs (the CSP allows only same-origin fonts and images).
    assetsInlineLimit: 0,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Zod and the app's jitless switch share one chunk, so the switch runs as soon as Zod loads,
        // before any schema is used by the (code-split) pages or the engine. Otherwise Zod's JIT probe
        // (`Function('')`) runs first and the CSP reports it.
        manualChunks: (id: string) =>
          /[\\/]node_modules[\\/](\.pnpm[\\/])?zod/.test(id) || id.endsWith('/src/zodConfig.ts') ? 'zod' : undefined,
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
    },
  },
});
