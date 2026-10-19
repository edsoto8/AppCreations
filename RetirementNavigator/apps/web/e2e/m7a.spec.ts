import { expect, test } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M7a calculators', () => {
  test('a deep-linked calculator recalculates as inputs change; the Roth IRA link opens Roth vs traditional', async ({
    page,
  }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/calculators'));
    await expect(page.getByRole('heading', { level: 1, name: 'Calculators' })).toBeVisible();
    await page.goto(appUrl('/calculators?c=compoundInterest'));
    const ending = page.getByText('Ending balance', { exact: true }).locator('..');
    await expect(ending).toContainText('$');
    const before = await ending.textContent();
    await page.getByLabel('Years', { exact: true }).fill('35');
    await expect.poll(async () => ending.textContent()).not.toBe(before);

    await page.goto(appUrl('/roth-ira'));
    await page
      .getByRole('link', { name: /Compare Roth vs traditional/ })
      .first()
      .click();
    await expect(page).toHaveURL(/calculators\?c=rothVsTraditional/);
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('calculators are accessible in both themes and fit a phone screen', async ({ page }) => {
    test.setTimeout(180_000);
    await onboardWithSample(page, 1);
    for (const id of ['', 'withdrawal', 'ssClaimingComparison', 'fiNumber']) {
      for (const theme of ['Light theme', 'Dark theme']) {
        await page.goto(appUrl(id ? `/calculators?c=${id}` : '/calculators'));
        await page.getByRole('radio', { name: theme }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${id || 'index'} overflows horizontally`).toBeLessThanOrEqual(0);
      }
    }
  });
});
