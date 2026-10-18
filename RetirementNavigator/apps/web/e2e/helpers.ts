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
