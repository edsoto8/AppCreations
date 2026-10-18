/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * Content-Security-Policy for the production build (docs/architecture.md).
 * 'unsafe-inline' styles: Recharts and Radix primitives set inline style attributes.
 * Not applied to the dev server: Vite HMR needs a websocket that connect-src 'none' would block.
 */
export const CSP = "default-src 'self'; connect-src 'none'; worker-src 'self'; style-src 'self' 'unsafe-inline'";

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
