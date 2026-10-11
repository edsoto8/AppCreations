/**
 * QA: after a long run (with some player commands), save -> load -> continue must be
 * indistinguishable from never having saved: same state, same events, same outcome.
 */
import { describe, expect, it } from 'vitest';
import { loadFromSlot, createMemoryStorage, saveToSlot } from '../../src/game/save';
import { applyCommand, createGame, stepGame, type GameState, type PlayerCommand, type SimEvent } from '../../src/sim';

function runTicks(state: GameState, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepGame(state));
  return events;
}

describe('save -> load -> continue equivalence', () => {
  for (const preset of ['continent', 'riverValley'] as const) {
    it(`matches an uninterrupted run after two in-game days (${preset})`, () => {
      const original = createGame({ seed: `qa-equiv-${preset}`, preset, mapSize: 'small', colonyName: 'Equiv', difficulty: 'relaxed' });
      runTicks(original, 1000);
      // A few commands so the save holds a construction site and a changed priority.
      const commands: PlayerCommand[] = [
        { type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 },
        { type: 'setPriority', category: 'farming', level: 3 },
      ];
      for (const cmd of commands) applyCommand(original, cmd);
      // Find a placeable spot near the town centre so the command above is not the only building.
      const tc = original.buildings.find((b) => b.type === 'townCenter');
      if (tc) {
        for (let dy = -6; dy <= 6; dy++)
          for (let dx = -6; dx <= 6; dx++) {
            applyCommand(original, { type: 'placeBuilding', buildingType: 'farm', x: tc.origin.x + dx, y: tc.origin.y + dy });
          }
      }
      runTicks(original, 600);

      const storage = createMemoryStorage();
      const saved = saveToSlot(storage, 'slot1', original, new Date('2026-06-01T12:00:00Z'));
      expect(saved.ok).toBe(true);
      const loaded = loadFromSlot(storage, 'slot1');
      if (!loaded.ok) throw new Error(loaded.error);
      const restored = loaded.state;

      expect(restored).toEqual(original);

      const eventsA = runTicks(original, 1800);
      const eventsB = runTicks(restored, 1800);
      expect(eventsB).toEqual(eventsA);
      expect(restored).toEqual(original);
      expect(restored.time.tick).toBe(original.time.tick);
      expect(restored.time.day).toBe(original.time.day);
    }, 120_000);
  }
});
