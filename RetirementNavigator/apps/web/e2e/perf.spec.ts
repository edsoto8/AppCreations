import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import { appUrl, onboardWithSample } from './helpers';

/**
 * Browser benchmark (`pnpm --filter @rn/web bench:browser`, not part of `pnpm verify`): a
 * 10,000-path Monte Carlo run of the "Mid-career couple" sample in the production build with real
 * Web Workers. "desktop" runs unthrottled; "mobile" emulates a phone with 4× CPU throttling through
 * the DevTools protocol (labeled emulated; not a real device). The page reports its own wall time
 * ("Full run … s"), which is what is recorded. Results go to bench-results/montecarlo-browser.json.
 */
const results: Record<string, unknown>[] = [];

async function runOnce(page: Page): Promise<{ quick: string; full: string }> {
  await page.getByLabel('Number of paths', { exact: true }).fill('10000');
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByText(/^Preliminary/)).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByLabel('Run time')).toContainText(/Full run/, { timeout: 180_000 });
  const text = (await page.getByLabel('Run time').textContent()) ?? '';
  const quick = /Quick run \([^)]*\) computed in ([\d.]+) s/.exec(text)?.[1] ?? '?';
  const full = /Full run \([^)]*\) computed in ([\d.]+) s/.exec(text)?.[1] ?? '?';
  return { quick, full };
}

test('@perf Monte Carlo 10,000 paths × planning horizon', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const throttled = testInfo.project.name === 'mobile';
  await onboardWithSample(page, 1);
  if (throttled) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.goto(appUrl('/monte-carlo'));
  const workers = await page.evaluate(() => Math.min(4, navigator.hardwareConcurrency || 2));
  const first = await runOnce(page);
  await page.getByLabel('Seed', { exact: true }).fill('7');
  const second = await runOnce(page);
  results.push({
    project: testInfo.project.name,
    cpuThrottling: throttled ? '4× (emulated phone)' : 'none',
    workers,
    firstRunAfterOpeningPage: first,
    secondRun: second,
  });
  mkdirSync('bench-results', { recursive: true });
  writeFileSync(
    `bench-results/montecarlo-browser-${testInfo.project.name}.json`,
    `${JSON.stringify(
      {
        measuredOn: {
          cpu: cpus()[0]?.model ?? 'unknown',
          cores: cpus().length,
          browser: 'headless Chromium (Playwright)',
        },
        profile: 'Mid-career couple sample, bundled rules (before taxes)',
        target: '10,000 paths < 3 s (laptop), < 10 s (phone)',
        note: 'Seconds as reported by the page. Throttled runs are emulated, not a real phone; the worker count is the container core count, which a phone may not have.',
        results,
      },
      null,
      2,
    )}\n`,
  );
});
