import { expect, test } from './fixtures';
import { advance, gotoQuickstart, isPressed, readTick, sampleTicks, waitFrames } from './helpers';


test.describe('speed controls', () => {
  test('1x advances, pause freezes exactly, resume advances again', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed' });
    await page.getByTestId('speed-1').click();
    await expect(page.getByTestId('speed-1')).toHaveAttribute('aria-pressed', 'true');
    // Headless SwiftShader can render only a few frames per second, so allow generous time.
    await expect.poll(() => readTick(page), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pause-indicator')).toBeVisible();
    // Let the pause take effect over several frames, then the tick must not move at all.
    await waitFrames(page, 3);
    const frozen = await readTick(page);
    await waitFrames(page, 5);
    expect(await readTick(page)).toBe(frozen);

    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause-indicator')).toBeHidden();
    await expect.poll(() => readTick(page), { timeout: 10_000 }).toBeGreaterThan(frozen);
  });

  test('4x runs faster than 2x, which runs faster than 1x (measured per page millisecond)', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed-rates' });
    const rate = async (testId: string) => {
      await page.getByTestId(testId).click();
      await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', 'true');
      const before = await readTick(page);
      await expect.poll(() => readTick(page), { timeout: 10_000 }).toBeGreaterThan(before);
      const { ticks, ms } = await sampleTicks(page, 4_000);
      return (ticks / ms) * 1000;
    };
    const r1 = await rate('speed-1');
    const r2 = await rate('speed-2');
    const r4 = await rate('speed-4');
    expect(r1).toBeGreaterThan(0);
    expect(r2).toBeGreaterThan(r1);
    expect(r4).toBeGreaterThan(r2);
    expect(r4).toBeGreaterThan(r1 * 2);
  });

  test('Space toggles pause and 1/2/3 pick the speed', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed-keys' });
    // Take focus off any button so Space is a game shortcut, not "press the focused button".
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('Space');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await waitFrames(page, 3);
    const frozen = await readTick(page);
    await waitFrames(page, 5);
    expect(await readTick(page)).toBe(frozen);

    await page.keyboard.press('Space');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => readTick(page), { timeout: 10_000 }).toBeGreaterThan(frozen);

    await page.keyboard.press('3');
    await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('2');
    await expect(page.getByTestId('speed-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    await expect(page.getByTestId('speed-1')).toHaveAttribute('aria-pressed', 'true');
    expect(await isPressed(page, 'pause')).toBe(false);
  });

  test('advanceTicks while paused moves time by exactly the requested count', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-speed-step' });
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await waitFrames(page, 3);
    const start = await readTick(page);
    await advance(page, 250);
    expect(await readTick(page)).toBe(start + 250);
  });
});
