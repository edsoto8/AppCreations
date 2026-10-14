import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ArrowDownIcon,
  BanknoteIcon,
  CarFrontIcon,
  CircleCheckIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  LayersIcon,
  PlusIcon,
  RepeatIcon,
  TargetIcon,
  WalletIcon,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { FieldError } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { errorMessage, isApiError } from '@/api/client';
import { useDashboard } from '@/api/queries';
import type { Dashboard, Scenario, SimulationResult } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCurrency, formatDuration, formatMonthYear, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BudgetControls } from './controls/BudgetControls';
import { CombinedControls } from './controls/CombinedControls';
import { perPeriod, type ControlsContext } from './controls/context';
import { ExtraControls } from './controls/ExtraControls';
import { LumpControls } from './controls/LumpControls';
import { TargetControls, targetQuickPicks } from './controls/TargetControls';
import { useBudgetPayoff, useComparison, useScenarioMutations, useScenarios, useSimulation, useTargetPayoff } from './queries';
import { ResultsPanel, ResultsSkeleton } from './ResultsPanel';
import { ScenarioDialog, type ScenarioDialogValues } from './ScenarioDialog';
import { ScenarioToolbar } from './ScenarioToolbar';
import {
  buildSimulationRequest,
  describeStrategy,
  draftFromScenario,
  fieldIds,
  initialDraft,
  isMode,
  mapFieldErrors,
  MODES,
  scenarioForSave,
  strategyKey,
  type Draft,
  type SimulatorMode,
} from './scenarioDraft';

const DEBOUNCE_MS = 200;

const MODE_META: Record<SimulatorMode, { icon: ReactNode; title: string; description: string }> = {
  extra: { icon: <RepeatIcon />, title: 'Extra payment', description: 'Add the same extra amount to every payment.' },
  lump: { icon: <BanknoteIcon />, title: 'One-time lump sum', description: 'Make a single payment straight to principal.' },
  combined: { icon: <LayersIcon />, title: 'Combined strategy', description: 'Mix recurring extras and lump sums, and change amounts over time.' },
  target: { icon: <TargetIcon />, title: 'Target payoff date', description: 'Pick a payoff date and see the payment it takes.' },
  budget: { icon: <WalletIcon />, title: 'Monthly budget', description: 'Pay a fixed amount you can afford; the surplus goes to principal.' },
};

const PAGE_TITLE = 'Payoff Simulator';
const PAGE_DESCRIPTION = 'Model extra payments, lump sums, a target payoff date or a budget, and see the effect instantly.';

