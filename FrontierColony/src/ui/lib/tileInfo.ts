/** Plain-data description of a map tile for the hover card. Pure; reads the state, returns no references. */
import { Terrain, TERRAIN_DEFS, getTile, type GameState, type TilePos } from '../../sim';
import type { BuildingSummary, SettlerSummary } from '../../store';

export interface TileCard {
  terrain: string;
  /** "Trees left: 12" / "Stone left: 40", or null. */
  resource: string | null;
  elevation: number;
  building: string | null;
  buildingStatus: string | null;
  settlers: string[];
}

export function describeTile(
  state: Readonly<GameState>,
  tile: TilePos,
  settlers: readonly Pick<SettlerSummary, 'name' | 'pos' | 'activity'>[],
  buildings: readonly Pick<BuildingSummary, 'id' | 'name' | 'status' | 'constructionProgress'>[],
): TileCard | null {
  const info = getTile(state as GameState, tile.x, tile.y);
  if (!info) return null;
  let resource: string | null = null;
  if (info.resource > 0) {
    if (info.terrain === Terrain.Forest) resource = `Trees left: ${info.resource}`;
    else if (info.terrain === Terrain.Hills || info.terrain === Terrain.Mountain) resource = `Stone left: ${info.resource}`;
    else resource = `Resource: ${info.resource}`;
  }
  const b = info.buildingId === null ? null : (buildings.find((x) => x.id === info.buildingId) ?? null);
  return {
    terrain: TERRAIN_DEFS[info.terrain].name,
    resource,
    elevation: info.elevation,
    building: b ? b.name : null,
    buildingStatus: b ? (b.status === 'construction' ? `Under construction (${Math.round(b.constructionProgress * 100)}%)` : null) : null,
    settlers: settlers.filter((s) => Math.floor(s.pos.x) === tile.x && Math.floor(s.pos.y) === tile.y).map((s) => `${s.name}: ${s.activity.label}`),
  };
}
