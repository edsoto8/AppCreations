/**
 * How the Monte Carlo works (docs/financial-model.md §11), in plain language: the return model, the
 * reconciliation with the deterministic forecast, correlations, rebalancing, inflation, the
 * documented simplifications and the model's limits. Collapsible, open by default.
 */
import { ChevronDown } from 'lucide-react';
import type { MonteCarloResult, ProjectionResult } from '@rn/engine';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { excludedFeatureLabel } from '@/features/dashboard/viewModel';
import { DEFAULT_SEED } from './viewModel';

export function Methodology({
  result,
  baseline,
  beforeLimits,
  beforeTaxes,
}: {
  result: MonteCarloResult | null;
  baseline: ProjectionResult | null;
  beforeLimits: boolean;
  beforeTaxes: boolean;
}) {
  const excluded = baseline?.excludedFeatures ?? [];
  return (
    <details open className="group rounded-lg border bg-card text-card-foreground shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold leading-tight">Methodology</h2>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 px-5 pb-5 text-sm">
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Returns</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Each year, each account’s return is drawn from a lognormal distribution: the logarithm of (1 + return) is
              normally distributed. Years are independent of each other.
            </li>
            <li>
              The median of each draw is the return the deterministic forecast uses for that account and year (its
              expected return, or the allocation-weighted capital-market median returns). So the median path reconciles
              with the deterministic baseline: with zero volatility every path equals it.
            </li>
            <li>
              Entered returns are geometric (median). The arithmetic mean is derived by the engine as (1 + median) ×
              e^(σ²/2) − 1, where σ is the volatility; it is shown beside each return after a run.
            </li>
            <li>
              An account’s volatility comes from its stock/bond/cash allocation, the asset-class volatilities and their
              correlations. Shocks are correlated through the Cholesky factor of the correlation matrix, which must be
              positive semi-definite (checked before every run).
            </li>
            <li>Rebalancing: every account returns to its target allocation each year. Glide paths are not modeled.</li>
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Inflation</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Fixed: the plan’s inflation assumption every year.</li>
            <li>
              Stochastic: each year’s inflation is lognormal around the median you set, correlated with the asset
              classes. Every path then has its own price level, which drives its today’s-dollar values, spending, Social
              Security cost-of-living adjustments and inflation-linked pensions. Today’s-dollar results use each path’s
              own price level, never a fixed assumption.
            </li>
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Same rules as the forecast</h3>
          <p className="text-muted-foreground">
            Every path runs the same engine as the deterministic forecast: contributions, withdrawals in your chosen
            order, the gross-up for taxes and the simplified tax model. Steps the forecast leaves out because their rule
            values are unverified are left out of every path too.
          </p>
          {beforeLimits || beforeTaxes ? (
            <div className="flex flex-wrap gap-1.5">
              {beforeLimits ? <BeforeLimitsBadge /> : null}
              {beforeTaxes ? <BeforeTaxesBadge /> : null}
            </div>
          ) : null}
          {excluded.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {excluded.map((f) => (
                <li key={f}>{excludedFeatureLabel(f)}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Simplifications</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Accounts without a stock/bond/cash allocation keep their own expected return and move with the stock shock
              at the blended volatility.
            </li>
            <li>
              With stochastic inflation, salaries (inflation-based raises) and the indexing of tax-year rule values
              still use the plan’s inflation assumption, not the path’s.
            </li>
            <li>Monte Carlo uses the annual model; monthly mode applies to the deterministic forecast only.</li>
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Model limits</h3>
          <p className="text-muted-foreground">
            No fat tails (extreme years are rarer than in real markets), no mean reversion, no regime changes, and no
            link between one year’s return and the next. Results depend on these assumptions and are estimates, not
            predictions.
          </p>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Reproducibility</h3>
          <p className="text-muted-foreground">
            Path i draws its random numbers from a stream derived from the seed and i alone, so the same seed and inputs
            give the same result regardless of how many workers run it, and the quick run is exactly the first paths of
            the full run. The default seed is {DEFAULT_SEED}. Random number generator:{' '}
            {result ? <code className="break-all text-foreground">{result.algorithm}</code> : 'shown after a run'}.
          </p>
          <p className="text-muted-foreground">
            Percentiles use the nearest-rank method. Percentile bands describe the spread of simulated paths; they are
            not statistical confidence intervals.
          </p>
        </section>
      </div>
    </details>
  );
}
