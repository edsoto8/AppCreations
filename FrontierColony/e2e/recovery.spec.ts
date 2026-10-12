/**
 * Failure paths from the release review (M7 MIN-1, MIN-3). These tests provoke errors on purpose,
 * so they use plain Playwright instead of the console-error fixture.
 */
import { expect, test } from '@playwright/test';
import { gotoQuickstart, readTick } from './helpers';

test.setTimeout(120_000);

test('a simulation error halts the game with a persistent banner, and loading a save recovers', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'recovery-1' });
  await page.evaluate(() => {
    const c = (window as unknown as { __frontierColony: { saveGame(slot: string): unknown } }).__frontierColony;
    c.saveGame('slot1');
  });

  // Test setup: corrupt the live state so the next tick throws (there is no command path to a fault).
  await page.evaluate(() => {
    const c = (window as unknown as { __frontierColony: { getState(): { settlers: { needs: unknown }[] }; advanceTicks(n: number): void } })
      .__frontierColony;
    c.getState().settlers[0]!.needs = null;
    c.advanceTicks(5);
  });

  await expect(page.getByTestId('halted-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('speed-1')).toBeDisabled();
  const haltedAt = await readTick(page);
  await page.waitForTimeout(1500);
  expect(await readTick(page)).toBe(haltedAt);

  await page.evaluate(() => {
    const c = (window as unknown as { __frontierColony: { loadGame(slot: string): { ok: boolean } } }).__frontierColony;
    if (!c.loadGame('slot1').ok) throw new Error('load failed');
  });
  await expect(page.getByTestId('halted-banner')).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('speed-1')).toBeEnabled();
});

test('a save with a malformed summary still lists in the menu instead of blanking the app', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'recovery-2' });
  const colonyName = await page.evaluate(() => {
    const c = (window as unknown as { __frontierColony: { saveGame(slot: string): unknown } }).__frontierColony;
    c.saveGame('slot2');
    const key = 'frontierColony.v1.save.slot2';
    const env = JSON.parse(localStorage.getItem(key)!) as { summary: Record<string, unknown> };
    env.summary.colonyName = { evil: 1 };
    localStorage.setItem(key, JSON.stringify(env));
    localStorage.removeItem('frontierColony.v1.meta.slot2');
    return (window as unknown as { __frontierColony: { getState(): { colony: { name: string } } } }).__frontierColony.getState().colony.name;
  });

  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('menu-load').click();
  // The listed name comes from the validated state, not the malformed envelope summary.
  await expect(page.getByTestId('main-menu')).toContainText(colonyName, { timeout: 30_000 });
  await expect(page.getByTestId('recovery')).toHaveCount(0);
});
