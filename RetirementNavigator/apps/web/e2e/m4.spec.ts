import { expect, test, type Page } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

/** Values in one column of the gross-to-net table, first retirement rows. */
async function column(page: Page, header: string): Promise<string[]> {
  const table = page.getByRole('region', { name: /^Gross to net by year/ });
  const headers = await table.getByRole('columnheader').allTextContents();
  const index = headers.indexOf(header);
  expect(index, `${header} column`).toBeGreaterThanOrEqual(0);
  const rows = table.getByRole('row');
  const count = Math.min(await rows.count(), 8);
  const values: string[] = [];
  for (let i = 1; i < count; i++) values.push((await rows.nth(i).getByRole('cell').nth(index).textContent()) ?? '');
  return values;
}

test.describe('M4 retirement income', () => {
  test('a Social Security benefit entered at the claiming age and a pension flow into gross-to-net', async ({
    page,
  }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 2); // Near retirement (single).
    await page.goto(appUrl('/retirement-income'));
    await expect(page.getByRole('heading', { level: 1, name: 'Retirement Income' })).toBeVisible();
    // Taxes need unverified rules: labeled, never filled in.
    await expect(page.getByText('Unverified rule').first()).toBeVisible();

    await page
      .getByRole('radio', { name: /Benefit at your planned claiming age/ })
      .first()
      .check();
    await page.getByLabel('Monthly benefit at your claiming age', { exact: true }).first().fill('2,400');
    await expect.poll(async () => (await column(page, 'Social Security')).some((v) => v !== '$0')).toBe(true);

    await page.getByRole('button', { name: /Add a pension/ }).click();
    const amount = page.getByLabel('Annual amount', { exact: true }).last();
    await amount.fill('12,000');
    await expect.poll(async () => (await column(page, 'Pensions')).some((v) => v !== '$0')).toBe(true);

    await page.waitForTimeout(500); // debounced save
    await page.reload();
    await expect(page.getByLabel('Monthly benefit at your claiming age', { exact: true }).first()).toHaveValue(/2,400/);
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('the Retirement Income page is accessible in both themes and fits a phone screen', async ({ page }) => {
    test.setTimeout(120_000);
    await onboardWithSample(page, 1); // Mid-career couple.
    for (const theme of ['Light theme', 'Dark theme']) {
      await page.goto(appUrl('/retirement-income'));
      await page.getByRole('radio', { name: theme }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Retirement Income' })).toBeVisible();
      await expectNoAxeViolations(page);
      for (;;) {
        const button = page.getByRole('button', { name: /^Show .*table/ }).first();
        if ((await button.count()) === 0) break;
        await button.click();
      }
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'retirement income overflows horizontally').toBeLessThanOrEqual(0);
    }
  });
});
