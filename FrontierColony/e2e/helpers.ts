/**
 * Helpers for driving Frontier Colony in e2e tests. Everything that runs inside the page goes
 * through `window.__frontierColony` (the GameController debug handle, see CLAUDE.md). window.d.ts
 * only types two of its methods, so the page-side code casts to the local `DebugWindow` type.
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export interface Vec2 {
  x: number;
  y: number;
}

export interface SettlerView {
  id: number;
  name: string;
  pos: Vec2;
  needs: { hunger: number; energy: number; happiness: number; health: number };
  activity: { kind: string; label: string };
}

export interface BuildingView {
  id: number;
  type: string;
  origin: Vec2;
  footprint: { w: number; h: number };
  status: 'construction' | 'complete';
}

export interface GameView {
  tick: number;
  day: number;
  timeOfDay: number;
  colonyName: string;
  seed: string;
  preset: string;
  settlers: SettlerView[];
  buildings: BuildingView[];
  terrain: number[];
  elevation: number[];
  width: number;
  height: number;
}

/** Page-side shape of the debug handle (only what these tests use). */
export interface DebugWindow {
  __frontierColony: {
    getState(): {
      time: { tick: number; day: number; timeOfDay: number };
      colony: { name: string };
      meta: { seed: string; preset: string };
      settlers: SettlerView[];
      buildings: BuildingView[];
      world: { width: number; height: number; terrain: number[]; elevation: number[] };
    };
    advanceTicks(n: number): void;
    setPaused(paused: boolean): void;
    isFaulted(): boolean;
  };
}

/** Tile geometry from src/shared/iso.ts (copied: the e2e project must not compile src/). */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const ELEVATION_STEP = 12;

/** Open the game with `/?quickstart` plus optional overrides, and wait until the HUD is up. */
export async function gotoQuickstart(page: Page, params: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ quickstart: '', ...params }).toString();
  await page.goto(`/?${query}`);
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('clock')).toContainText('Day', { timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as unknown as Partial<DebugWindow>).__frontierColony), null, { timeout: 60_000 });
}

/** Read the parts of the state the e2e tests care about. */
export async function readGame(page: Page): Promise<GameView> {
  return page.evaluate(() => {
    const s = (window as unknown as DebugWindow).__frontierColony.getState();
    return {
      tick: s.time.tick,
      day: s.time.day,
      timeOfDay: s.time.timeOfDay,
      colonyName: s.colony.name,
      seed: s.meta.seed,
      preset: s.meta.preset,
      settlers: s.settlers.map((st) => ({
        id: st.id,
        name: st.name,
        pos: { x: st.pos.x, y: st.pos.y },
        needs: { ...st.needs },
        activity: { kind: st.activity.kind, label: st.activity.label },
      })),
      buildings: s.buildings.map((b) => ({
        id: b.id,
        type: b.type,
        origin: { x: b.origin.x, y: b.origin.y },
        footprint: { w: b.footprint.w, h: b.footprint.h },
        status: b.status,
      })),
      terrain: s.world.terrain.slice(),
      elevation: s.world.elevation.slice(),
      width: s.world.width,
      height: s.world.height,
    };
  });
}

export async function readTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as DebugWindow).__frontierColony.getState().time.tick);
}

/** Run `ticks` sim ticks synchronously through the debug handle (no real-time waiting). */
export async function advance(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => (window as unknown as DebugWindow).__frontierColony.advanceTicks(n), ticks);
}

/**
 * Page coordinates of the centre of tile (x, y), assuming the camera is at its opening position
 * (the town centre, 10 px above centre, zoom 1; see Renderer.setWorld). Used to aim real mouse clicks.
 */
export function tileScreenPoint(canvas: { x: number; y: number; width: number; height: number }, game: GameView, x: number, y: number): Vec2 {
  const tc = game.buildings.find((b) => b.type === 'townCenter');
  const cx0 = tc ? tc.origin.x + tc.footprint.w / 2 : game.width / 2;
  const cy0 = tc ? tc.origin.y + tc.footprint.h / 2 : game.height / 2;
  const project = (tx: number, ty: number, elev: number) => ({
    x: (tx - ty) * (TILE_WIDTH / 2),
    y: (tx + ty) * (TILE_HEIGHT / 2) - elev * ELEVATION_STEP,
  });
  const camElev = game.elevation[Math.floor(cy0) * game.width + Math.floor(cx0)] ?? 0;
  const cam = project(cx0, cy0, camElev);
  const elev = game.elevation[y * game.width + x] ?? 0;
  const p = project(x + 0.5, y + 0.5, elev);
  return {
    x: canvas.x + canvas.width / 2 + (p.x - cam.x),
    y: canvas.y + canvas.height / 2 + (p.y - (cam.y - 10)),
  };
}

/** FNV-1a over a numeric array: a stable fingerprint for comparing terrain between page loads. */
export function fingerprint(values: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Resolve after `n` animation frames have run in the page (frame-driven, no wall-clock guess). */
export async function waitFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }, n);
}

/**
 * Ticks the sim gained and the page time elapsed, sampled inside the page until at least `minMs`
 * of page time has passed. Tick rate = ticks / ms, so slow frames do not skew the comparison.
 */
export async function sampleTicks(page: Page, minMs: number): Promise<{ ticks: number; ms: number }> {
  return page.evaluate(async (ms) => {
    const h = (window as unknown as DebugWindow).__frontierColony;
    const t0 = h.getState().time.tick;
    const p0 = performance.now();
    while (performance.now() - p0 < ms) await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { ticks: h.getState().time.tick - t0, ms: performance.now() - p0 };
  }, minMs);
}

