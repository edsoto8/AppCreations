import { defineConfig } from '@playwright/test';

/** Smoke tests against the production build. Headless WebGL via SwiftShader (software). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 760 },
    trace: 'off',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
