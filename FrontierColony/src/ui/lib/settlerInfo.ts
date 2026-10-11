/** Labels, thresholds and tooltip copy for settler needs, moods, skills and moodlets (docs/GAME_DESIGN.md §4, §15). */
import type { NeedType, SkillType } from '../../sim';
import type { IconName } from '../components/Icon';

export const NEED_ORDER: readonly NeedType[] = ['hunger', 'energy', 'happiness', 'health'];

export const NEED_LABEL: Record<NeedType, string> = {
  hunger: 'Hunger',
  energy: 'Energy',
  happiness: 'Happiness',
  health: 'Health',
};

/** All needs: 100 is best. */
export const NEED_TOOLTIP: Record<NeedType, string> = {
  hunger: 'Hunger: 100 is well fed. Settlers eat at the town center or a storage when it drops below 50. Below 10 they start starving.',
  energy: 'Energy: restored by sleep, faster in a bed. Exhausted settlers collapse where they stand.',
  happiness:
    'Happiness: drifts toward a target set by moodlets (see the list). Above 80 settlers work faster; below 15 they stop working and may leave.',
  health: 'Health: lost to starvation, thirst, sickness, cold and wolves; regained when fed and rested. At 0 the settler dies.',
};

export const NEED_ICON: Record<NeedType, IconName> = { hunger: 'food', energy: 'bolt', happiness: 'smile', health: 'heart' };

export const NEED_COLOR: Record<NeedType, string> = {
  hunger: 'var(--c-food)',
  energy: '#7aa7e8',
  happiness: '#d98bd0',
  health: '#e5604f',
};

export type NeedLevel = 'ok' | 'low' | 'critical';

/** Below 30 a need is worth a look; below 15 it is critical. */
export const NEED_LOW = 30;
export const NEED_CRITICAL = 15;

export function needLevel(value: number): NeedLevel {
  if (value < NEED_CRITICAL) return 'critical';
  if (value < NEED_LOW) return 'low';
  return 'ok';
}

export type MoodBand = 'inspired' | 'content' | 'unhappy' | 'miserable' | 'breaking';

export const MOOD_LABEL: Record<MoodBand, string> = {
  inspired: 'Inspired',
  content: 'Content',
  unhappy: 'Unhappy',
  miserable: 'Miserable',
  breaking: 'Breaking',
};

export const MOOD_ICON: Record<MoodBand, IconName> = {
  inspired: 'moodInspired',
  content: 'moodContent',
  unhappy: 'moodUnhappy',
  miserable: 'moodMiserable',
  breaking: 'moodBreaking',
};

export const MOOD_EFFECT: Record<MoodBand, string> = {
  inspired: 'Works 10% faster.',
  content: 'Works at normal speed.',
  unhappy: 'Works 10% slower.',
  miserable: 'Works 25% slower and may sulk.',
  breaking: 'Refuses to work and may leave the colony.',
};

/** Mood bands from GAME_DESIGN §4.4 (checked top-down on happiness). */
export function moodBand(happiness: number): MoodBand {
  if (happiness >= 80) return 'inspired';
  if (happiness >= 50) return 'content';
  if (happiness >= 30) return 'unhappy';
  if (happiness >= 15) return 'miserable';
  return 'breaking';
}

/** The lowest need value, and which need it is. */
export function lowestNeed(needs: Record<NeedType, number>): { need: NeedType; value: number } {
  let best: { need: NeedType; value: number } = { need: 'hunger', value: Infinity };
  for (const n of NEED_ORDER) if (needs[n] < best.value) best = { need: n, value: needs[n] };
  return best;
}

export const SKILL_LABEL: Record<SkillType, string> = {
  farming: 'Farming',
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  construction: 'Construction',
  hauling: 'Hauling',
  crafting: 'Crafting',
};

export const SKILL_TOOLTIP: Record<SkillType, string> = {
  farming: 'Speeds up work at farms.',
  woodcutting: 'Speeds up felling trees at lumber camps.',
  mining: 'Speeds up quarrying stone at mines.',
  construction: 'Speeds up building and repairing.',
  hauling: 'Carries more per trip and draws water faster.',
  crafting: 'Speeds up work at the workshop.',
};

