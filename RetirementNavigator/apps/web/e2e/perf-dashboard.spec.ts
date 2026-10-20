import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { expect, test } from '@playwright/test';
import { appUrl, onboardWithSample } from './helpers';

/**
 * Browser benchmark (`pnpm --filter @rn/web bench:browser`, not part of `pnpm verify`): deterministic
 * dashboard recalculation in the production build (brief §9: < 100 ms for a typical profile).
 * One recalculation is `computeDashboard` (baseline plus optimistic and pessimistic re-runs), which
 * the dashboard records as the User Timing measure `rn:dashboard`. Each visit to the dashboard
 * remounts it and recomputes once.
 * - "desktop": unthrottled.
 * - "mobile": an emulated phone, Chromium CPU throttling 4× on the page's main thread (where the
 *   dashboard runs). Emulated, not a real device.
 * Results go to bench-results/dashboard-browser-<project>.json.
 */
const SAMPLES = ['Early career', 'Mid-career couple', 'Near retirement', 'High earner'];
const VISITS = 15;
const results: Record<string, unknown>[] = [];

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? NaN;
const round = (ms: number) => Math.round(ms * 10) / 10;

for (const [index, sample] of SAMPLES.entries()) {
  test(`@perf dashboard recalculation: ${sample}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const throttled = testInfo.project.name === 'mobile';
    await onboardWithSample(page, index);
    await page.goto(appUrl('/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    if (throttled) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    // The first visits load code-split chunks; measure after the page is warm.
    await page.evaluate(() => performance.clearMeasures('rn:dashboard'));
    for (let i = 0; i < VISITS; i++) {
      await page.goto(appUrl('/rules'));
      await expect(page.getByRole('heading', { level: 1, name: /Rules/ })).toBeVisible();
      await page.goto(appUrl('/'));
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => performance.getEntriesByName('rn:dashboard').length))
        .toBeGreaterThan(i);
    }
    const durations = await page.evaluate(() => performance.getEntriesByName('rn:dashboard').map((e) => e.duration));
    const sorted = [...durations].sort((a, b) => a - b);
    results.push({
      project: testInfo.project.name,
      cpuThrottling: throttled ? '4× (emulated phone)' : 'none',
      profile: sample,
      rules: 'bundled (before taxes)',
      recalculations: sorted.length,
      medianMs: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      maxMs: round(sorted[sorted.length - 1] ?? NaN),
    });
    save(testInfo.project.name);
    expect(sorted.length).toBeGreaterThanOrEqual(VISITS);
  });
}

/** Rewritten after each test, so the file holds every profile measured so far for the project. */
function save(project: string): void {
  mkdirSync('bench-results', { recursive: true });
  writeFileSync(
    `bench-results/dashboard-browser-${project}.json`,
    `${JSON.stringify(
      {
        measuredOn: {
          cpu: cpus()[0]?.model ?? 'unknown',
          cores: cpus().length,
          browser: 'headless Chromium (Playwright)',
        },
        target: 'computeDashboard < 100 ms (typical profile)',
        note: 'User Timing measure rn:dashboard around computeDashboard (3 projections). Throttled runs are emulated, not a real phone.',
        results: results.filter((r) => r.project === project),
      },
      null,
      2,
    )}\n`,
  );
}
