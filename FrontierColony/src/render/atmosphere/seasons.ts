/**
 * Seasonal palette as a continuous look. A season's look is fully in effect after the first day of
 * the season; during that day it blends from the previous season's look, so nothing pops. Channels are
 * quantised so the renderer only re-skins terrain when a visible step is crossed.
 */
import type { Season, TimeState, WeatherKind } from '../../sim';
import { clamp, lerp, smoothstep } from '../util/noise';

export interface SeasonLook {
  /** Multiplier for grass / forest floor / hills. */
  grass: readonly [number, number, number];
  /** 0..1 share of deciduous trees showing autumn colours. */
  autumn: number;
  /** 0..1 share of deciduous trees that are bare. */
  bare: number;
  /** 0..1 snow cover (share of land tiles under snow). */
  snow: number;
  /** 0..1 drought dryness (yellowed grass). */
  dry: number;
  /** 0..1 flowering (extra flower meadows). */
  spring: number;
  /** 0..1 icy tint on shallow water. */
  ice: number;
  /** Changes whenever a quantised channel changes. */
  key: string;
}

interface Anchor {
  grass: readonly [number, number, number];
  autumn: number;
  bare: number;
  snow: number;
  spring: number;
  ice: number;
}

const ANCHORS: Record<Season, Anchor> = {
  spring: { grass: [0.98, 1.02, 0.94], autumn: 0, bare: 0, snow: 0, spring: 1, ice: 0 },
  summer: { grass: [0.95, 0.98, 0.88], autumn: 0, bare: 0, snow: 0, spring: 0.25, ice: 0 },
  autumn: { grass: [1.0, 0.9, 0.66], autumn: 1, bare: 0, snow: 0, spring: 0, ice: 0 },
  winter: { grass: [0.9, 0.94, 1.0], autumn: 0, bare: 1, snow: 1, spring: 0, ice: 1 },
};

const ORDER: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const DAYS_PER_SEASON = 5;

function mixAnchor(a: Anchor, b: Anchor, t: number): Anchor {
  return {
    grass: [lerp(a.grass[0], b.grass[0], t), lerp(a.grass[1], b.grass[1], t), lerp(a.grass[2], b.grass[2], t)],
    autumn: lerp(a.autumn, b.autumn, t),
    bare: lerp(a.bare, b.bare, t),
    snow: lerp(a.snow, b.snow, t),
    spring: lerp(a.spring, b.spring, t),
    ice: lerp(a.ice, b.ice, t),
  };
}

const Q = 12;
const q = (v: number): number => Math.round(clamp(v, 0, 1) * Q) / Q;

/**
 * @param drought 0..1 current drought strength (event active)
 * @param weather current weather (falling snow adds a dusting even before winter proper)
 */
export function seasonLook(time: Pick<TimeState, 'day' | 'timeOfDay' | 'season'>, drought: number, weather: WeatherKind, weatherIntensity: number): SeasonLook {
  const dayIndex = time.day - 1 + time.timeOfDay / 24;
  const inSeason = dayIndex - Math.floor(dayIndex / DAYS_PER_SEASON) * DAYS_PER_SEASON;
  const cur = ANCHORS[time.season];
  const prev = ANCHORS[ORDER[(ORDER.indexOf(time.season) + 3) % 4]!];
  // blend from the previous season's look over the first day; snow also builds up a little more slowly
  const t = smoothstep(0, 1, inSeason);
  const base = mixAnchor(prev, cur, t);
  let snow = base.snow;
  if (time.season === 'winter') snow = lerp(prev.snow, 1, smoothstep(0, 2, inSeason));
  if (weather === 'snow') snow = Math.max(snow, 0.55 * clamp(weatherIntensity, 0, 1));
  const dry = clamp(drought, 0, 1);
  // grass multipliers are colours: quantise to 1/48 so tiny drifts do not trigger a re-skin
  const gq = (v: number): number => Math.round(v * 48) / 48;
  const grass: readonly [number, number, number] = [gq(base.grass[0]), gq(base.grass[1]), gq(base.grass[2])];
  const autumn = q(base.autumn);
  const bare = q(base.bare);
  const snowQ = q(snow);
  const dryQ = q(dry);
  const spring = q(base.spring);
  const ice = q(base.ice);
  return { grass, autumn, bare, snow: snowQ, dry: dryQ, spring, ice, key: [grass.join(','), autumn, bare, snowQ, dryQ, spring, ice].join('|') };
}

export const NEUTRAL_LOOK: SeasonLook = {
  grass: [1, 1, 1],
  autumn: 0,
  bare: 0,
  snow: 0,
  dry: 0,
  spring: 0.25,
  ice: 0,
  key: 'neutral',
};
