/**
 * Shared Playwright fixture: every test in this suite also fails when the page logged a
 * console error or threw an uncaught error. Import `test` and `expect` from here, not from
 * '@playwright/test'.
 */
import { test as base, expect } from '@playwright/test';

/** Chrome logs failed favicon requests as console errors; they are not app errors. */
const IGNORED_CONSOLE = /favicon/i;

export const test = base.extend<{ noConsoleErrors: void }>({
  noConsoleErrors: [
    async ({ page }, use) => {
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

export { expect };
