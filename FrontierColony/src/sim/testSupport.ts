/**
 * Test support: invariants that must hold for every valid GameState at any tick.
 * Not part of the public API (import it directly from tests). Throws an Error naming the first
 * violated invariant.
 */
import { getStorageCapacity } from './queries';
import { TERRAIN_WALKABLE } from './grid';
import { validateGameState } from './validate';
import type { ActivityKind, GameState } from './types';

/** Allowed label shapes per activity kind (the label must always describe the kind). */
const LABEL_PATTERNS: Record<ActivityKind, RegExp> = {
  idle: /^Idle$/,
  walking: /^(Walking to |Leaving the colony)/,
  carrying: /^Hauling |^Supplying /,
  chopping: /^Chopping wood$/,
  mining: /^Quarrying stone$/,
  farming: /^Tending crops$/,
  building: /^(Building|Repairing) /,
  crafting: /^Crafting tools$/,
  fetchingWater: /^Drawing water$/,
  eating: /^(Eating|Drinking) at /,
  sleeping: /^Sleeping (in |by )/,
  resting: /^Resting \((hurt|sick)\)$/,
  socializing: /^Chatting at the campfire$/,
  wandering: /^(Wandering|Sulking)$/,
};

function fail(message: string): never {
  throw new Error(`Invariant violated: ${message}`);
}

export function assertInvariants(state: GameState): void {
  const valid = validateGameState(state);
  if (!valid.ok) fail(`validateGameState: ${valid.error}`);

  const world = state.world;
  const cap = getStorageCapacity(state);
  for (const key of Object.keys(state.colony.stock) as (keyof typeof state.colony.stock)[]) {
    const v = state.colony.stock[key];
    if (!Number.isFinite(v) || v < 0) fail(`stock.${key} = ${v}`);
    if (v > cap + 1e-6 && v > 1000) fail(`stock.${key} = ${v} is far above capacity ${cap}`);
  }

  const names = new Set<string>();
  for (const s of state.settlers) {
    const tx = Math.floor(s.pos.x);
    const ty = Math.floor(s.pos.y);
    const i = ty * world.width + tx;
    if (TERRAIN_WALKABLE[world.terrain[i] as number] !== true) fail(`${s.name} stands on unwalkable terrain at ${tx},${ty}`);
    if (world.building[i] !== 0) fail(`${s.name} stands inside building ${world.building[i]} at ${tx},${ty}`);
    if (!LABEL_PATTERNS[s.activity.kind].test(s.activity.label)) {
      fail(`${s.name}: label "${s.activity.label}" does not match kind ${s.activity.kind}`);
    }
    if (s.carrying && s.carrying.amount <= 0) fail(`${s.name} carries ${s.carrying.amount}`);
    if (names.has(s.name)) fail(`duplicate settler name ${s.name}`);
    names.add(s.name);
    if (s.task.kind === 'idle' && s.path.length > 0) fail(`${s.name} is idle but has a path`);
    if (!state.colony.usedNames.includes(s.name)) fail(`${s.name} is missing from colony.usedNames`);
  }
  for (const g of state.colony.graveyard) {
    if (state.settlers.some((s) => s.id === g.id)) fail(`${g.name} is both dead and alive`);
  }
}
