import { expect, test } from './fixtures';
import { GAME_HOURS_PER_TICK, advance, gotoQuickstart, readGame, readTick, waitFrames } from './helpers';


test('save to slot1, advance time, load slot1: day and tick are restored', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-saveload' });
  await advance(page, 400);
  // Pause before saving so the saved tick is the one we advanced to.
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
  await waitFrames(page, 3);
  const saved = await readGame(page);

  await page.getByTestId('tool-saveLoad').click();
  await expect(page.getByTestId('saveload')).toBeVisible();
  await page.getByTestId('save-slot1').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Game saved.' })).toBeVisible();
  const envelope = await page.evaluate(() => JSON.parse(localStorage.getItem('frontierColony.v1.save.slot1') ?? 'null'));
  expect(envelope?.state?.time?.tick).toBe(saved.tick);
  await expect(page.getByTestId('slot-slot1')).toContainText('New Hope');

  await advance(page, 1200);
  expect((await readGame(page)).tick).toBe(saved.tick + 1200);

  await page.getByTestId('load-slot1').click();
  // Loading over a running game asks first.
  await expect(page.getByTestId('slot-slot1').getByText('Replace the current game?')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Game loaded.' })).toBeVisible();

  // Pause state after a load: the controller resumes a playing game (replaceState -> setPaused(false)).
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('pause-indicator')).toBeHidden();

  // Ticks run from the moment of the load until our pause lands, so the restored tick is bounded
  // below by the saved tick and above by the few ticks that elapse before the pause click.
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
  await waitFrames(page, 3);
  const restored = await readGame(page);
  expect(restored.tick).toBeGreaterThanOrEqual(saved.tick);
  expect(restored.tick - saved.tick).toBeLessThan(300);
  expect(restored.day).toBe(saved.day);
  // Time of day is derived from the tick, so the restored clock must agree with the tick elapsed since the save.
  expect(restored.timeOfDay - saved.timeOfDay).toBeCloseTo((restored.tick - saved.tick) * GAME_HOURS_PER_TICK, 6);
  expect(restored.settlers.map((s) => s.id).sort()).toEqual(saved.settlers.map((s) => s.id).sort());
  expect(restored.colonyName).toBe(saved.colonyName);

  // And it really is frozen now.
  const frozen = restored.tick;
  await waitFrames(page, 5);
  expect(await readTick(page)).toBe(frozen);
});

test('a corrupt slot1 save shows an error toast instead of crashing', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-corrupt-save' });
  await advance(page, 100);

  // Make slot1 exist and open the panel while it is still valid, so its Load button is enabled.
  await page.getByTestId('tool-saveLoad').click();
  await expect(page.getByTestId('saveload')).toBeVisible();
  await page.getByTestId('save-slot1').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Game saved.' })).toBeVisible();

  // Corrupt the stored save behind the panel's back, then try to load it.
  await page.evaluate(() => localStorage.setItem('frontierColony.v1.save.slot1', '{"format":"frontier-colony-save", garbage'));
  await page.getByTestId('load-slot1').click();
  await page.getByTestId('confirm-yes').click();

  await expect(page.getByTestId('toast').filter({ hasText: 'corrupt' })).toBeVisible();
  // The running game is untouched and keeps ticking.
  const before = await readTick(page);
  await expect.poll(() => readTick(page), { timeout: 5_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId('clock')).toBeVisible();

  // The panel now reports the slot as unreadable and will not offer to load it.
  await expect(page.getByTestId('slot-slot1')).toContainText('Unreadable save');
  await expect(page.getByTestId('load-slot1')).toBeDisabled();
});

test('a save with a non-save JSON shape is rejected by the listing as not a Frontier Colony save', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-wrong-shape' });
  await page.evaluate(() => localStorage.setItem('frontierColony.v1.save.slot2', JSON.stringify({ hello: 'world' })));
  await page.getByTestId('tool-saveLoad').click();
  await expect(page.getByTestId('slot-slot2')).toContainText('Unreadable save');
  await expect(page.getByTestId('slot-slot2')).toContainText('Not a Frontier Colony save');
});
