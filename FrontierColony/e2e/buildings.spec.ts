/**
 * TEST-5: cancel and demolish from the building inspector (docs/reviews/M5-review.md).
 * Everything here is real clicks: the Build panel, the map, the inspector and its confirm step.
 */
import { expect, test } from './fixtures';
import { advance, gotoQuickstart, openBuildingInspectorByClick, placeHouseWithClicks, readGame } from './helpers';

test('cancel a construction site from the inspector: the site is removed from the colony', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-cancel-site' });
  const site = await placeHouseWithClicks(page);

  await openBuildingInspectorByClick(page, site.id, 'House');
  await expect(page.getByTestId('building-status')).toBeVisible();
  await expect(page.getByTestId('building-remove')).toHaveText(/Cancel construction/);

  await page.getByTestId('building-remove').click();
  await expect(page.getByTestId('building-confirm-yes')).toHaveText('Cancel construction');
  await page.getByTestId('building-confirm-yes').click();

  await expect(page.getByTestId('building-inspector')).toBeHidden();
  await expect.poll(async () => (await readGame(page)).buildings.some((b) => b.id === site.id)).toBe(false);
});

test('cancelling is undone by the confirm step: "No" keeps the site', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-cancel-no' });
  const site = await placeHouseWithClicks(page);
  await openBuildingInspectorByClick(page, site.id, 'House');

  await page.getByTestId('building-remove').click();
  await page.getByTestId('building-confirm-no').click();
  await expect(page.getByTestId('building-remove')).toBeVisible();
  expect((await readGame(page)).buildings.some((b) => b.id === site.id)).toBe(true);
});

test('demolish a finished house from the inspector: it is removed and the refund is stated', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-demolish' });
  const house = await placeHouseWithClicks(page);

  // Let builders finish it (test time: advanced in whole game hours, no real-time waiting).
  for (let i = 0; i < 40; i++) {
    await advance(page, 150);
    const game = await readGame(page);
    if (game.buildings.find((b) => b.id === house.id)?.status === 'complete') break;
  }
  expect((await readGame(page)).buildings.find((b) => b.id === house.id)?.status).toBe('complete');

  await page.getByTestId('pause').click();
  await openBuildingInspectorByClick(page, house.id, 'House');
  await expect(page.getByTestId('building-remove')).toHaveText(/Demolish/);

  await page.getByTestId('building-remove').click();
  await expect(page.getByTestId('building-inspector')).toContainText('You get back');
  await page.getByTestId('building-confirm-yes').click();

  await expect(page.getByTestId('building-inspector')).toBeHidden();
  await expect.poll(async () => (await readGame(page)).buildings.some((b) => b.id === house.id)).toBe(false);
});
