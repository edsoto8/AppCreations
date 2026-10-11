import { expect, test } from './fixtures';
import { gotoQuickstart, readGame } from './helpers';

test('settlers panel: clicking a row opens the inspector with that settler name and activity', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-settlers' });
  // Freeze time so the activity label cannot change between reading it and checking it.
  await page.getByTestId('pause').click();

  await page.getByTestId('tool-settlers').click();
  await expect(page.getByTestId('settlers-panel')).toBeVisible();

  const game = await readGame(page);
  expect(game.settlers.length).toBeGreaterThanOrEqual(2);
  const target = game.settlers[1];

  await page.getByTestId(`settler-row-${target.id}`).click();
  await expect(page.getByTestId('settler-inspector-body')).toBeVisible();
  await expect(page.getByTestId('inspector-name')).toHaveText(target.name);
  expect(target.activity.label.length).toBeGreaterThan(0);
  await expect(page.getByTestId('inspector-activity')).toContainText(target.activity.label);
  await expect(page.getByTestId(`settler-row-${target.id}`)).toHaveAttribute('aria-pressed', 'true');
});
