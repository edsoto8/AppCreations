import { expect, test } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M5 scenarios', () => {
  test('a preset scenario is saved, compared with the base plan, survives a reload, and the optimizer runs', async ({
    page,
  }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1); // Mid-career couple.
    await page.goto(appUrl('/scenarios'));
    await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible();
    await expect(page.getByText(/No scenarios yet/)).toBeVisible();

    await page.getByRole('button', { name: 'New scenario' }).click();
    const dialog = page.getByRole('dialog', { name: 'New scenario' });
    await dialog.getByLabel('Start from', { exact: true }).selectOption('E_delayedRetirement');
    await dialog.getByLabel('Years later', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Create scenario' }).click();

    const list = page.getByRole('list', { name: 'Scenarios' });
    await expect(list.getByText('Retire 3 years later')).toBeVisible();
    const compare = page.getByRole('region', { name: 'Scenario comparison' });
    await expect(compare.getByRole('columnheader', { name: 'Retire 3 years later' })).toBeVisible();

    await page.waitForTimeout(500); // debounced save
    await page.reload();
    await expect(page.getByRole('list', { name: 'Scenarios' }).getByText('Retire 3 years later')).toBeVisible();

    await page.getByRole('button', { name: 'Find earliest age' }).click();
    await expect(
      page.getByText(/^(Earliest age that meets the criterion: \d+|No age from \d+ to \d+ meets)/),
    ).toBeVisible({
      timeout: 20_000,
    });
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('the Scenarios page is accessible in both themes and fits a phone screen', async ({ page }) => {
    test.setTimeout(120_000);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/scenarios'));
    await page.getByRole('button', { name: 'New scenario' }).click();
    const dialog = page.getByRole('dialog', { name: 'New scenario' });
    await dialog.getByLabel('Start from', { exact: true }).selectOption('F_reducedSpending');
    await dialog.getByRole('button', { name: 'Create scenario' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /^Spend \d+% less in retirement$/ })).toBeVisible();
    for (const theme of ['Light theme', 'Dark theme']) {
      await page.getByRole('radio', { name: theme }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible();
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'scenarios page overflows horizontally').toBeLessThanOrEqual(0);
    }
  });
});
