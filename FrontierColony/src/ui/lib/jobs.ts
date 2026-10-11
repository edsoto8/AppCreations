/** Job categories shown in the Priorities panel: labels, descriptions, and which activities count as doing them. */
import { JOB_CATEGORIES, type ActivityKind, type JobCategory, type PriorityLevel } from '../../sim';
import type { IconName } from '../components/Icon';

export interface JobInfo {
  label: string;
  icon: IconName;
  description: string;
}

export const JOB_INFO: Record<JobCategory, JobInfo> = {
  building: { label: 'Construction', icon: 'build', description: 'Raise new buildings and repair damaged ones.' },
  farming: { label: 'Farming', icon: 'food', description: 'Tend the fields. Fields lie fallow in winter.' },
  woodcutting: { label: 'Woodcutting', icon: 'wood', description: 'Fell trees near lumber camps for wood.' },
  mining: { label: 'Mining', icon: 'stone', description: 'Quarry stone from hills and mountains.' },
  hauling: { label: 'Hauling', icon: 'cart', description: 'Carry goods between buildings and the stockpile.' },
  water: { label: 'Water', icon: 'water', description: 'Draw water at wells.' },
  crafting: { label: 'Crafting', icon: 'tools', description: 'Make tools at the workshop.' },
};

export const PRIORITY_LEVELS: readonly PriorityLevel[] = [0, 1, 2, 3];
export const PRIORITY_LABEL: Record<PriorityLevel, string> = { 0: 'Off', 1: 'Low', 2: 'Normal', 3: 'High' };
export const PRIORITY_HINT: Record<PriorityLevel, string> = {
  0: 'Off: settlers never take this job.',
  1: 'Low: only when nothing more important needs doing.',
  2: 'Normal: the default balance.',
  3: 'High: settlers do this first.',
};
export const PRIORITY_TOOLTIP =
  'Priority 0 = never, 1 = low, 2 = normal, 3 = high. Settlers still eat and sleep when they need to.';
export const DEFAULT_PRIORITY: PriorityLevel = 2;

/** Which job category a visible activity belongs to (null for eating, sleeping, walking and so on). */
export const ACTIVITY_JOB: Partial<Record<ActivityKind, JobCategory>> = {
  building: 'building',
  farming: 'farming',
  chopping: 'woodcutting',
  mining: 'mining',
  carrying: 'hauling',
  fetchingWater: 'water',
  crafting: 'crafting',
};

/** How many settlers are doing each job right now, from their activity. */
export function countByJob(settlers: readonly { activity: { kind: ActivityKind } }[]): Record<JobCategory, number> {
  const counts = Object.fromEntries(JOB_CATEGORIES.map((c) => [c, 0])) as Record<JobCategory, number>;
  for (const s of settlers) {
    const job = ACTIVITY_JOB[s.activity.kind];
    if (job) counts[job]++;
  }
  return counts;
}

/** Next level to the left or right, clamped (keyboard arrows on the level control). */
export function stepLevel(level: PriorityLevel, delta: -1 | 1): PriorityLevel {
  return Math.max(0, Math.min(3, level + delta)) as PriorityLevel;
}