const MOODLET_LABELS: Record<string, string> = {
  sleptInHouse: 'Slept in a bed',
  sleptOutdoors: 'Slept outdoors',
  sleptOutdoorsCold: 'Slept outdoors in the cold',
  hungry: 'Hungry',
  starving: 'Starving',
  dehydrated: 'Thirsty',
  tired: 'Tired',
  hurt: 'Hurt',
  sick: 'Sick',
  fineWeather: 'Fine weather',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
  socialized: 'Enjoyed some company',
  lonely: 'Lonely',
  overworked: 'Overworked',
  colonistDied: 'Mourning a colonist',
  colonistLeft: 'A colonist left',
  newcomer: 'New to the colony',
  fullLarder: 'Full larder',
  emptyLarder: 'Empty larder',
  wellFed: 'Well fed',
  festival: 'Harvest festival',
  wolves: 'Wolves nearby',
};

/** Human label for a moodlet id; unknown ids are prettified from camelCase. */
export function moodletLabel(id: string): string {
  const known = MOODLET_LABELS[id];
  if (known) return known;
  const spaced = id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatSigned(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : '0';
}

/** "3 h left" / "1 d 6 h left" for a moodlet's remaining game hours. */
export function formatHoursLeft(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return '<1 h left';
  const h = Math.round(hours);
  return h < 24 ? `${h} h left` : `${Math.floor(h / 24)} d ${h % 24} h left`;
}

export type TrendDir = 'up' | 'down' | 'flat';

/** Direction of change between two samples, with a dead band so tiny drift does not flicker. */
export function trendOf(previous: number | null, current: number, deadband = 0.4): TrendDir {
  if (previous === null) return 'flat';
  const d = current - previous;
  return d > deadband ? 'up' : d < -deadband ? 'down' : 'flat';
}

const WARNING_TEXT: Record<NeedType, { low: string; critical: string }> = {
  hunger: { low: 'Hungry', critical: 'Starving' },
  energy: { low: 'Tired', critical: 'Exhausted' },
  happiness: { low: 'Unhappy', critical: 'About to break' },
  health: { low: 'Hurt', critical: 'Badly hurt' },
};

export interface NeedWarning {
  need: NeedType;
  level: Exclude<NeedLevel, 'ok'>;
  text: string;
}

/** The most urgent need problem, or null when every need is fine. Critical beats low, then the lowest value wins. */
export function needWarning(needs: Record<NeedType, number>): NeedWarning | null {
  let best: (NeedWarning & { value: number }) | null = null;
  for (const need of NEED_ORDER) {
    const level = needLevel(needs[need]);
    if (level === 'ok') continue;
    const candidate = { need, level, text: WARNING_TEXT[need][level], value: needs[need] };
    if (!best || (candidate.level === 'critical' && best.level !== 'critical') || (candidate.level === best.level && candidate.value < best.value)) {
      best = candidate;
    }
  }
  return best ? { need: best.need, level: best.level, text: best.text } : null;
}

export type RosterSort = 'name' | 'mood' | 'needs';
export type RosterFilter = 'all' | 'attention' | 'idle';

export interface RosterRow {
  id: number;
  name: string;
  needs: Record<NeedType, number>;
  activity: { kind: string };
  sick: boolean;
}

/** Filter then sort the roster. Returns a new array. */
export function arrangeRoster<T extends RosterRow>(rows: readonly T[], filter: RosterFilter, sort: RosterSort): T[] {
  const kept = rows.filter((r) => {
    if (filter === 'attention') return needWarning(r.needs) !== null || r.sick;
    if (filter === 'idle') return r.activity.kind === 'idle' || r.activity.kind === 'wandering';
    return true;
  });
  const key = (r: T): number => (sort === 'mood' ? r.needs.happiness : sort === 'needs' ? lowestNeed(r.needs).value : 0);
  return kept.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : key(a) - key(b) || a.name.localeCompare(b.name)));
}
