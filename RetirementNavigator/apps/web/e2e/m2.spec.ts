import { expect, test } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M2 flows', () => {
  test('onboarding from scratch creates a profile that survives a reload', async ({ page }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await page.goto(appUrl('/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Retirement Navigator' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: /Start blank/ }).click();
    await page.getByLabel('Plan name', { exact: true }).fill('E2E plan');
    await page.getByLabel('Your birth year', { exact: true }).fill('1980');
    await page.getByLabel('Your annual salary', { exact: true }).fill('90,000');
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('region', { name: /10-year income and savings preview for You/ })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: /Finish setup/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Plan name', { exact: true })).toHaveValue('E2E plan');
    await expect(page.getByLabel('Active profile')).toContainText('E2E plan');
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('income and match edits update the readout and the preview live', async ({ page }) => {
    await onboardWithSample(page, 2); // Near retirement: $96,000, 15% to a 401(k).
    await page.goto(appUrl('/income'));
    await expect(page.getByText(/, the full match\./)).toBeVisible();
    const trad = page.getByLabel('Traditional (pre-tax) % of salary', { exact: true });
    await trad.fill('2');
    await expect(
      page.getByText(/capture \$1,920 of a possible \$3,840, leaving \$1,920 per year unclaimed/),
    ).toBeVisible();
    // Limits and taxes depend on unverified rule values: labeled, never filled in.
    await expect(page.getByText('Not available yet: contribution limits (rule values are unverified)')).toBeVisible();
    await expect(
      page.getByText('Not available yet: the take-home pay check (rule values are unverified)'),
    ).toBeVisible();
    await page.getByLabel('Annual base salary', { exact: true }).fill('120,000');
    const preview = page.getByRole('region', { name: /10-year income and savings preview/ });
    await expect(preview.getByRole('row').nth(1)).toContainText('$120,000');
    await page.getByRole('radio', { name: 'Future dollars' }).first().click();
    await expect(preview.getByRole('row').nth(2)).toContainText('$123,000');
    await expectNoAxeViolations(page);
  });

  test('profile edits validate and persist', async ({ page }) => {
    await onboardWithSample(page, 0);
    await page.getByLabel('Planning age', { exact: true }).fill('50');
    await expect(page.getByText('Retirement age is after planning age')).toBeVisible();
    await page.getByLabel('Planning age', { exact: true }).fill('96');
    await expect(page.getByText('Retirement age is after planning age')).toHaveCount(0);
    await page.getByRole('button', { name: /Add a spouse/ }).click();
    await expect(page.getByText('Married filing jointly')).toBeVisible();
    await page.waitForTimeout(500); // debounced save
    await page.reload();
    await expect(page.getByLabel('Planning age', { exact: true }).first()).toHaveValue('96');
    await expect(page.getByText('Married filing jointly')).toBeVisible();
  });

  test('every M2 page is accessible in both themes and fits a phone screen', async ({ page }) => {
    test.setTimeout(180_000); // 7 pages × 2 themes of axe scans
    await onboardWithSample(page, 1);
    for (const path of ['/profile', '/income', '/accounts', '/roth-ira', '/hsa', '/rules', '/profiles']) {
      for (const theme of ['Light theme', 'Dark theme']) {
        await page.goto(appUrl(path));
        await page.getByRole('radio', { name: theme }).click();
        await expect(page.locator('main h1')).toBeVisible();
        await expectNoAxeViolations(page);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
    }
  });
});
