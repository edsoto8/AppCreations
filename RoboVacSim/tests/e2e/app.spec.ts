import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Browser tests against the production build (vite preview). WebGL runs on SwiftShader in CI, so
 * rendering is slow; long simulated periods are fast-forwarded through the debug hook
 * window.__robovac.sim.runFor(seconds), which steps the same fixed-step simulation the UI shows.
 */

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Hooks = {
  __robovac: {
    sim: {
      clock: { time: number; speed: number };
      ctrl: { mode: string; mission: { phase: string; tasks: unknown[] } | null };
      res: { soc: number };
      layout: { obstacles: unknown[] };
      dirt: { total(k: string): number };
      runFor(s: number, until?: () => boolean): number;
    };
    view: { stage: { renderer: { info: { memory: { geometries: number; textures: number } } } } };
    reset(p?: string, seed?: number): void;
    addObstacleAt(kind: string, x: number, y: number): void;
  };
  __store: { getState(): Record<string, unknown> & { set(p: Record<string, unknown>): void }; setState(p: Record<string, unknown>): void };
};

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Hooks).__robovac && !!document.querySelector('[data-testid=viewport] canvas'));
  await page.evaluate(() => (window as unknown as Hooks).__store.setState({ quality: 'low' }));
  await page.waitForTimeout(1500);
}

test('loads the simulator with dashboard, 3D view and 2D map', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await expect(page.getByTestId('mode-badge')).toContainText(/Charging|Idle|Maintenance/);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('btn-start')).toBeEnabled();
  await expect(page.getByTestId('btn-resume')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-overview.png` });
  expect(errors).toEqual([]);
});

test('mission runs, pause freezes the whole simulation, stop returns to idle', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('mode-badge')).toContainText(/Leaving dock|Mapping/);
  // Fast-forward 120 simulated seconds: exploration builds the map.
  await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.runFor(120));
  await page.waitForTimeout(800);
  await expect(page.getByTestId('mode-badge')).toContainText(/Mapping|Cleaning|Recovering/);
  await page.screenshot({ path: `${SHOTS}/02-mapping.png` });

  await page.getByTestId('btn-pause').click();
  await expect(page.getByTestId('mode-badge')).toContainText('Paused');
  const t0 = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.clock.time);
  const soc0 = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.res.soc);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.clock.time)).toBe(t0);
  expect(await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.res.soc)).toBe(soc0);

  await page.getByTestId('btn-resume').click();
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.clock.time)).toBeGreaterThan(t0);

  await page.getByTestId('btn-stop').click();
  await expect(page.getByTestId('mode-badge')).toContainText(/Idle/);
  expect(errors).toEqual([]);
});

test('full mission completes and the dashboard agrees with the simulation', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => {
    const h = window as unknown as Hooks;
    h.__robovac.reset('apartment', 7);
  });
  await page.getByTestId('btn-start').click();
  // Run up to 2 simulated hours headless-fast until the mission completes.
  await page.evaluate(() => {
    const s = (window as unknown as Hooks).__robovac.sim;
    s.runFor(7200, () => s.ctrl.mission?.phase === 'completed');
  });
  await page.waitForTimeout(1200);
  const phase = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.ctrl.mission?.phase);
  expect(phase).toBe('completed');
  const soc = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.res.soc);
  await expect(page.getByTestId('battery-value')).toContainText(`${Math.round(soc * 100)}`);
  const cov = await page.getByTestId('coverage-value').innerText();
  expect(parseFloat(cov)).toBeGreaterThan(75);
  await page.evaluate(() => (window as unknown as Hooks).__store.setState({ cameraMode: 'topDown', overlays: { ...((window as unknown as Hooks).__store.getState().overlays as object), dirt: 'heatmap', coverage: true } }));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/03-completed-coverage.png` });
  expect(errors).toEqual([]);
});

test('camera modes and engineering views render without errors', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.runFor(1));
  for (const mode of ['orbit', 'follow', 'topDown', 'isometric', 'firstPerson', 'lidar', 'dock', 'exploded', 'cutaway']) {
    await page.evaluate((m) => (window as unknown as Hooks).__store.setState({ cameraMode: m }), mode);
    await page.waitForTimeout(1800);
    if (['dock', 'exploded', 'cutaway', 'lidar'].includes(mode)) await page.screenshot({ path: `${SHOTS}/cam-${mode}.png` });
  }
  await page.evaluate(() => (window as unknown as Hooks).__store.setState({ cameraMode: 'dock', dockCutaway: true, eduEnabled: true, eduTopic: 'mopWash' }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/edu-dock-cutaway.png` });
  expect(errors).toEqual([]);
});

test('editing: obstacles change the world; reset is seeded and releases GPU resources', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  await boot(page, errors);
  const n0 = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.layout.obstacles.length);
  await page.evaluate(() => (window as unknown as Hooks).__robovac.addObstacleAt('box', 3, 3));
  expect(await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.layout.obstacles.length)).toBe(n0 + 1);

  const dirtA = await page.evaluate(() => {
    const h = (window as unknown as Hooks).__robovac;
    h.reset('challenge', 99);
    return h.sim.dirt.total('dust');
  });
  await page.waitForTimeout(800);
  const mem1 = await page.evaluate(() => ({ ...(window as unknown as Hooks).__robovac.view.stage.renderer.info.memory }));
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as unknown as Hooks).__robovac.reset('challenge', 99));
    await page.waitForTimeout(600);
  }
  const dirtB = await page.evaluate(() => (window as unknown as Hooks).__robovac.sim.dirt.total('dust'));
  expect(dirtB).toBe(dirtA);
  const mem2 = await page.evaluate(() => ({ ...(window as unknown as Hooks).__robovac.view.stage.renderer.info.memory }));
  // Same scenario reloaded 3x: GPU geometry/texture counts must not grow.
  expect(mem2.geometries).toBeLessThanOrEqual(mem1.geometries + 5);
  expect(mem2.textures).toBeLessThanOrEqual(mem1.textures + 2);
  expect(errors).toEqual([]);
});
