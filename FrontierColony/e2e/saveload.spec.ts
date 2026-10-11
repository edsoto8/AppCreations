import { expect, test } from './fixtures';
import { advance, gotoQuickstart, readGame, readTick } from './helpers';

test('save to slot1, advance time, load slot1: day and tick are restored', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-saveload' });
  await advance(page, 400);
  const saved = await readGame(page);

  await page.getByTestId('tool-saveLoad').click();
  await expect(page.getByTestId('saveload')).toBeVisible();
  await page.getByTestId('save-slot1').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Game saved.' })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('frontierColony.v1.save.slot1'));
  expect(stored).not.toBeNull();
  await expect(page.getByTestId('slot-slot1')).toContainText('New Hope');

  await advance(page, 1200);
  const later = await readGame(page);
  expect(later.tick).toBeGreaterThan(saved.tick);

  await page.getByTestId('load-slot1').click();
  // Loading over a running game asks first.
  await expect(page.getByTestId('slot-slot1').getByText('Replace the current game?')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Game loaded.' })).toBeVisible();

  const restored = await readGame(page);
  expect(restored.tick).toBe(saved.tick);
  expect(restored.day).toBe(saved.day);
  expect(restored.timeOfDay).toBeCloseTo(saved.timeOfDay, 9);
  expect(restored.settlers.map((s) => s.id)).toEqual(saved.settlers.map((s) => s.id));
  expect(await readTick(page)).toBe(saved.tick);
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
