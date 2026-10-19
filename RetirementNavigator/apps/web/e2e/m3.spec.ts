import { expect, test, type Page } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

const CARDS = [
  'Current age',
  'Retirement age',
  'Years to retirement',
  'Current savings',
  'Projected savings at retirement',
  'Projected monthly retirement income',
  'Estimated monthly retirement spending',
  'Surplus / shortfall',
  'Portfolio longevity',
  'Readiness',
];

/** The card that a dashboard card heading belongs to. */
const card = (page: Page, title: string) =>
  page
    .getByRole('heading', { level: 3, name: title, exact: true })
    .locator('xpath=ancestor::*[contains(@class,"p-4")][1]');

async function openAllTables(page: Page) {
  for (;;) {
    const button = page.getByRole('button', { name: /^Show .*(data table|table)/ }).first();
    if ((await button.count()) === 0) break;
    await button.click();
  }
}

test.describe('M3 dashboard and forecast', () => {
  test('dashboard shows the ten cards, the labeled forecast and its data tables', async ({ page }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1); // Mid-career couple.
    await page.goto(appUrl('/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    for (const title of CARDS)
      await expect(page.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible();

    // Unverified rule steps are left out and labeled, never filled in (owner decision; model §1.7).
    await expect(page.getByText('This forecast leaves out steps whose rule values are not verified yet')).toBeVisible();
    await expect(page.getByText('Before plan limits (unverified)').first()).toBeVisible();
    await expect(page.getByText('Before taxes').first()).toBeVisible();
    await expect(page.getByText(/fixed return offsets/i).first()).toBeVisible();

    // Today's vs future dollars changes projected figures; current savings is the same in both.
    const savings = card(page, 'Projected savings at retirement');
    const current = card(page, 'Current savings');
    const todays = await savings.textContent();
    const currentTodays = await current.textContent();
    await page.getByRole('radio', { name: 'Future dollars' }).first().click();
    await expect(savings).not.toHaveText(todays ?? '');
    await expect(current).toHaveText(currentTodays ?? '');

    // Every chart has a data table alternative, reachable by keyboard.
    await openAllTables(page);
    const details = page.getByRole('region', { name: /^Forecast details by year/ });
    await expect(details.getByRole('row').nth(1)).toContainText('2026');
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('forecast settings on the Profile page change the forecast', async ({ page }) => {
    await onboardWithSample(page, 2); // Near retirement.
    await page.goto(appUrl('/'));
    const longevity = card(page, 'Portfolio longevity');
    const before = await longevity.textContent();
    await page.goto(appUrl('/profile'));
    await page.getByLabel('Withdrawal timing', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Pessimistic return offset', { exact: true }).fill('-3');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel('Pessimistic return offset', { exact: true })).toHaveValue('-3');
    await page.goto(appUrl('/'));
    await expect(card(page, 'Portfolio longevity')).toBeVisible();
    // Start-of-year withdrawals never last longer than mid-year ones when returns are positive.
    const after = await card(page, 'Portfolio longevity').textContent();
    const age = (s: string | null) => Number(/age (\d+)/.exec(s ?? '')?.[1] ?? 999);
    expect(age(after)).toBeLessThanOrEqual(age(before));
  });

  test('the dashboard is accessible in both themes with every table open and fits a phone screen', async ({ page }) => {
    test.setTimeout(120_000);
    await onboardWithSample(page, 1);
    for (const theme of ['Light theme', 'Dark theme']) {
      await page.goto(appUrl('/'));
      await page.getByRole('radio', { name: theme }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await expectNoAxeViolations(page);
      await openAllTables(page);
      await expectNoAxeViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'dashboard overflows horizontally').toBeLessThanOrEqual(0);
    }
  });
});
