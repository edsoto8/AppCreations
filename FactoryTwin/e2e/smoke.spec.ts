import { expect, test, type Page } from '@playwright/test';

async function canvasHasImage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!c) return 0;
    const off = document.createElement('canvas');
    off.width = 160;
    off.height = 90;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(c, 0, 0, off.width, off.height);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
    return colors.size;
  });
}

test('app loads and the 3D view renders', async ({ page }) => {
  await page.goto('/?t=2');
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(() => canvasHasImage(page), { timeout: 90_000 }).toBeGreaterThan(40);
  await expect(page.getByTestId('clock')).toContainText('Day 1');
});

test('play/pause and speed control the simulation clock', async ({ page }) => {
  await page.goto('/?t=1&speed=300');
  const clock = page.getByTestId('clock');
  await expect(clock).toContainText('07:');
  await expect.poll(async () => clock.textContent(), { timeout: 90_000 }).not.toContain('07:00');
  await page.getByTestId('play').click(); // pause
  await expect(page.getByTestId('play')).toContainText('Play');
  const frozen = await clock.textContent();
  await page.waitForTimeout(3000);
  expect(await clock.textContent()).toBe(frozen);
});

test('dashboard shows live KPIs derived from the simulation', async ({ page }) => {
  await page.goto('/?t=3&paused=1&tab=dashboard');
  const kpi = page.getByTestId('kpi-manufactured');
  await expect.poll(async () => Number((await kpi.locator('.value').textContent())?.replace(/,/g, '')), { timeout: 60_000 }).toBeGreaterThan(50);
  await expect(page.getByTestId('bottleneck')).toContainText('bottleneck');
  await expect(page.getByTestId('utilization')).toContainText('Assembly Cell 1');
});

test('clicking a machine in the 3D view opens the inspector', async ({ page }) => {
  await page.goto('/?t=2&paused=1&select=station:cell-1&cam=focus');
  await expect(page.getByTestId('inspector')).toContainText('Assembly Cell 2');
  await page.getByText('Clear').click();
  await expect(page.getByTestId('inspector-empty')).toBeVisible();
  // the camera is focused on cell 2: its robot is at the centre of the viewport
  const box = (await page.locator('canvas').boundingBox())!;
  await page.waitForTimeout(4000);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 20);
  await expect(page.getByTestId('inspector')).toContainText('Assembly Cell 2', { timeout: 60_000 });
});

test('injecting a failure shows it in the timeline and the machine state', async ({ page }) => {
  await page.goto('/?t=2&tab=incidents&speed=1');
  await page.getByTestId('inject-machine-failure').click();
  await expect(page.getByTestId('incident-list')).toContainText('breakdown', { timeout: 60_000 });
  await expect(page.getByTestId('repair-cell-0')).toBeVisible({ timeout: 60_000 });
});
