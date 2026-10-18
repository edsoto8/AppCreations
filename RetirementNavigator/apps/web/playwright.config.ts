import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * E2E runs against `vite preview` (the production build, with the CSP meta tag).
 * In the cloud container a Chromium build is preinstalled; locally run `pnpm exec playwright install chromium`.
 */
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
