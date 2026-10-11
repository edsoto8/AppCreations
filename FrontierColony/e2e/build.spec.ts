import { expect, test } from './fixtures';
import { gotoQuickstart, openBuildingInspectorByClick, readGame, tileScreenPoint } from './helpers';

test('build panel: pick a house, click a valid tile, get a construction site, open its inspector', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-build' });
  const canvasBox = await page.getByTestId('game-canvas').boundingBox();
  if (!canvasBox) throw new Error('game canvas has no box');

  await page.getByTestId('tool-build').click();
  await expect(page.getByTestId('build-panel')).toBeVisible();
  await page.getByTestId('build-house').click();
  await expect(page.getByTestId('placement-bar')).toBeVisible();

  const before = await readGame(page);
  const tc = before.buildings.find((b) => b.type === 'townCenter');
  if (!tc) throw new Error('no town centre at start');
  const cx = tc.origin.x + tc.footprint.w / 2;
  const cy = tc.origin.y + tc.footprint.h / 2;

  // Candidate tiles around the town centre, nearest first. Only click points that are clear of the
  // side panel, the top bar and the bottom toolbar.
  const candidates: { x: number; y: number; d: number }[] = [];
  for (let dy = -10; dy <= 10; dy++)
    for (let dx = -10; dx <= 10; dx++) {
      const x = Math.floor(cx) + dx;
      const y = Math.floor(cy) + dy;
      if (x < 0 || y < 0 || x >= before.width || y >= before.height) continue;
      candidates.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
    }
  candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);

  let placedAt: { x: number; y: number } | null = null;
  for (const c of candidates.slice(0, 80)) {
    const p = tileScreenPoint(canvasBox, before, c.x, c.y);
    if (p.x < canvasBox.x + 420 || p.x > canvasBox.x + canvasBox.width - 420) continue;
    if (p.y < canvasBox.y + 120 || p.y > canvasBox.y + canvasBox.height - 140) continue;
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    const after = await readGame(page);
    if (after.buildings.length > before.buildings.length) {
      placedAt = { x: c.x, y: c.y };
      break;
    }
  }
  expect(placedAt, 'a click on a clear, buildable tile should place a house').not.toBeNull();

  const game = await readGame(page);
  const site = game.buildings.find((b) => b.type === 'house' && b.status === 'construction');
  expect(site, 'a house construction site exists in state').toBeDefined();
  if (!site || !placedAt) return;
  expect(site.origin.x).toBeGreaterThanOrEqual(placedAt.x - 1);
  expect(site.origin.x).toBeLessThanOrEqual(placedAt.x);
  expect(site.origin.y).toBeGreaterThanOrEqual(placedAt.y - 1);
  expect(site.origin.y).toBeLessThanOrEqual(placedAt.y);

  // Placement ends build mode.
  await expect(page.getByTestId('placement-bar')).toBeHidden();

  // The site can be inspected by clicking it on the map.
  // Click the footprint tiles until the House inspector opens (a neighbour's sprite can take the click).
  await openBuildingInspectorByClick(page, site.id, 'House');
  await expect(page.getByTestId('building-status')).toBeVisible();
});

test('clicking the town centre opens its inspector', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-build-tc' });
  const canvasBox = await page.getByTestId('game-canvas').boundingBox();
  if (!canvasBox) throw new Error('game canvas has no box');
  const game = await readGame(page);
  const tc = game.buildings.find((b) => b.type === 'townCenter');
  if (!tc) throw new Error('no town centre');
  const p = tileScreenPoint(canvasBox, game, tc.origin.x + 1, tc.origin.y + 1);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('building-inspector')).toBeVisible();
  await expect(page.getByTestId('inspector-name')).toHaveText('Town Center');
});
