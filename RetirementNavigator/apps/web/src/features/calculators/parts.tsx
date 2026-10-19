/**
 * Shared calculator presentation: the inputs/results frame, key figures, basis labels and badges,
 * the "Not available yet" panel for unverified results, warnings and the assumptions disclosure.
 * Display only: every figure shown comes from the engine result.
 */
import { useId } from 'react';
import { Link } from 'react-router';
import type { FieldValues } from 'react-hook-form';
import { AlertTriangle, ChevronDown, ClipboardList, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import type { CalculatorBasis, CalculatorLabels, EngineWarning, ValidationIssue } from '@rn/engine';
import { Disclaimer } from '@/components/Disclaimer';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { featureLabel, uniqueRuleLabels } from './labels';
import type { Calculator } from './useCalculator';

const LINK = 'font-medium text-foreground underline underline-offset-4';

// ---- Labels ---------------------------------------------------------------------------------------

const DOLLAR_LABELS: Record<CalculatorBasis['dollars'], string> = {
  nominal: 'Nominal (future) dollars',
  todaysDollars: 'Today’s dollars',
  nominalAndTodaysDollars: 'Nominal and today’s dollars (each figure is labeled)',
};
const TAX_LABELS: Record<CalculatorBasis['tax'], string> = {
  beforeTaxes: 'Before taxes',
  afterTaxes: 'After estimated taxes',
};
const LIMIT_LABELS: Record<CalculatorBasis['limits'], string> = {
  afterLimits: 'After plan limits',
  beforeLimits: 'Before plan limits',
  notApplicable: 'Not applicable',
};

// ---- Frame ----------------------------------------------------------------------------------------

/** Inputs card beside the results card; stacked on phones. */
export function CalculatorFrame<TIn extends FieldValues, R extends CalculatorLabels>({
  title,
  calc,
  fields,
  children,
}: {
  title: string;
  calc: Calculator<TIn, R>;
  fields: React.ReactNode;
  /** Renders the calculator-specific results for an `ok` result. */
  children: (value: R) => React.ReactNode;
}) {
  const inputsId = useId();
  const resultsId = useId();
  const { view } = calc;
  const pending = view.kind === 'computing' || (view.kind === 'result' && view.pending);
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start">
      <Card aria-labelledby={inputsId} className="min-w-0">
        <CardHeader>
          <CardTitle id={inputsId}>Inputs</CardTitle>
          <PlanValuesControls calc={calc} title={title} />
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col gap-4"
            aria-label={`${title} inputs`}
          >
            {fields}
          </form>
        </CardContent>
      </Card>
      <Card aria-labelledby={resultsId} className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle id={resultsId}>Results</CardTitle>
            <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {pending ? (
                <>
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  {view.kind === 'computing' ? 'Calculating…' : 'Updating…'}
                </>
              ) : null}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          {view.kind === 'invalid' ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <p>Some inputs need attention. Results appear once every highlighted field is valid.</p>
            </Alert>
          ) : view.kind === 'computing' ? (
            <p className="text-sm text-muted-foreground">Calculating…</p>
          ) : view.result.status === 'unverified' ? (
            <NotAvailable missing={view.result.missing} />
          ) : view.result.status === 'invalid' ? (
            <EngineIssues issues={view.result.issues} />
          ) : (
            <div className={cn('flex min-w-0 flex-col gap-5', view.pending && 'opacity-70')}>
              <BasisLine labels={view.result.value} />
              {children(view.result.value)}
              <ExcludedNote labels={view.result.value} />
              <Warnings warnings={view.result.warnings} />
              <Assumptions items={view.result.value.assumptions} />
            </div>
          )}
          <Disclaimer />
        </CardContent>
      </Card>
    </div>
  );
}

