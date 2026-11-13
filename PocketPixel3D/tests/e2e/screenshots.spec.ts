import { test, type Page } from '@playwright/test';

/** Regenerates docs/screenshots. Run with `npm run screenshots` (excluded from `npm run e2e`). */
test.use({ deviceScaleFactor: 2 });
test.setTimeout(900_000);

const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${name}.jpg`, quality: 88, type: 'jpeg' });
const settle = (page: Page, ms = 2500) => page.waitForTimeout(ms);

test('capture screenshots @screenshots', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForFunction(() => typeof (window as any).pocketPixel?.state === 'function');
  await settle(page);
  await shot(page, 'home');
  await page.evaluate(() => (window as any).pocketPixel.view('front'));
  await settle(page);
  await shot(page, 'front');
  await page.evaluate(() => (window as any).pocketPixel.view('back'));
  await settle(page);
  await shot(page, 'back');

  await page.evaluate(() => (window as any).pocketPixel.view('front'));
  await page.keyboard.press('KeyP');
  await page.evaluate(() => (window as any).pocketPixel.step(200));
  await page.keyboard.press('Enter');
  const pp = (fn: string) => page.evaluate(fn);
  for (let i = 0; i < 14; i++) {
    const key = ['ArrowLeft', 'KeyZ', 'ArrowRight', 'ArrowRight', 'KeyX', 'ArrowLeft', 'ArrowLeft'][i % 7]!;
    await page.keyboard.press(key);
    await pp('window.pocketPixel.step(36)');
  }
  await page.keyboard.press('KeyF');
  await settle(page, 6000);
  await shot(page, 'gameplay');
  await page.keyboard.press('KeyD');
  await settle(page, 1500);
  await shot(page, 'gameplay-2d');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => (window as any).pocketPixel.state().explodeProgress === 1, null, { timeout: 300_000 });
  await settle(page, 1500);
  await shot(page, 'exploded');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => (window as any).pocketPixel.state().explodeProgress === 0, null, { timeout: 300_000 });
  await page.keyboard.press('KeyT');
  await page.evaluate(() => (window as any).pocketPixel.lighting('dark'));
  await page.keyboard.press('KeyC');
  await settle(page, 5000);
  await shot(page, 'xray-dark');
});
