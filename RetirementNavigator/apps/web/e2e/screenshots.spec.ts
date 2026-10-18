import { test } from '@playwright/test';

/** Visual verification (run with `pnpm screenshots`); PNGs are read back during milestone review. */
for (const theme of ['light', 'dark'] as const) {
  for (const path of ['/', '/data']) {
    test(`@screens ${theme} ${path}`, async ({ page }, testInfo) => {
      await page.addInitScript((t) => window.localStorage.setItem('rn-theme', t), theme);
      await page.goto(`/#${path}`);
      await page.waitForLoadState('networkidle');
      const name = `${testInfo.project.name}-${theme}-${path === '/' ? 'dashboard' : path.slice(1)}.png`;
      await page.screenshot({ path: `test-results/screens/${name}`, fullPage: true });
    });
  }
}
