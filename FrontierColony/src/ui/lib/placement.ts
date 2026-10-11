/** Placement hint text for build mode. Pure so it can be tested without a game. */
import {
  BUILDING_DEFS,
  OBJECTIVES,
  TERRAIN_DEFS,
  canPlaceBuilding,
  type BuildingType,
  type GameState,
  type PlacementCheck,
  type ResourceAmounts,
  type ResourceCost,
  RESOURCE_TYPES,
  type TilePos,
} from '../../sim';

export type HintTone = 'neutral' | 'good' | 'bad';

export interface PlacementHint {
  tone: HintTone;
  text: string;
}

/** The line shown in the placement bar for the hovered tile. */
export function placementHint(buildingName: string, hover: TilePos | null, check: Pick<PlacementCheck, 'ok' | 'message'> | null): PlacementHint {
  if (!hover || !check) return { tone: 'neutral', text: 'Move the cursor over the map.' };
  if (check.ok) return { tone: 'good', text: `Click to place the ${buildingName}.` };
  return { tone: 'bad', text: check.message ?? 'Cannot build here.' };
}

/** Run the sim's validation for the current hover tile. Returns plain data only. */
export function checkPlacement(state: Readonly<GameState>, type: BuildingType, tile: TilePos | null): PlacementHint {
  const name = BUILDING_DEFS[type].name;
  if (!tile) return placementHint(name, null, null);
  return placementHint(name, tile, canPlaceBuilding(state as GameState, type, tile.x, tile.y));
}

/** Resources the colony lacks for a cost (empty when affordable). */
export function missingResources(stock: ResourceAmounts, cost: ResourceCost): ResourceCost {
  const missing: ResourceCost = {};
  for (const r of RESOURCE_TYPES) {
    const need = cost[r] ?? 0;
    if (need > stock[r]) missing[r] = Math.ceil(need - stock[r]);
  }
  return missing;
}

/** Plain-language placement rule, e.g. "Grass only" or "Needs 8 forest tiles within 6 tiles". */
export function placementRule(type: BuildingType): string {
  const def = BUILDING_DEFS[type];
  const parts: string[] = [];
  const land = def.allowedTerrain.length;
  if (land > 0 && land <= 2) parts.push(`${def.allowedTerrain.map((t) => TERRAIN_DEFS[t].name).join(' or ')} only`);
  else parts.push('Any dry, flat land');
  if (def.requiresNearby) {
    const names = def.requiresNearby.terrain.map((t) => TERRAIN_DEFS[t].name.toLowerCase()).join(' or ');
    parts.push(`needs ${def.requiresNearby.minCount} ${names} tiles within ${def.requiresNearby.radius}`);
  }
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

export function unlockText(type: BuildingType): string | null {
  const id = BUILDING_DEFS[type].unlockedBy;
  if (id === null) return null;
  const objective = OBJECTIVES.find((o) => o.id === id);
  return objective ? `Complete the objective "${objective.title}": ${objective.description.replace(/\s*Unlocks[^.]*\./, '').trim()}` : `Unlocked by the objective "${id}".`;
}
