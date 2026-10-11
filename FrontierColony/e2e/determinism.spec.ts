import { expect, test } from './fixtures';
import { advance, fingerprint, gotoQuickstart, readGame } from './helpers';

test('same seed through two page loads gives the same terrain', async ({ page }) => {
  // Load 1: quickstart.
  await gotoQuickstart(page, { seed: 'qa-determinism', preset: 'riverValley', size: 'small' });
  const first = await readGame(page);
  const firstPrint = fingerprint(first.terrain);
  expect(first.terrain.length).toBe(first.width * first.height);

  // Load 2: same seed, typed into the New Game form.
  await page.goto('/');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-seed').fill('qa-determinism');
  await page.getByTestId('preset-riverValley').check();
  await page.getByTestId('size-small').check();
  await page.getByTestId('new-game-start').click();
  await expect(page.getByTestId('clock')).toContainText('Day 1');
  const second = await readGame(page);

  expect(second.width).toBe(first.width);
  expect(second.height).toBe(first.height);
  expect(fingerprint(second.terrain)).toBe(firstPrint);
  expect(second.terrain).toEqual(first.terrain);
  expect(second.elevation).toEqual(first.elevation);

  // The same colony stays the same after sim time passes, too.
  await advance(page, 200);
  const later = await readGame(page);
  expect(fingerprint(later.terrain)).toBe(firstPrint);
});

test('a different seed gives a different terrain (the fingerprint is not trivially equal)', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-determinism-a', preset: 'riverValley' });
  const a = fingerprint((await readGame(page)).terrain);
  await gotoQuickstart(page, { seed: 'qa-determinism-b', preset: 'riverValley' });
  const b = fingerprint((await readGame(page)).terrain);
  expect(b).not.toBe(a);
});
