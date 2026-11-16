import type { ClockInfo, ShiftConfig, ShiftIndex } from './types';

export const HOUR = 3600;
export const DAY = 86400;
/** Sim t = 0 corresponds to 06:00 on Day 1. */
export const ORIGIN_HOUR = 6;

export function hourOfDay(t: number): number {
  return (((t / HOUR + ORIGIN_HOUR) % 24) + 24) % 24;
}

/** Absolute sim time of midnight (00:00) of the day containing t. */
export function dayStart(t: number): number {
  return Math.floor((t + ORIGIN_HOUR * HOUR) / DAY) * DAY - ORIGIN_HOUR * HOUR;
}

export function shiftAt(t: number, s: ShiftConfig): ShiftIndex | null {
  const h = hourOfDay(t);
  for (let i = 0; i < s.startHours.length; i++) {
    const start = s.startHours[i];
    if (h >= start - 1e-9 && h < start + s.lengthHours - 1e-9) return i as ShiftIndex;
  }
  return null;
}

export function clockInfo(t: number, s: ShiftConfig): ClockInfo {
  const total = t + ORIGIN_HOUR * HOUR;
  const day = Math.floor(total / DAY) + 1;
  const secOfDay = total - (day - 1) * DAY;
  const hour = Math.floor(secOfDay / HOUR);
  const minute = Math.floor((secOfDay % HOUR) / 60);
  const shift = shiftAt(t, s);
  const label = `Day ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${
    shift === null ? '(closed)' : `(Shift ${shift + 1})`
  }`;
  return { day, hour, minute, shift, label };
}

export function formatTime(t: number): string {
  const total = t + ORIGIN_HOUR * HOUR;
  const day = Math.floor(total / DAY) + 1;
  const secOfDay = total - (day - 1) * DAY;
  const hh = Math.floor(secOfDay / HOUR);
  const mm = Math.floor((secOfDay % HOUR) / 60);
  return `D${day} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '—';
  if (sec < 60) return `${sec.toFixed(0)} s`;
  if (sec < HOUR) return `${(sec / 60).toFixed(1)} min`;
  return `${(sec / HOUR).toFixed(1)} h`;
}