function PlanValuesControls<TIn extends FieldValues, R>({ calc, title }: { calc: Calculator<TIn, R>; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <CardDescription>
        {calc.appliedNote ?? 'Example values are filled in. Change any of them; results update as you type.'}
      </CardDescription>
      <div className="flex flex-wrap gap-2">
        {calc.planValues ? (
          <Button type="button" size="sm" variant="outline" onClick={calc.applyPlanValues}>
            <ClipboardList aria-hidden="true" />
            Use my plan’s values
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={calc.resetToDefaults}
          aria-label={`Reset ${title} to example values`}
        >
          <RotateCcw aria-hidden="true" />
          Example values
        </Button>
      </div>
    </div>
  );
}

// ---- Result states --------------------------------------------------------------------------------

/** An `unverified` result: never a number, the rule values it needs instead. */
export function NotAvailable({
  missing,
  what = 'This calculation needs',
}: {
  missing: readonly { key: string; features: readonly string[] }[];
  /** Subject and verb, e.g. "The after-limit amounts need". */
  what?: string;
}) {
  const features = [...new Set(missing.flatMap((m) => m.features))];
  const rules = uniqueRuleLabels(missing);
  return (
    <Alert variant="attention">
      <ShieldAlert aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-medium">Not available yet: needs verified rules</p>
        <p className="text-muted-foreground">
          {what} regulatory values that could not be verified against an official source yet
          {features.length > 0 ? ` (for ${features.map(featureLabel).join(', ')})` : ''}. The app never fills in
          unverified values, so no figure is shown.
        </p>
        <p className="font-medium">Missing rules</p>
        <ul className="list-disc pl-5">
          {rules.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <p>
          <Link to="/rules" className={LINK}>
            See Rules &amp; Sources
          </Link>
        </p>
      </div>
    </Alert>
  );
}

function EngineIssues({ issues }: { issues: readonly ValidationIssue[] }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">These inputs cannot be calculated</p>
        <ul className="list-disc pl-5">
          {issues.map((i) => (
            <li key={`${i.path.join('.')}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}

// ---- Labels on a result ---------------------------------------------------------------------------

export function BasisLine({ labels }: { labels: CalculatorLabels }) {
  const { basis } = labels;
  const unverifiedLimits = basis.limits === 'beforeLimits' && labels.excludedFeatures.includes('workplaceLimits');
  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="How these figures are measured">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Dollars:</dt>
          <dd className="font-medium">{DOLLAR_LABELS[basis.dollars]}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Taxes:</dt>
          <dd className="font-medium">{TAX_LABELS[basis.tax]}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Plan limits:</dt>
          <dd className="font-medium">{LIMIT_LABELS[basis.limits]}</dd>
        </div>
      </dl>
      {basis.tax === 'beforeTaxes' || basis.limits === 'beforeLimits' ? (
        <div className="flex flex-wrap gap-1.5">
          {unverifiedLimits ? (
            <BeforeLimitsBadge />
          ) : basis.limits === 'beforeLimits' ? (
            <Badge variant="outline">
              <ShieldAlert aria-hidden="true" className="size-3" />
              Before plan limits
            </Badge>
          ) : null}
          {basis.tax === 'beforeTaxes' ? <BeforeTaxesBadge /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Rule-dependent steps the engine left out (the result is still shown, labeled). */
function ExcludedNote({ labels }: { labels: CalculatorLabels }) {
  if (labels.excludedFeatures.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <ShieldAlert aria-hidden="true" className="mr-1 inline size-3.5 align-text-bottom text-attention" />
      Left out because their rule values are unverified: {labels.excludedFeatures.map(featureLabel).join(', ')}.{' '}
      <Link to="/rules" className={LINK}>
        Rules &amp; Sources
      </Link>
    </p>
  );
}

function Warnings({ warnings }: { warnings: readonly EngineWarning[] }) {
  const messages = [...new Set(warnings.map((w) => w.message))];
  if (messages.length === 0) return null;
  return (
    <Alert variant="attention">
      <AlertTriangle aria-hidden="true" />
      <ul className="flex flex-col gap-1">
        {messages.slice(0, 6).map((m) => (
          <li key={m}>{m}</li>
        ))}
        {messages.length > 6 ? <li>…and {messages.length - 6} more notes.</li> : null}
      </ul>
    </Alert>
  );
}

export function Assumptions({ items }: { items: readonly string[] }) {
  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Assumptions
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="list-disc space-y-1 px-3 pb-3 pl-8 text-sm text-muted-foreground">
        {items.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  );
}

// ---- Figures --------------------------------------------------------------------------------------

export function Figures({ children, label = 'Key figures' }: { children: React.ReactNode; label?: string }) {
  return (
    <dl aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {children}
    </dl>
  );
}

/** One key figure; `basis` says which dollars (or that it is a rate or an age). */
export function Figure({
  label,
  value,
  basis,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  basis?: string;
  tone?: 'attention' | 'good';
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border p-3',
        tone === 'attention' && 'border-attention/50 bg-attention/5',
      )}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums break-words">{value}</dd>
      {basis ? <dd className="text-xs text-muted-foreground">{basis}</dd> : null}
    </div>
  );
}

/** Short subsection heading inside the results card. */
export function ResultHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}
