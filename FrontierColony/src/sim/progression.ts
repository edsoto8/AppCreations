/**
 * Objectives, building unlocks and victory (GAME_DESIGN §11).
 *
 * Objectives are tracked simultaneously. `checkObjectives` is cheap, and runs when a building
 * completes and once per in-game hour; the two time-based ones (`larder`, `winter`) look at the
 * clock. Completing an objective may unlock building types (`BuildingDef.unlockedBy`).
 */
import { BUILDING_DEFS, DAYS_PER_SEASON, OBJECTIVES, OBJECTIVE_TARGETS, VICTORY } from './balance';
import { pushLog } from './stateOps';
import { BUILDING_TYPES, type GameState, type SimEvent } from './types';

function hasCompleted(state: GameState, ...types: string[]): boolean {
  return types.every((t) => state.buildings.some((b) => b.type === t && b.status === 'complete'));
}

/** Evaluate one objective's condition. `newDay` is true on the tick the day changed (for the 00:00 checks). */
function isMet(state: GameState, id: string, newDay: boolean): boolean {
  const pop = state.settlers.length;
  switch (id) {
    case 'roof':
      return hasCompleted(state, 'house');
    case 'bread':
      return hasCompleted(state, 'farm');
    case 'water':
      return hasCompleted(state, 'well');
    case 'foundations':
      return state.stats.buildingsCompleted >= OBJECTIVE_TARGETS.foundationsBuildings;
    case 'timber':
      return hasCompleted(state, 'lumberCamp', 'mine');
    case 'toolmaker':
      return state.progress.toolsCrafted >= OBJECTIVE_TARGETS.toolsCrafted;
    case 'growing':
      return pop >= OBJECTIVE_TARGETS.growingPopulation;
    case 'larder': {
      // At 00:00 on the first day of winter.
      const firstWinterDay = (state.time.day - 1) % (DAYS_PER_SEASON * 4) === DAYS_PER_SEASON * 3;
      return newDay && state.time.season === 'winter' && firstWinterDay && state.colony.stock.food >= pop * OBJECTIVE_TARGETS.larderFoodPerSettler;
    }
    case 'winter':
      return state.time.day >= OBJECTIVE_TARGETS.winterDay && pop >= 1;
    case 'thriving': {
      if (pop < VICTORY.population || !state.progress.objectivesDone.includes(VICTORY.requiresObjective)) return false;
      let happy = 0;
      for (const s of state.settlers) happy += s.needs.happiness;
      return happy / pop >= VICTORY.minAvgHappiness;
    }
    default:
      return false;
  }
}

/** Complete every objective whose condition holds; unlock buildings; trigger victory. */
export function checkObjectives(state: GameState, events: SimEvent[], newDay = false): void {
  for (const objective of OBJECTIVES) {
    if (state.progress.objectivesDone.includes(objective.id)) continue;
    if (!isMet(state, objective.id, newDay)) continue;
    state.progress.objectivesDone.push(objective.id);
    events.push({ type: 'objectiveCompleted', objectiveId: objective.id, message: `Objective complete: ${objective.title}` });
    pushLog(state, 'good', `Objective complete: ${objective.title}.`);
    for (const type of BUILDING_TYPES) {
      if (BUILDING_DEFS[type].unlockedBy === objective.id && !state.progress.unlocked.includes(type)) {
        state.progress.unlocked.push(type);
        events.push({ type: 'buildingUnlocked', buildingType: type });
        pushLog(state, 'good', `${BUILDING_DEFS[type].name} unlocked.`);
      }
    }
    if (objective.id === 'thriving' && !state.progress.victoryAcknowledged && state.outcome.status === 'playing') {
      const reason = `Thriving Frontier: ${VICTORY.population} settlers call ${state.colony.name} home.`;
      state.outcome = { status: 'won', reason, endedTick: state.time.tick };
      events.push({ type: 'gameOver', status: 'won', reason });
      pushLog(state, 'good', reason);
    }
  }
}
