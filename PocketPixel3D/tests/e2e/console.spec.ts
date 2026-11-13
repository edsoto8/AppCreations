import { expect, test, type Page } from '@playwright/test';

type State = Record<string, unknown> & { mode: string; power: boolean; cartridge: string | null; volume: number; explodeProgress: number };

declare global {
  interface Window {
    pocketPixel: {
      state(): State;
      step(n?: number): void;
      frameHash(): number;
      screenPoint(part: string): { x: number; y: number } | null;
      held(b: string): boolean;
      view(name: string): void;
      cartridge(id: string): void;
    };
  }
}

const state = (page: Page): Promise<State> => page.evaluate(() => window.pocketPixel.state());
const step = (page: Page, n: number): Promise<void> => page.evaluate((k) => window.pocketPixel.step(k), n);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug');
  await page.waitForFunction(() => typeof window.pocketPixel?.state === 'function');
});

test.afterEach(() => {
  expect(errors, 'browser console errors').toEqual([]);
});

test('loads the console switched off with a cartridge inserted', async ({ page }) => {
  await expect(page.locator('canvas.scene-canvas')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Console controls' })).toBeVisible();
  const s = await state(page);
  expect(s.mode).toBe('off');
  expect(s.cartridge).toBe('pixel-blocks');
});

test('keyboard: power on, boot, START, and play changes the picture', async ({ page }) => {
  await page.keyboard.press('KeyP');
  expect((await state(page)).mode).toBe('boot');
  await step(page, 200);
  expect((await state(page)).mode).toBe('running');
  const title = await page.evaluate(() => window.pocketPixel.frameHash());
  await page.keyboard.press('Enter');
  await step(page, 10);
  const playing = await page.evaluate(() => window.pocketPixel.frameHash());
  expect(playing).not.toBe(title);
  // Hold left: auto-repeat moves the piece several times.
  await page.keyboard.down('ArrowLeft');
  await step(page, 30);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.press('ArrowUp'); // hard drop
  await step(page, 5);
  expect(await page.evaluate(() => window.pocketPixel.frameHash())).not.toBe(playing);
  // Power off fades the screen.
  await page.keyboard.press('KeyP');
  expect((await state(page)).mode).toBe('off');
});

test('clicking the 3D power switch and holding the 3D A button', async ({ page }) => {
  await page.evaluate(() => window.pocketPixel.view('top'));
  await page.waitForTimeout(800);
  const sw = await page.evaluate(() => window.pocketPixel.screenPoint('power-switch'));
  expect(sw).not.toBeNull();
  await page.mouse.click(sw!.x, sw!.y);
  await expect.poll(async () => (await state(page)).power).toBe(true);

  await page.evaluate(() => window.pocketPixel.view('front'));
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => window.pocketPixel.screenPoint('button-a'));
  await page.mouse.move(a!.x, a!.y);
  await page.mouse.down();
  expect(await page.evaluate(() => window.pocketPixel.held('a'))).toBe(true);
  await page.mouse.up();
  expect(await page.evaluate(() => window.pocketPixel.held('a'))).toBe(false);
  await expect(page.getByRole('complementary', { name: 'Component information' })).toContainText('A button');
});

test('scrolling over the volume wheel turns it', async ({ page }) => {
  await page.evaluate(() => window.pocketPixel.view('right'));
  await page.waitForTimeout(800);
  const before = (await state(page)).volume;
  const p = await page.evaluate(() => window.pocketPixel.screenPoint('volume-wheel'));
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await state(page)).volume).toBeLessThan(before);
});

test('cartridges can only be swapped with the power off', async ({ page }) => {
  await page.keyboard.press('KeyP');
  await page.keyboard.press('KeyL');
  const library = page.getByRole('dialog', { name: 'Cartridge library' });
  await expect(library).toBeVisible();
  await expect(library.locator('[data-cart="pixel-snake"] button')).toBeDisabled();
  await page.evaluate(() => window.pocketPixel.cartridge('pixel-snake'));
  await expect(page.locator('.toast-warn')).toBeVisible();
  expect((await state(page)).cartridge).toBe('pixel-blocks');

  await page.keyboard.press('KeyP');
  await library.locator('[data-cart="pixel-snake"] button').click();
  await expect.poll(async () => (await state(page)).cartridge).toBe('pixel-snake');
  await page.waitForFunction(() => !window.pocketPixel.state().cartridgeMoving, null, { timeout: 45_000 });
  await page.keyboard.press('KeyP');
  await step(page, 200);
  expect((await state(page)).mode).toBe('running');
});

test('exploded view, x-ray and the enlarged display', async ({ page }) => {
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.pocketPixel.state().explodeProgress === 1, null, { timeout: 45_000 });
  await page.keyboard.press('KeyT');
  await expect(page.locator('[data-tool="xray"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.pocketPixel.state().explodeProgress === 0, null, { timeout: 45_000 });

  await page.keyboard.press('KeyP');
  await step(page, 200);
  await page.keyboard.press('KeyD');
  const lcd = page.getByLabel('Enlarged console display');
  await expect(lcd).toBeVisible();
  // The on-screen START button drives the same game.
  const before = await page.evaluate(() => window.pocketPixel.frameHash());
  await page.locator('[data-vbtn="start"]').dispatchEvent('pointerdown', { pointerId: 1 });
  await step(page, 3);
  await page.locator('[data-vbtn="start"]').dispatchEvent('pointerup', { pointerId: 1 });
  await step(page, 10);
  expect(await page.evaluate(() => window.pocketPixel.frameHash())).not.toBe(before);
});
