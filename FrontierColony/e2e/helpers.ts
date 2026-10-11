/**
 * Helpers for driving Frontier Colony in e2e tests. Everything that runs inside the page goes
 * through `window.__frontierColony` (the GameController debug handle, see CLAUDE.md). window.d.ts
 * only types two of its methods, so the page-side code casts to the local `DebugWindow` type.
 */
import { expect, type Page } from '@playwright/test';

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
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect(page.getByTestId('clock')).toContainText('Day');
  await page.waitForFunction(() => Boolean((window as unknown as Partial<DebugWindow>).__frontierColony));
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
