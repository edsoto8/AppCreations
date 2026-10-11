import { expect, test } from './fixtures';
import { readGame } from './helpers';

test('main menu: New Game form starts a colony with the chosen name, seed and preset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();

  await page.getByTestId('menu-new-game').click();
  const form = page.getByTestId('new-game-form');
  await expect(form).toBeVisible();

  await page.getByTestId('new-game-name').fill('QA Colony');
  await page.getByTestId('new-game-seed').fill('qa-menu-seed');
  await page.getByTestId('preset-archipelago').check();
  await page.getByTestId('size-small').check();
  await page.getByTestId('difficulty-harsh').check();
  await page.getByTestId('new-game-start').click();

  await expect(page.getByTestId('clock')).toContainText('Day 1');
  await expect(page.getByTestId('colony-name-block')).toContainText('QA Colony');
  await expect(page.getByTestId('main-menu')).toBeHidden();

  const game = await readGame(page);
  expect(game.colonyName).toBe('QA Colony');
  expect(game.seed).toBe('qa-menu-seed');
  expect(game.preset).toBe('archipelago');
  expect(game.settlers.length).toBeGreaterThan(0);
});

test('main menu: Back from New Game returns to the menu without starting a game', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('menu-new-game').click();
  await expect(page.getByTestId('new-game-form')).toBeVisible();
  await page.getByTestId('new-game-back').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('top-bar')).toHaveCount(0);
});
