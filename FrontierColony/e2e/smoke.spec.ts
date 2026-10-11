import { expect, test } from '@playwright/test';

test('app loads, renders the canvas without console errors, and time advances', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?quickstart');

  const canvas = page.getByTestId('game-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);
  expect(box?.height ?? 0).toBeGreaterThan(200);

  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect(page.getByTestId('clock')).toContainText('Day 1');
  await expect(page.getByTestId('population')).toContainText('5');

  // The debug handle exposes the controller; the sim tick must advance while unpaused.
  const tickAt = () => page.evaluate(() => window.__frontierColony?.getState().time.tick ?? -1);
  const first = await tickAt();
  await expect.poll(tickAt, { timeout: 5_000 }).toBeGreaterThan(first + 5);

  // Pausing stops time.
  await page.getByTestId('pause').click();
  const paused = await tickAt();
  await page.waitForTimeout(500);
  expect(await tickAt()).toBe(paused);

  // Higher speed resumes and runs faster than 1x would.
  await page.getByTestId('speed-4').click();
  await expect.poll(tickAt, { timeout: 5_000 }).toBeGreaterThan(paused + 20);

  expect(errors).toEqual([]);
});