/** Current pressed state of a button by test id. */
export async function isPressed(page: Page, testId: string): Promise<boolean> {
  return (await page.getByTestId(testId).getAttribute('aria-pressed')) === 'true';
}

/**
 * TEST SETUP ONLY: no player command creates a trader decision on demand (decisions come from
 * random events after day 3), so the test writes a valid PendingDecision into the live state.
 * The decision is then resolved through the real UI buttons. Advances one tick so the HUD
 * snapshot is republished (snapshots only publish after ticks).
 */
export async function injectTraderDecision(page: Page, offer: { giveWood: number; getStone: number }): Promise<void> {
  await page.evaluate((payload) => {
    const h = (window as unknown as DebugWindow).__frontierColony;
    const s = h.getState() as unknown as { nextLogId: number; pendingDecisions: unknown[] };
    const eventId = s.nextLogId;
    s.nextLogId += 1;
    s.pendingDecisions.push({ kind: 'traderVisit', eventId, hoursLeft: 12, windowHours: 12, payload });
    h.advanceTicks(1);
  }, offer);
}

/**
 * TEST SETUP ONLY: there is no command that ends a colony, so the test empties the settler list
 * in the live state. The sim then declares the colony lost on its next tick (settlerSim.ts).
 */
export async function forceColonyLost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as DebugWindow).__frontierColony;
    (h.getState() as unknown as { settlers: unknown[] }).settlers.length = 0;
    h.advanceTicks(1);
  });
}
export const GAME_HOURS_PER_TICK = (24 * 0.1) / 180;

/**
 * Place a house with real clicks: Build panel, House, then a click on the first clear buildable tile
 * near the town centre. Returns the new construction site's id and origin.
 */
export async function placeHouseWithClicks(page: Page): Promise<{ id: number; origin: Vec2 }> {
  const canvas = await page.getByTestId('game-canvas').boundingBox();
  if (!canvas) throw new Error('game canvas has no box');
  await page.getByTestId('tool-build').click();
  await expect(page.getByTestId('build-panel')).toBeVisible();
  await page.getByTestId('build-house').click();
  await expect(page.getByTestId('placement-bar')).toBeVisible();

  const before = await readGame(page);
  const tc = before.buildings.find((b) => b.type === 'townCenter');
  if (!tc) throw new Error('no town centre');
  const cx = Math.floor(tc.origin.x + tc.footprint.w / 2);
  const cy = Math.floor(tc.origin.y + tc.footprint.h / 2);
  const candidates: Vec2[] = [];
  for (let dy = -10; dy <= 10; dy++)
    for (let dx = -10; dx <= 10; dx++) candidates.push({ x: cx + dx, y: cy + dy });
  candidates.sort((a, b) => Math.abs(a.x - cx) + Math.abs(a.y - cy) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));

  for (const c of candidates.slice(0, 80)) {
    if (c.x < 0 || c.y < 0 || c.x >= before.width || c.y >= before.height) continue;
    const p = tileScreenPoint(canvas, before, c.x, c.y);
    if (p.x < canvas.x + 420 || p.x > canvas.x + canvas.width - 420) continue;
    if (p.y < canvas.y + 120 || p.y > canvas.y + canvas.height - 140) continue;
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    const after = await readGame(page);
    const site = after.buildings.find((b) => b.type === 'house' && !before.buildings.some((o) => o.id === b.id));
    if (site) return { id: site.id, origin: site.origin };
  }
  throw new Error('no click placed a house');
}

/** Screen point on a building's footprint (its origin tile), for clicking it on the map. */
export async function buildingScreenPoint(page: Page, buildingId: number): Promise<Vec2> {
  const canvas = await page.getByTestId('game-canvas').boundingBox();
  if (!canvas) throw new Error('game canvas has no box');
  const game = await readGame(page);
  const b = game.buildings.find((x) => x.id === buildingId);
  if (!b) throw new Error(`building ${buildingId} is gone`);
  return tileScreenPoint(canvas, game, b.origin.x, b.origin.y);
}

/**
 * Open the inspector of a building by clicking its footprint on the map. Building sprites can be
 * overlapped by a neighbour's sprite, so each footprint tile is tried until the inspector shows
 * the expected name. Returns the inspector's name text.
 */
export async function openBuildingInspectorByClick(page: Page, buildingId: number, expectedName: string): Promise<void> {
  const canvas = await page.getByTestId('game-canvas').boundingBox();
  if (!canvas) throw new Error('game canvas has no box');
  const game = await readGame(page);
  const b = game.buildings.find((x) => x.id === buildingId);
  if (!b) throw new Error(`building ${buildingId} is gone`);
  for (let dy = 0; dy < b.footprint.h; dy++)
    for (let dx = 0; dx < b.footprint.w; dx++) {
      const p = tileScreenPoint(canvas, game, b.origin.x + dx, b.origin.y + dy);
      await page.mouse.click(p.x, p.y);
      const inspector = page.getByTestId('building-inspector');
      if (await inspector.isVisible()) {
        const name = (await page.getByTestId('inspector-name').textContent())?.trim();
        if (name === expectedName) return;
        // Wrong building (a neighbour): close the inspector and try the next tile.
        await inspector.getByTestId('panel-close').click();
      }
    }
  throw new Error(`could not open the ${expectedName} inspector by clicking its footprint`);
}
