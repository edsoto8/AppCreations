/** The first-game coach-mark tour: steps and the conditions that complete them. Pure. */
import type { BuildingType } from '../../sim';
import type { PanelId } from '../../store';

export interface TourContext {
  buildings: readonly { type: BuildingType }[];
  openPanel: PanelId | null;
  selectionKind: 'settler' | 'building' | 'tile' | null;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** `data-tour` value of the element to highlight, or null for a centred card. */
  target: string | null;
  /** True once the player has done what the step asks. Steps without one are advanced with Next. */
  done: ((ctx: TourContext) => boolean) | null;
  /** Hint shown once the step is done. */
  doneText?: string;
}

const has = (type: BuildingType) => (ctx: TourContext) => ctx.buildings.some((b) => b.type === type);

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the frontier',
    body: 'Your settlers decide what to do on their own: they gather, haul, build, eat and sleep. You decide what gets built and what matters most. This quick tour takes a minute.',
    target: null,
    done: null,
  },
  {
    id: 'farm',
    title: 'Grow some food',
    body: 'Open Build, pick the Farm, then click grassland near the town center. Settlers fetch the wood and raise it for you.',
    target: 'tool-build',
    done: has('farm'),
    doneText: 'A farm is on its way.',
  },
  {
    id: 'well',
    title: 'Dig a well',
    body: 'Settlers drink as well as eat. Choose the Well in the Build panel and place it close to the town center.',
    target: 'tool-build',
    done: has('well'),
    doneText: 'Water is coming.',
  },
  {
    id: 'house',
    title: 'Give everyone a bed',
    body: 'Settlers without a bed sleep outdoors and get unhappy. Place a House. Newcomers only arrive when there is a free bed.',
    target: 'tool-build',
    done: has('house'),
    doneText: 'A roof is going up.',
  },
  {
    id: 'priorities',
    title: 'Say what matters most',
    body: 'Open Priorities. Each job goes from 0 (never) to 3 (first). Raise farming before winter, or lower hauling if you want more builders.',
    target: 'tool-priorities',
    done: (ctx) => ctx.openPanel === 'priorities',
    doneText: 'Try changing a number.',
  },
  {
    id: 'needs',
    title: 'Keep an eye on their needs',
    body: 'Open Settlers and click one. Hunger, energy, mood and health decide how well they work. Warnings at the top tell you when something needs your attention.',
    target: 'tool-settlers',
    done: (ctx) => ctx.selectionKind === 'settler',
    doneText: 'Their needs are on the right.',
  },
  {
    id: 'finish',
    title: 'The colony is yours',
    body: 'Complete objectives to unlock new buildings and reach victory. Press H any time for the guide, or Esc for the menu. Good luck!',
    target: null,
    done: null,
  },
];

export function isStepDone(step: TourStep, ctx: TourContext): boolean {
  return step.done ? step.done(ctx) : false;
}

/** Clamp a step index into the tour. */
export function clampStep(step: number): number {
  return Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.floor(step)));
}
