import { test } from '@playwright/test';
import { appUrl, onboardWithSample } from './helpers';

/** Visual verification (run with `pnpm screenshots`); PNGs are read back during milestone review. */
for (const theme of ['light', 'dark'] as const) {
  for (const path of [
    '/welcome',
    '/',
    '/profile',
    '/income',
    '/accounts',
    '/roth-ira',
    '/hsa',
    '/rules',
    '/profiles',
    '/data',
  ]) {
    test(`@screens ${theme} ${path}`, async ({ page }, testInfo) => {
      await page.addInitScript((t) => window.localStorage.setItem('rn-theme', t), theme);
      if (path !== '/welcome') await onboardWithSample(page, 1);
      await page.goto(appUrl(path));
      await page.waitForLoadState('networkidle');
      const name = `${testInfo.project.name}-${theme}-${path.slice(1) || 'dashboard'}.png`;
      await page.screenshot({ path: `test-results/screens/${name}`, fullPage: true });
    });
  }
}
