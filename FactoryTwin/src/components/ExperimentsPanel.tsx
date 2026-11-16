import { useEffect, useRef, useState } from 'react';
import type { OptimizerProgress, OptimizerResult, Scenario, Stat } from '../simulation/types';
import { PARAMS, applyParams, readParams } from '../optimization/params';
import type { Comparison } from '../optimization/evaluate';
import { loadScenario, runtime } from '../rendering/runtime';
import { useUi } from '../store';
import { create } from 'zustand';

/** Experiment state survives tab switches (UI state only). */
const useExp = create<{
  baseline: Scenario | null;
  comparison: Comparison | null;
  result: OptimizerResult | null;
  setBaseline(s: Scenario | null): void;
  setComparison(c: Comparison | null): void;
  setResult(r: OptimizerResult | null): void;
}>((set) => ({
  baseline: null,
  comparison: null,
  result: null,
  setBaseline: (baseline) => set({ baseline }),
  setComparison: (comparison) => set({ comparison }),
  setResult: (result) => set({ result }),
}));

function useOptWorker() {
  const ref = useRef<Worker | null>(null);
  useEffect(() => () => ref.current?.terminate(), []);
  return () => {
    ref.current?.terminate();
    ref.current = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
    return ref.current;
  };
}

const fmt = (s: Stat, metric: string) => {
  const pctMetric = /On-time|utilisation/.test(metric);
  const v = (x: number) => (pctMetric ? `${(x * 100).toFixed(1)}%` : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : x.toFixed(1));
  return s.std > 0 ? `${v(s.mean)} ±${pctMetric ? (s.std * 100).toFixed(1) : Math.abs(s.std) >= 1000 ? Math.round(s.std).toLocaleString() : s.std.toFixed(1)}` : v(s.mean);
};

