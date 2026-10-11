/**
 * QA: applyCommand must never throw on junk input, and a rejected command must leave the state unchanged.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame, validateGameState, type GameState, type PlayerCommand } from '../../src/sim';

const JUNK: unknown[] = [
  undefined,
  null,
  0,
  -1,
  NaN,
  'placeBuilding',
  [],
  [{ type: 'placeBuilding' }],
  {},
  Object.create(null),
  { type: 'nope' },
  { type: 42 },
  { type: null },
  { type: 'placeBuilding' },
  { type: 'placeBuilding', buildingType: 'house' },
  { type: 'placeBuilding', buildingType: 'house', x: 'three', y: 0 },
  { type: 'placeBuilding', buildingType: 'house', x: NaN, y: 0 },
  { type: 'placeBuilding', buildingType: 'house', x: Infinity, y: -Infinity },
  { type: 'placeBuilding', buildingType: 'house', x: 1.5, y: 2.5 },
  { type: 'placeBuilding', buildingType: 'house', x: 1e12, y: 1e12 },
  { type: 'placeBuilding', buildingType: 'house', x: -9999, y: -9999 },
  { type: 'placeBuilding', buildingType: 'castle', x: 3, y: 3 },
  { type: 'placeBuilding', buildingType: 'townCenter', x: 3, y: 3 },
  { type: 'placeBuilding', buildingType: '__proto__', x: 3, y: 3 },
  { type: 'placeBuilding', buildingType: 'constructor', x: 3, y: 3 },
  { type: 'placeBuilding', buildingType: undefined, x: 3, y: 3 },
  { type: 'cancelBuilding' },
  { type: 'cancelBuilding', buildingId: 'abc' },
  { type: 'cancelBuilding', buildingId: -5 },
  { type: 'cancelBuilding', buildingId: 999_999 },
  { type: 'cancelBuilding', buildingId: NaN },
  { type: 'demolishBuilding', buildingId: NaN },
  { type: 'demolishBuilding', buildingId: 1 },
  { type: 'demolishBuilding', buildingId: 0 },
  { type: 'setPriority' },
  { type: 'setPriority', category: 'nope', level: 2 },
  { type: 'setPriority', category: 'farming', level: 9 },
  { type: 'setPriority', category: 'farming', level: NaN },
  { type: 'setPriority', category: 'farming', level: '2' },
  { type: 'setPriority', category: '__proto__', level: 1 },
  { type: 'renameColony' },
  { type: 'renameColony', name: 42 },
  { type: 'renameColony', name: null },
  { type: 'renameColony', name: '' },
  { type: 'renameColony', name: '   ' },
  { type: 'renameColony', name: 'x'.repeat(100_000) },
  { type: 'renameColony', name: '<script>alert(1)</script>' },
  { type: 'resolveEvent' },
  { type: 'resolveEvent', eventId: NaN, accept: true },
  { type: 'resolveEvent', eventId: 12345, accept: 'yes' },
  { type: 'resolveEvent', eventId: -1, accept: false },
  { type: 'acknowledgeVictory' },
  { type: 'acknowledgeVictory', extra: { nested: [1, 2, 3] } },
  { type: 'placeBuilding', buildingType: 'house', x: 3, y: 3, __proto__: { polluted: true } },
];

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

describe('applyCommand with junk input', () => {
  it('never throws, and a rejected command leaves the state unchanged', () => {
    const state = createGame({ seed: 'qa-junk', preset: 'continent', mapSize: 'small', colonyName: 'Junk', difficulty: 'normal' });
    for (let i = 0; i < 200; i++) stepGame(state);

    const failures: string[] = [];
    JUNK.forEach((junk, i) => {
      const before = snapshot(state);
      let result: ReturnType<typeof applyCommand> | undefined;
      try {
        result = applyCommand(state, junk as PlayerCommand);
      } catch (err) {
        failures.push(`junk #${i} ${JSON.stringify(junk)?.slice(0, 80)} threw: ${(err as Error).message}`);
        return;
      }
      if (!result || typeof result.ok !== 'boolean') {
        failures.push(`junk #${i} returned no CommandResult`);
        return;
      }
      if (!result.ok) {
        if (typeof result.message !== 'string' || typeof result.error !== 'string') failures.push(`junk #${i} error result has no message`);
        if (snapshot(state) !== before) failures.push(`junk #${i} was rejected but changed the state`);
      }
    });
    expect(failures).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // The game keeps running afterwards.
    for (let i = 0; i < 50; i++) stepGame(state);
    expect(validateGameState(state).ok).toBe(true);
  });

  it('rejects every junk command that is not a real command (none may succeed)', () => {
    const state = createGame({ seed: 'qa-junk-2', preset: 'archipelago', mapSize: 'small', colonyName: 'Junk', difficulty: 'normal' });
    const accepted = JUNK.map((junk, i) => ({ i, junk, result: applyCommand(state, junk as PlayerCommand) })).filter(
      (r) => r.result.ok,
    );
    // renameColony with a long name and a 'placeBuilding' at 1.5/2.5 are the only ones a sane sim might
    // accept after sanitising; report anything else so the reviewer can look at it.
    expect(accepted.map((r) => `#${r.i} ${JSON.stringify(r.junk)?.slice(0, 80)}`)).toEqual([]);
  });
});
