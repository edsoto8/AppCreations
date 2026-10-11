import type { LogEntry, LogSeverity } from '../../sim';

/** Newest first, optionally restricted to one severity. Returns a new array. */
export function filterLog(log: readonly LogEntry[], filter: LogSeverity | 'all'): LogEntry[] {
  const kept = filter === 'all' ? [...log] : log.filter((e) => e.severity === filter);
  return kept.sort((a, b) => b.id - a.id);
}

/** Number of entries newer than the last one the player saw. A seen id above the newest means the log was reset. */
export function unreadCount(log: readonly LogEntry[], seenId: number | null): number {
  if (seenId === null || log.length === 0) return 0;
  const newest = log[log.length - 1]!.id;
  if (seenId > newest) return 0;
  return log.filter((e) => e.id > seenId).length;
}

/** "36 h left" / "2 d 4 h left" for an in-game hour count. */
export function formatHoursRemaining(hours: number): string {
  const h = Math.max(0, Math.ceil(hours));
  return h < 24 ? `${h} h left` : `${Math.floor(h / 24)} d ${h % 24} h left`;
}
