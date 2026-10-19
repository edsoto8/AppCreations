import { expect, test } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M6 Monte Carlo', () => {
  test('runs in workers: a quick result, then the full result with its assumptions; no network, no errors', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/monte-carlo'));
    await expect(page.getByRole('heading', { level: 1, name: 'Monte Carlo' })).toBeVisible();
    await page.getByLabel('Number of paths', { exact: true }).fill('2000');
    await page.getByRole('button', { name: 'Run simulation' }).click();
    await expect(page.getByText('Probability of funding modeled spending')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Model-dependent estimate, not a guarantee.').first()).toBeVisible();
    await expect(page.getByText(/^Preliminary/)).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByLabel('Run time')).toContainText(/Full run/);
    // The assumptions sit beside the success rate.
    await expect(page.getByText(/paths, seed \d+; lognormal annual returns/)).toBeVisible();
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('the Monte Carlo page is accessible in both themes after a run and fits a phone screen', async ({ page }) => {
    test.setTimeout(180_000);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/monte-carlo'));
    await page.getByLabel('Number of paths', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Run simulation' }).click();
    await expect(page.getByText('Probability of funding modeled spending')).toBeVisible({ timeout: 60_000 });
    for (const theme of ['Light theme', 'Dark theme']) {
      await page.getByRole('radio', { name: theme }).click();
      for (;;) {
        const button = page.getByRole('button', { name: /^Show .*table/ }).first();
        if ((await button.count()) === 0) break;
        await button.click();
      }
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'monte carlo page overflows horizontally').toBeLessThanOrEqual(0);
    }
  });
});
