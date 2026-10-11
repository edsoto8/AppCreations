import { advance, gotoQuickstart, readTick } from './helpers';
import { expect, test } from './fixtures';

/** Ticks gained over a real-time window, measured from the sim tick counter. */
async function ticksOver(page: import('@playwright/test').Page, ms: number): Promise<number> {
  const before = await readTick(page);
  await page.waitForTimeout(ms);
  return (await readTick(page)) - before;
}

test.describe('speed controls', () => {
  test('pause stops the clock and 1x/2x/4x advance it', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed' });
    const speeds = page.getByTestId('speed-controls');
    await expect(speeds).toBeVisible();

    // 1x runs.
    await page.getByTestId('speed-1').click();
    await expect(page.getByTestId('speed-1')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => readTick(page), { timeout: 5_000 }).toBeGreaterThan(5);
    const at1x = await ticksOver(page, 1_000);
    expect(at1x).toBeGreaterThan(0);

    // Pause stops it.
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pause-indicator')).toBeVisible();
    const frozen = await readTick(page);
    await page.waitForTimeout(800);
    expect(await readTick(page)).toBe(frozen);

    // Resume with the pause button (same button, now "Resume").
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause-indicator')).toBeHidden();
    await expect.poll(() => readTick(page), { timeout: 5_000 }).toBeGreaterThan(frozen);

    // 4x runs clearly faster than 1x over the same real-time window (generous factor: CI load varies).
    await page.getByTestId('speed-4').click();
    await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true');
    const at4x = await ticksOver(page, 1_000);
    expect(at4x).toBeGreaterThan(at1x * 2);

    // 2x sits between them.
    await page.getByTestId('speed-2').click();
    await expect(page.getByTestId('speed-2')).toHaveAttribute('aria-pressed', 'true');
    expect(await ticksOver(page, 1_000)).toBeGreaterThan(0);
  });

  test('Space toggles pause and 1/2/3 pick the speed', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed-keys' });
    // Take focus off any button so Space is a game shortcut, not "press the focused button".
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('Space');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const frozen = await readTick(page);
    await page.waitForTimeout(600);
    expect(await readTick(page)).toBe(frozen);

    await page.keyboard.press('Space');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => readTick(page), { timeout: 5_000 }).toBeGreaterThan(frozen);

    await page.keyboard.press('3');
    await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('2');
    await expect(page.getByTestId('speed-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    await expect(page.getByTestId('speed-1')).toHaveAttribute('aria-pressed', 'true');
  });

  test('advanceTicks while paused moves time by exactly the requested count', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed-step' });
    await page.getByTestId('pause').click();
    const start = await readTick(page);
    await advance(page, 250);
    expect(await readTick(page)).toBe(start + 250);
  });
});
