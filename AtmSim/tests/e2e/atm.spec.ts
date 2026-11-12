import { test, expect, type Page } from '@playwright/test';

type Pt = { x: number; y: number; visible: boolean } | null;

async function st(page: Page) {
  return page.evaluate(() => (window as any).atmTest.state());
}

async function waitFor(page: Page, pred: (s: any) => boolean, timeout = 60_000) {
  const start = Date.now();
  for (;;) {
    const s = await st(page);
    if (pred(s)) return s;
    if (Date.now() - start > timeout) throw new Error('timeout; last state ' + JSON.stringify(s));
    await page.waitForTimeout(150);
  }
}

async function clickAt(page: Page, p: Pt, what: string) {
  expect(p, `${what} should be on screen`).not.toBeNull();
  expect(p!.visible, `${what} should be visible`).toBe(true);
  await page.mouse.click(p!.x, p!.y);
}

async function ready(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).atmTest, null, { timeout: 60_000 });
  // Fast sim + jump camera to the front so 3D targets are reachable.
  await page.evaluate(() => {
    const a = (window as any).atm;
    a.stage.setQuality('low'); // software WebGL in CI is slow: no shadows/outlines
    a.clock.maxFrameMs = 1000;
    a.clock.setSpeed(4);
    a.sys.config.cashTakeTimeoutMs = 600_000; // the slow headless renderer needs time to click
    a.sys.config.cardTakeTimeoutMs = 600_000;
  });
  await page.waitForTimeout(2200); // intro camera move
}

async function pressKey(page: Page, key: string) {
  const p = await page.evaluate((k) => (window as any).atmTest.keyPoint(k), key);
  await clickAt(page, p, `key ${key}`);
  await page.waitForTimeout(120);
}

async function touch(page: Page, id: string) {
  await page.evaluate(() => (window as any).atmTest.camera('screen'));
  await page.waitForTimeout(150);
  const p = await page.evaluate((b) => (window as any).atmTest.screenButtonPoint(b), id);
  await clickAt(page, p, `screen button ${id}`);
}

test('E1 loads, renders WebGL and has no console errors', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  const s = await st(page);
  expect(s.screen).toBe('WELCOME');
  expect(s.invariants).toEqual([]);
  await expect(page.locator('#three-canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/e1-front.png' });
  expect(errors).toEqual([]);
});

test('E2 full withdrawal by clicking the 3D card, keypad, screen and cash', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  const before = (await st(page)).cassettes.find((c: any) => c.id === 'A').counter;

  await page.evaluate(() => (window as any).atmTest.camera('front'));
  await page.waitForTimeout(150);
  await clickAt(page, await page.evaluate(() => (window as any).atmTest.cardPoint()), 'training card');
  await waitFor(page, (s) => s.screen === 'PIN_ENTRY' && !s.busy);

  await page.evaluate(() => (window as any).atmTest.camera('keypad'));
  await page.waitForTimeout(150);
  for (const k of ['1', '2', '3', '4', 'ENTER']) await pressKey(page, k);
  await waitFor(page, (s) => s.screen === 'MAIN_MENU' && !s.busy);

  await touch(page, 'menu-withdraw');
  await waitFor(page, (s) => s.screen === 'ACCOUNT_SELECT' && !s.busy);
  await touch(page, 'acct-CHK-1001');
  await waitFor(page, (s) => s.screen === 'AMOUNT_ENTRY' && !s.busy);
  await touch(page, 'amt-6000');

  await waitFor(page, (s) => s.waitingForCash, 90_000);
  await page.evaluate(() => (window as any).atmTest.camera('front'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/e2-cash-presented.png' });
  await clickAt(page, await page.evaluate(() => (window as any).atmTest.propPoint('cash')), 'presented cash');
  await waitFor(page, (s) => s.txnState === 'COMPLETED', 30_000);

  await waitFor(page, (s) => s.screen === 'RESULT' && !s.busy);
  await touch(page, 'receipt-no');
  await waitFor(page, (s) => s.screen === 'ANOTHER_TXN' && !s.busy);
  await touch(page, 'another-no');
  await waitFor(page, (s) => s.waitingForCard, 30_000);
  await page.evaluate(() => (window as any).atmTest.camera('front'));
  await page.waitForTimeout(200);
  await clickAt(page, await page.evaluate(() => (window as any).atmTest.propPoint('card-ejected')), 'ejected card');
  const end = await waitFor(page, (s) => s.screen === 'WELCOME' && !s.busy, 30_000);

  const after = end.cassettes.find((c: any) => c.id === 'A').counter;
  expect(before - after).toBe(3); // $60 = 3 × $20 with the fewest-notes strategy
  expect(end.invariants).toEqual([]);
  await page.locator('[data-tab="cashmini"]').click();
  await expect(page.locator('[data-cassette="A"] [data-count]')).toHaveAttribute('data-count', String(after));
  expect(errors).toEqual([]);
});

test('E3 view modes and component inspection', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  for (const v of ['xray', 'cutaway', 'exploded', 'internal', 'exterior']) {
    await page.locator(`[data-view="${v}"]`).click();
    await page.waitForTimeout(1600);
    if (v === 'exploded') await page.screenshot({ path: `test-results/e3-${v}.png` });
  }
  await page.locator('[data-select="stacker"]').first().click();
  await expect(page.locator('[data-component="stacker"]')).toBeVisible();
  // Click a part in 3D: keypad body
  await page.evaluate(() => (window as any).atmTest.camera('front'));
  await page.waitForTimeout(300);
  await clickAt(page, await page.evaluate(() => (window as any).atmTest.partPoint('vault-door')), 'vault door');
  await expect(page.locator('[data-component="vault-door"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('E4 fault scenario runs and ends in the documented state', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  await page.locator('[data-mode="troubleshoot"]').click();
  await page.locator('[data-fault-item="cash-jam"]').click();
  await page.locator('#run-scenario').click();
  await expect(page.locator('#scenario-state')).toHaveText('REVERSED', { timeout: 90_000 });
  await page.screenshot({ path: 'test-results/e4-jam.png' });
  await page.locator('#recover-fault').click();
  await waitFor(page, (s) => s.screen === 'WELCOME' && !s.busy, 30_000);
  const s = await st(page);
  expect(s.invariants).toEqual([]);
  expect(errors).toEqual([]);
});

test('E5 guided tour can be stepped to the end', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  await page.locator('[data-tour="exterior"]').click();
  for (let i = 0; i < 20; i++) {
    const btn = page.locator('#tour-next');
    if (!(await btn.isVisible())) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  await expect(page.locator('#tour-card')).toBeHidden();
  expect(errors).toEqual([]);
});

test('E6 reconciliation detects a discrepancy and reset restores the inventory', async ({ page }) => {
  const errors: string[] = [];
  await ready(page, errors);
  await page.locator('[data-mode="reconciliation"]').click();
  await expect(page.locator('#recon-status')).toHaveAttribute('data-balanced', 'true');
  await page.locator('[data-discrepancy="missing-notes"]').click();
  await expect(page.locator('#recon-status')).toHaveAttribute('data-balanced', 'false');
  await page.screenshot({ path: 'test-results/e6-recon.png' });
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-reset').click();
  await page.locator('[data-mode="reconciliation"]').click();
  await expect(page.locator('#recon-status')).toHaveAttribute('data-balanced', 'true');
  expect(errors).toEqual([]);
});
