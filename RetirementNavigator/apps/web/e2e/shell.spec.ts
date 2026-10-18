import { expect, test } from '@playwright/test';
import { NAV_ITEMS } from '../src/app/navigation';
import { expectNoAxeViolations, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('app shell', () => {
  test('serves the production CSP', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toBe("default-src 'self'; connect-src 'none'; worker-src 'self'; style-src 'self' 'unsafe-inline'");
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

  test('is keyboard navigable from the skip link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard flow checked on desktop');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
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
