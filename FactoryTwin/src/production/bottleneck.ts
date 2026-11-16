import type { BottleneckEntry, BottleneckReport, ResourceStats } from '../simulation/types';

export const STAGE_ORDER = ['Assembly', 'Inspection', 'Packaging', 'Palletizing', 'AGV transport', 'Forklift'];

/**
 * Bottleneck detector (active-period method plus queue evidence).
 *
 * For each stage: active = busy + down (failed/maintenance) share of open time, averaged over the
 * stage's resources. A stage that is often blocked by its downstream is not the constraint, so
 * the score discounts blocked time. Queue build-up in front of the stage adds evidence.
 *
 *   score = active * (1 - blocked) + 0.15 * min(1, avgQueue / (8 * servers))
 */
export function detectBottleneck(resources: ResourceStats[], upstreamQueue: Record<string, number> = {}): BottleneckReport {
  const groups = new Map<string, ResourceStats[]>();
  for (const r of resources) {
    if (!STAGE_ORDER.includes(r.stage)) continue;
    const g = groups.get(r.stage) ?? [];
    g.push(r);
    groups.set(r.stage, g);
  }
  const ranking: BottleneckEntry[] = [];
  for (const stage of STAGE_ORDER) {
    const g = groups.get(stage);
    if (!g || g.length === 0) continue;
    const n = g.length;
    const avg = (fn: (r: ResourceStats) => number) => g.reduce((s, r) => s + fn(r), 0) / n;
    const utilization = avg((r) => r.utilization);
    const failed = avg((r) => r.failedFrac);
    const blockedFrac = avg((r) => r.blockedFrac);
    const starvedFrac = avg((r) => r.starvedFrac);
    const avgQueue = g.reduce((s, r) => s + r.avgQueue, 0) + (upstreamQueue[stage] ?? 0);
    const active = Math.min(1, utilization + failed);
    const score = active * (1 - blockedFrac) + 0.15 * Math.min(1, avgQueue / (8 * n));
    ranking.push({ stage, score, utilization, blockedFrac, starvedFrac, avgQueue });
  }
  ranking.sort((a, b) => b.score - a.score || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  return { ranking, explanation: explain(ranking) };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function explain(r: BottleneckEntry[]): string {
  if (r.length === 0) return 'Not enough data yet.';
  const top = r[0];
  const second = r[1];
  const starved = [...r].filter((e) => e !== top).sort((a, b) => b.starvedFrac - a.starvedFrac)[0];
  let s =
    `${top.stage} is the bottleneck: it was busy or down ${pct(top.utilization)} of its open time, ` +
    `blocked only ${pct(top.blockedFrac)}, with on average ${top.avgQueue.toFixed(1)} units waiting in front of it.`;
  if (starved && starved.starvedFrac > 0.1) s += ` Downstream stations wait on it — ${starved.stage} was starved ${pct(starved.starvedFrac)} of the time.`;
  if (second) {
    const margin = top.score - second.score;
    s +=
      margin < 0.05
        ? ` ${second.stage} is close behind (score ${second.score.toFixed(2)} vs ${top.score.toFixed(2)}), so relieving ${top.stage.toLowerCase()} may shift the bottleneck there.`
        : ` Adding capacity at ${top.stage.toLowerCase()} (another unit, faster cycle, or less downtime) will raise output; adding it elsewhere will not.`;
  }
  return s;
}
