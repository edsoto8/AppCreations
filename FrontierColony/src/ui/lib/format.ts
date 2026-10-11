/** Pure display helpers (no React, no DOM) so they can be unit tested in node. */
import { DAYS_PER_SEASON, FOOD_PER_SETTLER_DAY, SEASONS, WATER_PER_SETTLER_DAY, type Season, type WeatherKind } from '../../sim';

export { DAYS_PER_SEASON };

export const SEASON_ORDER: readonly Season[] = SEASONS;

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export const PHASE_LABEL: Record<DayPhase, string> = { dawn: 'Dawn', day: 'Daytime', dusk: 'Dusk', night: 'Night' };

export const SEASON_LABEL: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
};

/** What each season does (GAME_DESIGN §2). */
export const SEASON_EFFECT: Record<Season, string> = {
  spring: 'Mild weather. Crops grow at normal speed.',
  summer: 'Crops grow 25% faster. Drought is possible.',
  autumn: 'Crops grow at normal speed. Stockpile food for winter.',
  winter: 'Fields lie fallow, trees stop regrowing and settlers tire 10% faster. Snow and cold snaps are likely.',
};

/** "Light", "Moderate" or "Heavy" for a 0..1 weather intensity. */
export function intensityLabel(intensity: number): string {
  return intensity < 0.55 ? 'Light' : intensity < 0.8 ? 'Moderate' : 'Heavy';
}

/** Short gameplay effect of each weather (GAME_DESIGN §9). */
export const WEATHER_EFFECT: Record<WeatherKind, string> = {
  clear: 'Fair weather lifts spirits during the day.',
  cloudy: 'No effect on work or mood.',
  rain: 'Outdoor work -15%, walking -10%, crops grow 25% faster, mood -3.',
  storm: 'Outdoor work -40%, walking -25%, mood -8. Storms can damage buildings.',
  snow: 'Outdoor work -20%, walking -20%, crops cannot grow, wells -20%.',
};

export function formatClock(timeOfDay: number): string {
  const total = Math.floor(((timeOfDay % 24) + 24) % 24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** dawn 05-07, day 07-18, dusk 18-20, night 20-05 (GAME_DESIGN §2). */
export function dayPhase(timeOfDay: number): DayPhase {
  const h = ((timeOfDay % 24) + 24) % 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 18) return 'day';
  if (h >= 18 && h < 20) return 'dusk';
  return 'night';
}

export interface SkyPosition {
  body: 'sun' | 'moon';
  /** 0..1 along the arc from the left horizon to the right horizon. */
  t: number;
}

/** Sun travels 05:00 to 20:00, the moon 20:00 to 05:00. */
export function skyPosition(timeOfDay: number): SkyPosition {
  const h = ((timeOfDay % 24) + 24) % 24;
  if (h >= 5 && h < 20) return { body: 'sun', t: (h - 5) / 15 };
  const n = h >= 20 ? h - 20 : h + 4;
  return { body: 'moon', t: n / 9 };
}

export interface SeasonInfo {
  season: Season;
  /** 1-based day within the season. */
  dayInSeason: number;
  /** 1-based year. */
  year: number;
  daysUntilNextSeason: number;
}

export function seasonInfo(day: number): SeasonInfo {
  const d = Math.max(1, Math.floor(day));
  const index = Math.floor((d - 1) / DAYS_PER_SEASON);
  return {
    season: SEASON_ORDER[index % SEASON_ORDER.length]!,
    dayInSeason: ((d - 1) % DAYS_PER_SEASON) + 1,
    year: Math.floor(index / SEASON_ORDER.length) + 1,
    daysUntilNextSeason: DAYS_PER_SEASON - (((d - 1) % DAYS_PER_SEASON) + 1),
  };
}

export function formatAmount(n: number): string {
  return String(Math.floor(Math.max(0, n)));
}

export type RateTrend = 'up' | 'down' | 'flat';

export interface FormattedRate {
  text: string;
  trend: RateTrend;
}

/** Per-day net rate: "+4.2", "-12", or "±0" when it is effectively zero. Uses a real minus sign. */
export function formatRate(rate: number): FormattedRate {
  if (!Number.isFinite(rate) || Math.abs(rate) < 0.05) return { text: '±0', trend: 'flat' };
  const abs = Math.abs(rate);
  const body = abs < 10 ? abs.toFixed(1) : String(Math.round(abs));
  return rate > 0 ? { text: `+${body}`, trend: 'up' } : { text: `−${body}`, trend: 'down' };
}

/** Round a rate to the precision it is displayed at, so selectors do not change for invisible deltas. */
export function quantizeRate(rate: number): number {
  const abs = Math.abs(rate);
  if (!Number.isFinite(rate) || abs < 0.05) return 0;
  return abs < 10 ? Math.round(rate * 10) / 10 : Math.round(rate);
}

/** Days the stock lasts for `population` settlers at the base consumption, or null when nobody consumes. */
export function daysOfSupply(stock: number, population: number, perSettlerPerDay: number = FOOD_PER_SETTLER_DAY): number | null {
  if (population <= 0) return null;
  return stock / (population * perSettlerPerDay);
}

/** What one settler uses of a consumable per in-game day (food and water differ only if the sim says so). */
export const consumptionPerDay = (resource: 'food' | 'water'): number => (resource === 'water' ? WATER_PER_SETTLER_DAY : FOOD_PER_SETTLER_DAY);

export type StockLevel = 'ok' | 'low' | 'out';

/** Food and water warn below one day of supply (GAME_DESIGN §12). */
export function stockLevel(stock: number, population: number, perSettlerPerDay: number = FOOD_PER_SETTLER_DAY): StockLevel {
  if (stock < 1) return 'out';
  const days = daysOfSupply(stock, population, perSettlerPerDay);
  return days !== null && days < 1 ? 'low' : 'ok';
}

export function formatDays(days: number): string {
  if (days >= 10) return `${Math.floor(days)} days`;
  const rounded = Math.floor(days * 10) / 10;
  return `${rounded.toFixed(1)} day${rounded === 1 ? '' : 's'}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" or a short date for older saves. */
export function formatRelativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return 'unknown time';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'unknown time';
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