export function ExperimentsPanel() {
  const scenarioName = useUi((s) => s.scenarioName);
  const rt = runtime.current;
  const current = rt?.scenario;
  const [draft, setDraft] = useState<Record<string, number>>(() => (current ? readParams(current.config, PARAMS.map((p) => p.key)) : {}));
  const exp = useExp();
  const [seeds, setSeeds] = useState(3);
  const [days, setDays] = useState(3);
  const [budget, setBudget] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<OptimizerProgress | null>(null);
  const spawn = useOptWorker();

  useEffect(() => {
    if (current) setDraft(readParams(current.config, PARAMS.map((p) => p.key)));
  }, [current, scenarioName]);

  if (!current) return <div className="pad muted">Loading…</div>;
  const seedList = Array.from({ length: seeds }, (_, i) => current.seed + i);

  const applyDraft = async () => {
    const s: Scenario = { ...JSON.parse(JSON.stringify(current)), id: 'custom', name: 'Custom configuration', injectedEvents: [] };
    s.config = applyParams(current.config, draft);
    await loadScenario(s);
  };

  const runCompare = () => {
    if (!exp.baseline) return;
    setBusy('Comparing…');
    const w = spawn();
    w.onmessage = (e) => {
      if (e.data.type === 'compared') exp.setComparison(e.data.result as Comparison);
      if (e.data.type === 'error') alert(e.data.message);
      setBusy(null);
    };
    w.postMessage({ type: 'compare', baseline: exp.baseline, variant: { ...current, injectedEvents: current.injectedEvents }, seeds: seedList, days });
  };

  const runOptimizer = () => {
    setBusy('Optimizing…');
    setProgress({ evaluated: 0, budget, best: null });
    exp.setResult(null);
    const w = spawn();
    w.onmessage = (e) => {
      if (e.data.type === 'progress') setProgress(e.data.progress);
      if (e.data.type === 'done') {
        exp.setResult(e.data.result as OptimizerResult);
        setBusy(null);
      }
      if (e.data.type === 'error') {
        alert(e.data.message);
        setBusy(null);
      }
    };
    w.postMessage({ type: 'optimize', scenario: { ...current, injectedEvents: [] }, opts: { budget, seeds: seedList, days, baseSeed: current.seed } });
  };

  const applyRecommendation = async (params: Record<string, number>) => {
    const s: Scenario = { ...JSON.parse(JSON.stringify(current)), id: 'optimized-custom', name: 'Optimizer recommendation', injectedEvents: [] };
    s.config = applyParams(current.config, params);
    await loadScenario(s);
  };

  return (
    <div className="dash" data-testid="experiments">
      <div className="card">
        <h4>Parameters</h4>
        {PARAMS.map((p) => (
          <label key={p.key} className="field">
            <span>{p.label}</span>
            <input
              type="number"
              min={p.min}
              max={p.max}
              step={p.step}
              value={draft[p.key] ?? 0}
              onChange={(e) => setDraft({ ...draft, [p.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <div className="row gap" style={{ marginTop: 6 }}>
          <button className="btn small accent" onClick={applyDraft} data-testid="apply-params">
            Apply &amp; restart
          </button>
          <button className="btn small" onClick={() => setDraft(readParams(current.config, PARAMS.map((p) => p.key)))}>
            Revert
          </button>
        </div>
      </div>

      <div className="card">
        <h4>Baseline comparison</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          Baseline: <b>{exp.baseline ? `${exp.baseline.name} (seed ${exp.baseline.seed})` : 'none saved'}</b> · Current: <b>{current.name}</b>
        </div>
        <div className="row gap" style={{ margin: '6px 0', flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => exp.setBaseline(JSON.parse(JSON.stringify(current)))} data-testid="save-baseline">
            Save current as baseline
          </button>
          <label className="seed">
            seeds <input type="number" min={1} max={8} value={seeds} onChange={(e) => setSeeds(Math.max(1, Number(e.target.value)))} style={{ width: 44 }} />
          </label>
          <label className="seed">
            days <input type="number" min={1} max={14} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} style={{ width: 44 }} />
          </label>
          <button className="btn small accent" disabled={!exp.baseline || !!busy} onClick={runCompare} data-testid="run-compare">
            Compare
          </button>
        </div>
        {exp.comparison && (
          <>
            <table className="cmp" data-testid="comparison">
              <thead>
                <tr>
                  <th>Metric ({seeds} seed{seeds > 1 ? 's' : ''}, {days} d)</th>
                  <th>Baseline</th>
                  <th>Current</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {exp.comparison.rows.map((r) => {
                  const d = r.variant.mean - r.baseline.mean;
                  const rel = r.baseline.mean !== 0 ? d / Math.abs(r.baseline.mean) : 0;
                  const good = r.better === 'higher' ? d > 0 : d < 0;
                  return (
                    <tr key={r.metric}>
                      <td>{r.metric}</td>
                      <td>{fmt(r.baseline, r.metric)}</td>
                      <td>{fmt(r.variant, r.metric)}</td>
                      <td className={Math.abs(rel) < 0.005 ? '' : good ? 'up' : 'down'}>{`${rel >= 0 ? '+' : ''}${(rel * 100).toFixed(1)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              Bottleneck — baseline: {[...new Set(exp.comparison.bottlenecks.baseline)].join(', ')}; current: {[...new Set(exp.comparison.bottlenecks.variant)].join(', ')}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h4>Optimizer</h4>
        <div className="muted" style={{ fontSize: 12 }}>
          Hill climbing over the parameters above (except reject rate). Objective per day = revenue − operating cost − ${current.config.costs.latenessPenaltyPerHour}/order-hour late, averaged over {seeds} seeds × {days} days.
        </div>
        <div className="row gap" style={{ margin: '6px 0' }}>
          <label className="seed">
            budget <input type="number" min={4} max={200} value={budget} onChange={(e) => setBudget(Math.max(4, Number(e.target.value)))} style={{ width: 54 }} />
          </label>
          <button className="btn small accent" disabled={!!busy} onClick={runOptimizer} data-testid="run-optimizer">
            Run optimizer
          </button>
        </div>
        {busy && (
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {busy} {progress ? `${progress.evaluated}/${progress.budget} candidates` : ''} — runs in a Web Worker, the factory keeps running.
            </div>
            {progress && (
              <div className="progress">
                <span style={{ width: `${(progress.evaluated / progress.budget) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {exp.result && (
          <div data-testid="optimizer-result">
            <div style={{ fontSize: 12, margin: '4px 0' }}>
              Baseline objective <b>${Math.round(exp.result.baseline.objective.mean).toLocaleString()}/day</b>, throughput {Math.round(exp.result.baseline.throughputPerDay.mean)} units/day ({exp.result.evaluated} evaluated)
            </div>
            {exp.result.top.map((t, i) => (
              <div key={i} className="card" style={{ background: '#0f1724', margin: '6px 0' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>#{i + 1}</b>
                  <span className={t.gain > 0 ? 'up' : 'down'}>
                    {t.gain >= 0 ? '+' : ''}${Math.round(t.gain).toLocaleString()}/day
                  </span>
                </div>
                <div style={{ fontSize: 12 }}>
                  Throughput {Math.round(t.throughputPerDay.mean)} units/day ({Math.round(t.throughputPerDay.mean - exp.result!.baseline.throughputPerDay.mean) >= 0 ? '+' : ''}
                  {Math.round(t.throughputPerDay.mean - exp.result!.baseline.throughputPerDay.mean)}), on-time {(t.onTimeRate.mean * 100).toFixed(1)}%
                </div>
                <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                  {t.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <button className="btn small" onClick={() => applyRecommendation(t.params)}>
                  Apply in live view
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
