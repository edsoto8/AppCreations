/**
 * Gameplay numbers the UI displays that are not exported from `src/sim/index.ts`. They mirror
 * `src/sim/balance.ts`; replace them with imports once the sim exports them (requested from the lead).
 */
/** balance.ts XP_TO_NEXT_LEVEL_PER_LEVEL: xpToNext(level) = 10 * (level + 1). */
export const XP_TO_NEXT_LEVEL_PER_LEVEL = 10;
/** balance.ts DEMOLISH_REFUND. */
export const DEMOLISH_REFUND = 0.5;
/** balance.ts tool durabilityHours. */
export const TOOL_DURABILITY_HOURS = 48;

export function xpToNext(level: number): number {
  return XP_TO_NEXT_LEVEL_PER_LEVEL * (level + 1);
}
