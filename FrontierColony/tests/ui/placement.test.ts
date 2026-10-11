import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, DEFAULT_NEW_GAME_OPTIONS, createGame } from '../../src/sim';
import { checkPlacement, missingResources, placementHint, placementRule, unlockText } from '../../src/ui/lib/placement';
import { buildingStatus, demolishRefund } from '../../src/ui/lib/buildingInfo';
import { buildBuildingDetail } from '../../src/store';
import { describeTile } from '../../src/ui/lib/tileInfo';
import { buildHudSnapshot } from '../../src/store';

describe('placement hint text', () => {
  it('asks for a position, then confirms or explains', () => {
    expect(placementHint('Farm', null, null)).toEqual({ tone: 'neutral', text: 'Move the cursor over the map.' });
    expect(placementHint('Farm', { x: 1, y: 1 }, { ok: true, message: null })).toEqual({ tone: 'good', text: 'Click to place the Farm.' });
    expect(placementHint('Farm', { x: 1, y: 1 }, { ok: false, message: 'Cannot build a Farm on forest.' })).toEqual({
      tone: 'bad',
      text: 'Cannot build a Farm on forest.',
    });
    expect(placementHint('Farm', { x: 1, y: 1 }, { ok: false, message: null }).text).toBe('Cannot build here.');
  });

  it('uses the live sim validation for the hovered tile', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    // Directly on the town center: blocked.
    const blocked = checkPlacement(state, 'house', { x: town.origin.x, y: town.origin.y });
    expect(blocked.tone).toBe('bad');
    expect(blocked.text).toMatch(/already built|Settlers could not reach|Cannot/);
    // Outside the map.
    expect(checkPlacement(state, 'house', { x: -5, y: -5 })).toEqual({ tone: 'bad', text: 'Outside the map.' });
    // Unaffordable.
    state.colony.stock.wood = 0;
    let reason = '';
    for (let r = 3; r < 12 && !reason; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const h = checkPlacement(state, 'house', { x: town.origin.x + dx, y: town.origin.y + r });
        if (/Not enough resources/.test(h.text)) reason = h.text;
      }
    }
    expect(reason).toBe('Not enough resources for a House.');
    // Locked building.
    expect(checkPlacement(state, 'workshop', { x: town.origin.x + 5, y: town.origin.y }).text).toMatch(/not unlocked|Cannot|Not|Needs|Settlers/);
  });
});

describe('catalogue helpers', () => {
  it('lists missing resources', () => {
    expect(missingResources({ wood: 10, stone: 50, food: 0, water: 0, tools: 0 }, { wood: 30, stone: 10 })).toEqual({ wood: 20 });
    expect(missingResources({ wood: 100, stone: 100, food: 0, water: 0, tools: 0 }, { wood: 30 })).toEqual({});
  });

  it('describes placement rules in plain language', () => {
    expect(placementRule('farm')).toBe('Grassland only.');
    expect(placementRule('lumberCamp')).toMatch(/needs 8 forest tiles within 6/);
    expect(placementRule('mine')).toMatch(/hills or mountain tiles within 4/i);
    expect(placementRule('house')).toMatch(/^Any dry, flat land|Grassland or Sand only/);
  });

  it('explains how to unlock locked buildings', () => {
    expect(unlockText('house')).toBeNull();
    expect(unlockText('storage')).toMatch(/Lay the Foundations/);
    expect(unlockText('workshop')).toMatch(/Stone and Timber/);
  });

  it('halves the cost for the demolish refund, flooring each resource', () => {
    expect(demolishRefund(BUILDING_DEFS.house.cost)).toEqual({ wood: 15, stone: 5 });
    expect(demolishRefund({ wood: 5 })).toEqual({ wood: 2 });
    expect(demolishRefund({})).toEqual({});
  });
});

describe('building status line', () => {
  it('describes sites, workers, output and winter fallow', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    const base = { ...buildBuildingDetail(state, town.id)!, residents: [] as { id: number; name: string }[] };
    expect(buildingStatus(base, 0, 'spring')).toEqual({ text: 'Housing 0/4', tone: 'good' });

    const farm = {
      ...base,
      type: 'farm' as const,
      workers: [] as { id: number; name: string }[],
      output: { wood: 0, stone: 0, food: 0, water: 0, tools: 0 },
    };
    expect(buildingStatus(farm, 30, 'spring')).toEqual({ text: 'No workers', tone: 'warn' });
    expect(buildingStatus({ ...farm, workers: [{ id: 1, name: 'A' }] }, 30, 'spring')).toEqual({ text: 'Working (1/2)', tone: 'good' });
    expect(buildingStatus({ ...farm, workers: [{ id: 1, name: 'A' }] }, 30, 'winter').text).toBe('Fallow (winter)');
    expect(buildingStatus({ ...farm, output: { ...farm.output, food: 30 } }, 30, 'spring').text).toBe('Output full: needs hauling');

    const zero = { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
    const site = {
      ...farm,
      status: 'construction' as const,
      construction: { kind: 'new' as const, progress: 0.3, required: { ...zero, wood: 20 }, delivered: { ...zero, wood: 5 } },
    };
    expect(buildingStatus(site, 30, 'spring').text).toBe('Under construction: waiting for materials');
    expect(buildingStatus({ ...site, construction: { ...site.construction, delivered: { ...zero, wood: 20 } } }, 30, 'spring').text).toBe('Under construction');
    expect(buildingStatus({ ...site, construction: { ...site.construction, kind: 'repair' as const } }, 30, 'spring').text).toBe('Being repaired');
  });
});

describe('describeTile', () => {
  it('reports terrain, building and settlers on the tile', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const snap = buildHudSnapshot(state);
    const town = snap.buildings.find((b) => b.name === 'Town Center')!;
    const onTown = describeTile(state, town.origin, snap.settlers, snap.buildings)!;
    expect(onTown.building).toBe('Town Center');
    const s = snap.settlers[0]!;
    const under = describeTile(state, { x: Math.floor(s.pos.x), y: Math.floor(s.pos.y) }, snap.settlers, snap.buildings)!;
    expect(under.settlers.some((t) => t.startsWith(s.name))).toBe(true);
    expect(describeTile(state, { x: -1, y: 0 }, snap.settlers, snap.buildings)).toBeNull();
  });

  it('reports trees left on forest tiles', () => {
    const state = createGame(DEFAULT_NEW_GAME_OPTIONS);
    const w = state.world;
    const idx = w.terrain.findIndex((t, i) => t === 4 && (w.resource[i] ?? 0) > 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    const card = describeTile(state, { x: idx % w.width, y: Math.floor(idx / w.width) }, [], [])!;
    expect(card.terrain).toBe('Forest');
    expect(card.resource).toMatch(/^Trees left: \d+$/);
  });
});
