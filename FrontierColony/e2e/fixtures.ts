/**
 * Shared Playwright fixture: every test in this suite also fails when the page logged a
 * console error or threw an uncaught error. Import `test` and `expect` from here, not from
 * '@playwright/test'.
 */
import { test as base, expect as baseExpect } from '@playwright/test';

/** Chrome logs failed favicon requests as console errors; they are not app errors. */
const IGNORED_CONSOLE = /favicon/i;

/**
 * Under software WebGL the page renders a few frames per second and four CPUs are shared by the
 * workers, so a page can take longer than the 30 s default just to become responsive. Each test gets
 * 120 s and each expect 30 s; assertions stay exact, only the waiting is longer.
 */
const TEST_TIMEOUT_MS = 120_000;
export const expect = baseExpect.configure({ timeout: 30_000 });

export const test = base.extend<{ noConsoleErrors: void }>({
  noConsoleErrors: [
    async ({ page }, use, testInfo) => {
      testInfo.setTimeout(TEST_TIMEOUT_MS);
      const problems: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (IGNORED_CONSOLE.test(msg.location().url)) return;
        problems.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      await use();
      expect(problems, 'console errors or uncaught page errors during this test').toEqual([]);
    },
    { auto: true },
  ],
});

