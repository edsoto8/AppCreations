/* Calibration report: runs the default scenario headless and prints utilisation per stage. */
import { defaultScenario } from '../src/scenarios/default';
import { runScenario } from '../src/simulation/runner';

const days = Number(process.argv[2] ?? 5);
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
for (const seed of seeds) {
  const t0 = performance.now();
  const r = runScenario(defaultScenario(seed), { days });
  const ms = performance.now() - t0;
  const s = r.summary;
  const snap = r.factory.metrics.snapshot(r.factory.engine.now);
  const u = Object.entries(s.utilization).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ');
  console.log(`seed ${seed}: ${days}d in ${ms.toFixed(0)} ms, ${r.events} events`);
  console.log(`  shipped ${s.unitsShipped} (${s.throughputPerDay.toFixed(0)}/day), packed ${s.unitsPacked}, onTime ${(s.onTimeRate * 100).toFixed(1)}%, lead ${s.avgOrderLeadTimeHours.toFixed(1)} h, late ${s.latenessHours.toFixed(1)} h`);
  console.log(`  cost ${s.operatingCost.toFixed(0)} revenue ${s.revenue.toFixed(0)} objective/day ${s.objective.toFixed(0)}`);
  console.log(`  util: ${u}`);
  console.log(`  bottleneck: ${snap.bottleneck.ranking.map((b) => `${b.stage} ${b.score.toFixed(2)}`).join(' > ')}`);
  console.log(`  ${snap.bottleneck.explanation}`);
  console.log(`  backlog ${r.factory.orders.backlogUnits}, wip ${snap.totals.wip}, rejected ${snap.totals.unitsRejected}, scrapped ${snap.totals.unitsScrapped}, violations ${r.violations.length}`);
  if (r.violations.length) console.log(r.violations.slice(0, 10).join('\n'));
}
