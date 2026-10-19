import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Records every request; returns those not served by the app's own origin. */
export function trackOutboundRequests(page: Page, origin = 'http://127.0.0.1:4173'): () => string[] {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) outbound.push(url);
  });
  return () => outbound;
}

/** Fails on any CSP violation or uncaught error. */
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return () => errors;
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
  expect(summary).toEqual([]);
}

/** The year is pinned for reproducible E2E runs (the UI reads `?year=`; the engine never reads the clock). */
export const E2E_YEAR = 2026;
export const appUrl = (path: string) => `/?year=${E2E_YEAR}#${path}`;

/** Finish first-run onboarding with a sample profile (index into the sample cards). */
export async function onboardWithSample(page: Page, sampleIndex = 1): Promise<void> {
  await page.goto(appUrl('/welcome'));
  await page.getByRole('button', { name: 'Use this sample' }).nth(sampleIndex).click();
  await expect(page.getByRole('region', { name: /10-year income and savings preview/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Finish setup/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
}
