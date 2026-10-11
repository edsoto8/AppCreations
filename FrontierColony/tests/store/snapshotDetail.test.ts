import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_GAME_OPTIONS, applyCommand, canPlaceBuilding, createGame, stepGame, type GameState } from '../../src/sim';
import { buildBuildingDetail, buildHudSnapshot, buildSettlerDetail, computeNetRates } from '../../src/store';

const newState = (): GameState => createGame(DEFAULT_NEW_GAME_OPTIONS);

describe('settler summary and detail', () => {
  it('keeps the roster summary light and puts the heavy fields in the detail only', () => {
    const state = newState();
    const snap = buildHudSnapshot(state);
    const summary = snap.settlers[0]! as unknown as Record<string, unknown>;
    expect(summary).not.toHaveProperty('skills');
    expect(summary).not.toHaveProperty('moodlets');
    expect(summary).not.toHaveProperty('xp');
    expect(summary).toMatchObject({ name: state.settlers[0]!.name, hasTool: false, sick: false, dehydrated: false });
    expect(snap.selectedSettler).toBeNull();
    expect(snap.selectedBuilding).toBeNull();
  });

  it('builds the selected settler detail only for the selection', () => {
    const state = newState();
    const target = state.settlers[2]!;
    const snap = buildHudSnapshot(state, { kind: 'settler', id: target.id });
    expect(snap.selectedSettler).toMatchObject({ id: target.id, name: target.name, skills: target.skills, xp: target.xp });
    expect(snap.selectedSettler!.appearance).toEqual(target.appearance);
    expect(snap.selectedBuilding).toBeNull();
  });

  it('resolves home and workplace names, and is null for unknown ids', () => {
    const state = newState();
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    state.settlers[0]!.homeId = town.id;
    const detail = buildSettlerDetail(state, state.settlers[0]!.id)!;
    expect(detail.homeName).toBe('Town Center');
    expect(detail.workplaceName).toBeNull();
    expect(buildSettlerDetail(state, 99999)).toBeNull();
  });

  it('is detached from the state', () => {
    const state = newState();
    const s = state.settlers[0]!;
    const detail = buildSettlerDetail(state, s.id)!;
    const before = detail.skills.farming;
    s.skills.farming += 3;
    s.moodlets.push({ id: 'hungry', value: -8, hoursLeft: null });
    expect(detail.skills.farming).toBe(before);
    expect(detail.moodlets).toHaveLength(0);
    expect(detail.pos).not.toBe(s.pos);
    expect(detail.activity).not.toBe(s.activity);
  });
});

describe('building detail', () => {
  it('derives workers and residents from the settlers and names them', () => {
    const state = newState();
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    for (const st of state.settlers) st.homeId = null;
    state.settlers[0]!.homeId = town.id;
    state.settlers[1]!.homeId = town.id;
    state.settlers[1]!.workplaceId = town.id;
    const detail = buildBuildingDetail(state, town.id)!;
    expect(detail.residents.map((r) => r.name)).toEqual([state.settlers[0]!.name, state.settlers[1]!.name]);
    expect(detail.workers.map((w) => w.id)).toEqual([state.settlers[1]!.id]);
    const snap = buildHudSnapshot(state);
    expect(snap.buildings.find((b) => b.id === town.id)!.residentIds).toEqual(detail.residents.map((r) => r.id));
    expect(buildBuildingDetail(state, 424242)).toBeNull();
  });

  it('reports construction progress and delivered materials for a new site', () => {
    const state = newState();
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    let placed: number | null = null;
    for (let r = 3; r < 12 && placed === null; r++) {
      for (let dx = -r; dx <= r && placed === null; dx++) {
        const x = town.origin.x + dx;
        const y = town.origin.y + r;
        if (!canPlaceBuilding(state, 'house', x, y).ok) continue;
        const res = applyCommand(state, { type: 'placeBuilding', buildingType: 'house', x, y });
        if (res.ok) placed = res.entityId;
      }
    }
    expect(placed).not.toBeNull();
    const snap = buildHudSnapshot(state, { kind: 'building', id: placed! });
    const detail = snap.selectedBuilding!;
    expect(detail.status).toBe('construction');
    expect(detail.construction).toMatchObject({ kind: 'new', progress: 0 });
    expect(detail.construction!.required.wood).toBe(30);
    expect(detail.construction!.delivered.wood).toBeLessThanOrEqual(detail.construction!.required.wood);
    for (let i = 0; i < 20; i++) stepGame(state);
    // The earlier detail does not change when the state does.
    expect(detail.construction!.progress).toBe(0);
  });

  it('has no construction block for a finished building', () => {
    const state = newState();
    const town = state.buildings.find((b) => b.type === 'townCenter')!;
    expect(buildBuildingDetail(state, town.id)!.construction).toBeNull();
  });
});

describe('computeNetRates', () => {
  it('is zero until a full hour of history exists', () => {
    const state = newState();
    state.time.timeOfDay = 6.5;
    expect(Object.values(computeNetRates(state)).every((v) => v === 0)).toBe(true);
  });

  it('scales produced minus consumed over the window to a per-day figure', () => {
    const state = newState();
    state.time.timeOfDay = 8; // no partial hour
    const zero = { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
    state.stats.history = Array.from({ length: 4 }, (_, i) => ({
      tick: i * 450,
      day: 1,
      timeOfDay: 6 + i,
      stock: { ...zero },
      population: 5,
      produced: { ...zero, wood: 6 },
      consumed: { ...zero, food: 2 },
    }));
    const rates = computeNetRates(state);
    expect(rates.wood).toBeCloseTo(144, 5); // 6 per hour over the window => 144/day
    expect(rates.food).toBeCloseTo(-48, 5);
    expect(rates.stone).toBe(0);
  });

  it('ignores one-off spending on construction', () => {
    const state = newState();
    state.time.timeOfDay = 7;
    const zero = { wood: 0, stone: 0, food: 0, water: 0, tools: 0 };
    state.stats.history = [{ tick: 0, day: 1, timeOfDay: 6, stock: { ...zero }, population: 5, produced: { ...zero }, consumed: { ...zero } }];
    state.colony.stock.wood -= 60; // placing buildings lowers the stock but is not "consumed"
    expect(computeNetRates(state).wood).toBe(0);
  });
});
