/**
 * Weather (GAME_DESIGN §9): a Markov chain over five kinds, with season tables and duration ranges.
 * The effects (work, walking, energy, farm growth, wells, moods) are read from `WEATHER_EFFECTS`
 * in needs.ts and settlerSim.ts; this module only decides what the weather is.
 */
import { RAIN_BARREL_WATER_PER_HOUR, WEATHER_DURATION_HOURS, WEATHER_INTENSITY_RANGE, WEATHER_ORDER, WEATHER_TRANSITIONS } from './balance';
import { nextFloat, nextRange } from './rng';
import { addStockOf, recordProduced } from './stateOps';
import type { GameState, SimEvent, WeatherKind } from './types';

function setWeather(state: GameState, events: SimEvent[], next: WeatherKind): void {
  const w = state.weather;
  if (next !== w.current) {
    events.push({ type: 'weatherChanged', from: w.current, to: next });
    w.current = next;
  }
}

/** Roll the next weather spell from the season's table. */
export function rollWeather(state: GameState, events: SimEvent[]): void {
  const w = state.weather;
  const table = WEATHER_TRANSITIONS[state.time.season === 'winter' ? 'winter' : 'warm'];
  const row = table[w.current];
  const r = nextFloat(state.rng);
  let acc = 0;
  let index = row.length - 1;
  for (let i = 0; i < row.length; i++) {
    acc += row[i] as number;
    if (r < acc) {
      index = i;
      break;
    }
  }
  let next = WEATHER_ORDER[index] as WeatherKind;
  if (next === 'rain' && state.activeEvents.some((e) => e.kind === 'drought')) next = 'cloudy';
  const [lo, hi] = WEATHER_DURATION_HOURS[next];
  w.hoursRemaining = nextRange(state.rng, lo, hi);
  w.intensity = nextRange(state.rng, WEATHER_INTENSITY_RANGE[0], WEATHER_INTENSITY_RANGE[1]);
  setWeather(state, events, next);
}

/** Advance the current spell by `dt` hours and roll a new one when it ends. */
export function stepWeather(state: GameState, events: SimEvent[], dt: number): void {
  state.weather.hoursRemaining -= dt;
  if (state.weather.hoursRemaining <= 0) rollWeather(state, events);
}

/** Entering winter turns rain into snow; leaving winter turns snow into cloud (the remaining hours are kept). */
export function adjustWeatherForSeason(state: GameState, events: SimEvent[]): void {
  const w = state.weather;
  if (state.time.season === 'winter' && w.current === 'rain') setWeather(state, events, 'snow');
  else if (state.time.season !== 'winter' && w.current === 'snow') setWeather(state, events, 'cloudy');
}

/** Hourly: rain barrels at the town center collect water while it rains or storms. */
export function collectRain(state: GameState): void {
  if (state.weather.current !== 'rain' && state.weather.current !== 'storm') return;
  const stored = addStockOf(state, 'water', RAIN_BARREL_WATER_PER_HOUR);
  if (stored > 0) recordProduced(state, 'water', stored);
}