export function SimulatorPage() {
  const { loans, isLoading, isError, error, selectedLoanId } = useLoanContext();
  const dashboard = useDashboard(selectedLoanId);

  if (isLoading) return <SimulatorSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (loans.length === 0) {
    return (
      <div className="grid gap-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={<CarFrontIcon />}
          title="Select a loan to simulate payoff strategies"
          description="Add your auto loan's terms first, then come back to see how extra payments, lump sums or a bigger budget change your payoff date and interest."
          action={
            <Button asChild>
              <Link to="/loans/new">
                <PlusIcon /> Add a loan
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (selectedLoanId === null || dashboard.isPending) return <SimulatorSkeleton />;
  if (dashboard.isError) return <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />;

  const data = dashboard.data;
  if (data.status.isPaidOff || data.status.currentBalance <= 0) {
    return (
      <div className="grid gap-6">
        <PageHeader eyebrow={data.loan.name} title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={<CircleCheckIcon />}
          title="This loan is paid off"
          description="There is no balance left to pay down, so there is nothing to simulate. Pick another loan from the selector at the top, or add a new one."
          action={
            <>
              <Button variant="outline" asChild>
                <Link to="/">Back to dashboard</Link>
              </Button>
              <Button asChild>
                <Link to="/loans/new">
                  <PlusIcon /> Add a loan
                </Link>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return <SimulatorWorkspace key={data.loan.id} dashboard={data} />;
}

function validationOf(error: unknown, targets: Record<string, string>) {
  if (isApiError(error) && error.isValidation) {
    const mapped = mapFieldErrors(error.errors, targets);
    if (Object.keys(error.errors).length === 0) mapped.general.push(error.message);
    return { ...mapped, isValidation: true };
  }
  return { byField: {} as Record<string, string>, general: [] as string[], isValidation: false };
}

function SimulatorWorkspace({ dashboard }: { dashboard: Dashboard }) {
  const currency = useCurrency();
  const { loan, status, baseline } = dashboard;
  const loanId = loan.id;
  const pp = perPeriod(loan.paymentFrequency);

  const ctx = useMemo<ControlsContext>(() => {
    const today = todayIso();
    return {
      currency,
      frequency: loan.paymentFrequency,
      accrualMethod: loan.accrualMethod,
      perPeriodLabel: pp.label,
      perPeriodShort: pp.short,
      minDate: status.projectionStartDate,
      defaultLumpDate: today > status.projectionStartDate ? today : status.projectionStartDate,
      scheduledPayment: status.scheduledPayment,
      // UI range only: the larger of $1,000 and twice the payment, rounded up to a $50 step.
      sliderMax: Math.max(1000, Math.ceil((2 * status.scheduledPayment) / 50) * 50),
      baselinePayoffDate: baseline.summary.payoffDate,
    };
  }, [currency, loan.paymentFrequency, loan.accrualMethod, pp.label, pp.short, status.projectionStartDate, status.scheduledPayment, baseline.summary.payoffDate]);

  const freshDraft = useCallback(() => {
    const picks = targetQuickPicks(ctx.baselinePayoffDate, ctx.minDate);
    const defaultTargetDate = picks.find((p) => p.label === '1 year sooner')?.date ?? picks[0]?.date ?? null;
    return initialDraft({ defaultLumpDate: ctx.defaultLumpDate, defaultTargetDate });
  }, [ctx.baselinePayoffDate, ctx.minDate, ctx.defaultLumpDate]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(() => {
    const d = freshDraft();
    const m = searchParams.get('mode');
    return isMode(m) ? { ...d, mode: m } : d;
  });
  const setMode = (mode: SimulatorMode) => setDraft((d) => ({ ...d, mode }));

  // ── Saved scenarios ────────────────────────────────────────────────────────
  const scenarios = useScenarios(loanId);
  const comparison = useComparison(loanId, null);
  const mutations = useScenarioMutations(loanId);
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = scenarios.data?.find((s) => s.id === activeId) ?? null;
  const [dialog, setDialog] = useState<null | 'create' | 'rename'>(null);
  const loadedParam = useRef<string | null>(null);

  const setScenarioParam = useCallback(
    (id: number | null) => {
      loadedParam.current = id === null ? null : String(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete('scenario');
          else next.set('scenario', String(id));
          next.delete('mode');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const loadScenario = useCallback((s: Scenario) => {
    setDraft((d) => draftFromScenario(s, d));
    setActiveId(s.id);
  }, []);

  // ?scenario=<id> (e.g. "Open in simulator" from the comparison) loads that scenario once.
  const scenarioParam = searchParams.get('scenario');
  useEffect(() => {
    if (!scenarioParam || !scenarios.data || loadedParam.current === scenarioParam) return;
    loadedParam.current = scenarioParam;
    const found = scenarios.data.find((s) => String(s.id) === scenarioParam);
    if (found) loadScenario(found);
    else {
      toast.error('That saved scenario was not found for this loan.');
      setScenarioParam(null);
    }
  }, [scenarioParam, scenarios.data, loadScenario, setScenarioParam]);

  // ── Live calculations (debounced; the previous result stays on screen) ────
  const isSimMode = draft.mode === 'extra' || draft.mode === 'lump' || draft.mode === 'combined';
  const simRequest = useMemo(() => buildSimulationRequest(draft), [draft]);
  const debouncedSim = useDebouncedValue(simRequest, DEBOUNCE_MS);
  const sim = useSimulation(loanId, debouncedSim.input, isSimMode);
  const simSettling = JSON.stringify(simRequest.input) !== JSON.stringify(debouncedSim.input);

  const debouncedTarget = useDebouncedValue(draft.target.date, DEBOUNCE_MS);
  const target = useTargetPayoff(loanId, debouncedTarget, draft.mode === 'target');
  const debouncedBudget = useDebouncedValue(draft.budget.amount, DEBOUNCE_MS);
  const budget = useBudgetPayoff(loanId, debouncedBudget, draft.mode === 'budget');

  const query = draft.mode === 'target' ? target : draft.mode === 'budget' ? budget : sim;
  const settling =
    draft.mode === 'target' ? draft.target.date !== debouncedTarget : draft.mode === 'budget' ? draft.budget.amount !== debouncedBudget : simSettling;

  const validation = useMemo(() => {
    if (draft.mode === 'target') return validationOf(target.error, { targetDate: fieldIds.targetDate });
    if (draft.mode === 'budget') return validationOf(budget.error, { budget: fieldIds.budgetAmount, budgetPayment: fieldIds.budgetAmount });
    return validationOf(sim.error, debouncedSim.errorTargets);
  }, [draft.mode, target.error, budget.error, sim.error, debouncedSim.errorTargets]);

  const currentResult: SimulationResult | null =
    draft.mode === 'target' ? (target.data?.simulation ?? null) : draft.mode === 'budget' ? (budget.data?.simulation ?? null) : (sim.data ?? null);

  // Last good result per mode, so an invalid edit dims the results instead of blanking them.
  const [lastGood, setLastGood] = useState<Partial<Record<SimulatorMode, SimulationResult>>>({});
  useEffect(() => {
    if (currentResult) setLastGood((prev) => (prev[draft.mode] === currentResult ? prev : { ...prev, [draft.mode]: currentResult }));
  }, [currentResult, draft.mode]);

  const targetUnachievable = draft.mode === 'target' && target.data !== undefined && !target.data.achievable && !target.isPlaceholderData;
  const budgetEmpty = draft.mode === 'budget' && draft.budget.amount === null;
  const targetEmpty = draft.mode === 'target' && draft.target.date === null;
  const shown = targetUnachievable || budgetEmpty || targetEmpty ? null : (currentResult ?? (validation.isValidation ? (lastGood[draft.mode] ?? null) : null));
  const stale = shown !== null && validation.isValidation;
  const refreshing = settling || query.isFetching;
  const hardError = query.isError && !validation.isValidation ? query.error : null;

  // ── Saving ─────────────────────────────────────────────────────────────────
  const solvedTargetExtra = draft.mode === 'target' && target.data?.achievable ? target.data.additionalAmount : null;
  const strategy = scenarioForSave(draft, solvedTargetExtra);
  const dirty = active !== null && (strategy === null || strategyKey(strategy) !== strategyKey(active));
  const fmtShort = (n: number) => formatCurrency(n, currency, { cents: !Number.isInteger(n) });
  const strategySummary = strategy ? describeStrategy(strategy, fmtShort, pp.short) : undefined;
  const scenarioName = active && !dirty ? active.name : 'This plan';

  const createScenario = async (values: ScenarioDialogValues) => {
    if (!strategy) return;
    const saved = await mutations.create.mutateAsync({ ...values, ...strategy });
    setActiveId(saved.id);
    setScenarioParam(saved.id);
    toast.success(`Saved “${saved.name}”`);
  };
  const renameScenario = async (values: ScenarioDialogValues) => {
    if (!active) return;
    const { budgetPayment, recurringExtras, lumpSums } = active;
    await mutations.update.mutateAsync({ id: active.id, input: { ...values, budgetPayment, recurringExtras, lumpSums } });
    toast.success(`Renamed to “${values.name}”`);
  };
  const saveChanges = () => {
    if (!active || !strategy) return;
    mutations.update.mutate(
      { id: active.id, input: { name: active.name, description: active.description ?? null, ...strategy } },
      {
        onSuccess: (s) => toast.success(`Updated “${s.name}”`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };
  const deleteScenario = async () => {
    if (!active) return;
    try {
      await mutations.remove.mutateAsync(active.id);
      toast.success(`Deleted “${active.name}”`);
      setActiveId(null);
      setScenarioParam(null);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };
  const startNew = () => {
    setActiveId(null);
    setScenarioParam(null);
    setDraft(freshDraft());
  };

  const savedRows = (comparison.data?.rows ?? []).filter((r) => r.kind === 'saved');
  const e = validation.byField;
  const meta = MODE_META[draft.mode];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        eyebrow={loan.name}
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <Button variant="outline" asChild>
            <Link to="/compare">
              <GitCompareArrowsIcon /> Compare scenarios
            </Link>
          </Button>
        }
      />

      <ScenarioToolbar
        scenarios={scenarios.data ?? []}
        loading={scenarios.isPending}
        active={active}
        dirty={dirty}
        canSave={strategy !== null && !validation.isValidation}
        saving={mutations.update.isPending}
        onLoad={(id) => {
          const s = scenarios.data?.find((x) => x.id === id);
          if (!s) return;
          setScenarioParam(id);
          loadScenario(s);
        }}
        onSaveNew={() => setDialog('create')}
        onSaveChanges={saveChanges}
        onRename={() => setDialog('rename')}
        onDelete={deleteScenario}
        onNew={startNew}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
        <section aria-label="Plan settings" className="lg:sticky lg:top-20">
          <Card className="gap-0 overflow-hidden py-0 lg:max-h-[calc(100dvh-6.5rem)]">
            <Tabs value={draft.mode} onValueChange={(v) => isMode(v) && setMode(v)} className="min-h-0 gap-0">
              <div className="border-b bg-muted/30 p-2">
                <TabsList className="grid h-auto w-full grid-cols-5 gap-0.5 bg-transparent p-0" aria-label="Simulation type">
                  {MODES.map((m) => (
                    <TabsTrigger
                      key={m.value}
                      value={m.value}
                      aria-label={m.label}
                      title={m.label}
                      className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal data-[state=active]:text-primary [&_svg]:size-4"
                    >
                      {MODE_META[m.value].icon}
                      <span className="max-w-full truncate">{m.short}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain">
                <div className="grid gap-5 p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">{meta.title}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
                  </div>
                  <TabsContent value="extra">
                    <ExtraControls value={draft.extra} onChange={(extra) => setDraft((d) => ({ ...d, extra }))} errors={e} ctx={ctx} />
                  </TabsContent>
                  <TabsContent value="lump">
                    <LumpControls value={draft.lump} onChange={(lump) => setDraft((d) => ({ ...d, lump }))} errors={e} ctx={ctx} />
                  </TabsContent>
                  <TabsContent value="combined">
                    <CombinedControls value={draft.combined} onChange={(combined) => setDraft((d) => ({ ...d, combined }))} errors={e} ctx={ctx} />
                  </TabsContent>
                  <TabsContent value="target">
                    <TargetControls
                      value={draft.target}
                      onChange={(t) => setDraft((d) => ({ ...d, target: t }))}
                      errors={e}
                      ctx={ctx}
                      result={target.data}
                      loading={target.isFetching || draft.target.date !== debouncedTarget}
                      onUseAsScenario={(amount) => setDraft((d) => ({ ...d, mode: 'extra', extra: { amount, startDate: null } }))}
                    />
                  </TabsContent>
                  <TabsContent value="budget">
                    <BudgetControls
                      value={draft.budget}
                      onChange={(b) => setDraft((d) => ({ ...d, budget: b }))}
                      errors={e}
                      ctx={ctx}
                      result={budget.data && !budget.isError ? budget.data : undefined}
                      loading={budget.isFetching || draft.budget.amount !== debouncedBudget}
                    />
                  </TabsContent>
                  {validation.general.length > 0 && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {validation.general.map((m) => (
                          <FieldError key={m}>{m}</FieldError>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="flex gap-2.5 border-t bg-muted/30 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                  <p>
                    <span className="font-medium text-foreground">How extra payments are applied.</span> Each payment covers interest owed first;
                    extra amounts then go to principal. Extra payments never reduce or skip your next scheduled payment — your regular payment
                    stays {formatCurrency(status.scheduledPayment, currency)} and the loan simply ends sooner, with a smaller final payment.
                  </p>
                </div>
              </div>
            </Tabs>
          </Card>
          {shown && <MobileSummary result={shown} currency={currency} />}
        </section>

        <section id="simulator-results" aria-label="Results" className="min-w-0 scroll-mt-20">
          {hardError ? (
            <QueryError error={hardError} title="Could not run the simulation" onRetry={() => void query.refetch()} />
          ) : targetUnachievable ? (
            <EmptyState
              icon={<TargetIcon />}
              title="No regular payment reaches that date"
              description="Pick a later date, or see what a one-time lump sum would do."

              action={
                <Button variant="outline" onClick={() => setMode('lump')}>
                  Try a lump sum instead
                </Button>
              }
            />
          ) : budgetEmpty ? (
            <EmptyState icon={<WalletIcon />} title="Enter what you can afford" description={`Your scheduled payment is ${formatCurrency(status.scheduledPayment, currency)} ${pp.label}. Enter a larger amount to see how much sooner you'd finish.`} />
          ) : targetEmpty ? (
            <EmptyState icon={<TargetIcon />} title="Choose a target date" description="Pick when you'd like to be debt-free, or use one of the quick picks." />
          ) : shown ? (
            <ResultsPanel
              result={shown}
              refreshing={refreshing}
              stale={stale}
              currency={currency}
              startDate={status.projectionStartDate}
              startBalance={status.projectionStartBalance}
              scenarioName={scenarioName}
              savedRows={savedRows}
              activeScenarioId={dirty ? null : activeId}
            />
          ) : validation.isValidation ? (
            <EmptyState icon={<InfoIcon />} title="Check the highlighted fields" description="Results will appear as soon as the plan is valid." />
          ) : (
            <ResultsSkeleton />
          )}
        </section>
      </div>

      <Disclaimer />

      <ScenarioDialog
        open={dialog === 'create'}
        onOpenChange={(o) => !o && setDialog(null)}
        mode="create"
        summary={strategySummary}
        initial={{ name: '', description: null }}
        onSubmit={createScenario}
      />
      <ScenarioDialog
        open={dialog === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        mode="rename"
        initial={active ? { name: active.name, description: active.description ?? null } : undefined}
        onSubmit={renameScenario}
      />
    </div>
  );
}

/** Small-screen summary that follows the controls, so the effect of each change is visible. */
function MobileSummary({ result, currency }: { result: SimulationResult; currency: string }) {
  const c = result.comparison;
  return (
    <div className="sticky bottom-3 z-10 mt-3 lg:hidden">
      <a
        href="#simulator-results"
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        )}
      >
        <span className="min-w-0">
          <span className="block text-xs text-muted-foreground">Debt-free by</span>
          <span className="font-semibold">{formatMonthYear(c.newPayoffDate)}</span>
          {c.monthsSaved > 0 && <span className="ml-1.5 text-xs text-positive">{formatDuration(c.monthsSaved)} sooner</span>}
        </span>
        <span className="text-right">
          <span className="block text-xs text-muted-foreground">Interest saved</span>
          <span className="font-semibold text-positive">{formatCurrency(c.interestSaved, currency)}</span>
        </span>
        <ArrowDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    </div>
  );
}

function SimulatorSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading simulator">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[23rem_1fr]">
        <Skeleton className="h-[30rem] rounded-xl" />
        <ResultsSkeleton />
      </div>
    </div>
  );
}
