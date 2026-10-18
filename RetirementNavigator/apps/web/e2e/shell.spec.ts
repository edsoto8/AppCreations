import { expect, test } from '@playwright/test';
import { NAV_ITEMS } from '../src/app/navigation';
import { CSP } from '../csp';
import { expectNoAxeViolations, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('app shell', () => {
  test('serves the production CSP before any script', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toBe(CSP);
    const order = await page.evaluate(
      () =>
        Array.from(document.head.children).findIndex(
          (el) => el.tagName === 'META' && el.getAttribute('http-equiv') === 'Content-Security-Policy',
        ) < Array.from(document.head.children).findIndex((el) => el.tagName === 'SCRIPT'),
    );
    expect(order).toBe(true);
  });

  test('visits every section with no outbound requests, console errors or axe violations', async ({
    page,
    isMobile,
  }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    for (const item of NAV_ITEMS) {
      if (isMobile) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.getByRole('dialog').getByRole('link', { name: item.label }).click();
      } else {
        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: item.label }).click();
      }
      await expect(page.getByRole('heading', { level: 1, name: item.label })).toBeVisible();
      await expectNoAxeViolations(page);
    }
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('switches between light and dark themes and remembers the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'Light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('is keyboard navigable from the skip link without changing route', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard flow checked on desktop');
    await page.goto('/#/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/accounts');
  });

  test('sets a page title per route and moves focus to the content on navigation', async ({ page, isMobile }) => {
    test.skip(isMobile, 'checked on desktop');
    await page.goto('/');
    await expect(page).toHaveTitle('Dashboard · Retirement Navigator');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Accounts' }).click();
    await expect(page).toHaveTitle('Accounts · Retirement Navigator');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('has no horizontal scroll at mobile width', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
