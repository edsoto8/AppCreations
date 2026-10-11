/**
 * QA-only Playwright config: the project config with the webServer build step changed from
 * `npm run build` (tsc -b + vite build) to `vite build`, so e2e can run while `src/` has
 * in-progress type errors elsewhere. Same port, same browser args. Run with
 * `npx playwright test --config e2e/qa-local.config.ts`.
 */
import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

const PORT = 4173;

export default defineConfig({
  ...base,
  testDir: '.',
  webServer: {
    ...base.webServer!,
    command: `cd .. && npx vite build && npx vite preview --port ${PORT} --strictPort`,
  } as never,
});
