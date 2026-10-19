/**
 * One calculator's form and result. The form is React Hook Form validated by the calculator's own
 * engine schema (zodResolver). Every valid change is debounced, then the engine calculator runs on
 * the form values; searches (`heavy`) run deferred so typing stays responsive. Invalid values show
 * field errors and no figures. Nothing here computes a financial figure.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  useForm,
  type Control,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { EngineContext, EngineResult, Household } from '@rn/engine';
import { useEngineContext } from '@/hooks/useEngine';

/** Quiet period after the last valid change before the engine runs. */
export const RECALC_DELAY_MS = 200;

/** Plain-language messages for Zod's generic issues (schema-specific messages take precedence). */
export function calculatorIssueMessage(issue: {
  code?: string;
  origin?: string;
  expected?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
}): string | undefined {
  if (issue.code === 'invalid_type') return issue.expected === 'int' ? 'Enter a whole number' : 'Enter a value';
  if (issue.code === 'invalid_union' || issue.code === 'invalid_value') return 'Choose one of the options';
  const isArray = issue.origin === 'array';
  if (issue.code === 'too_small') {
    if (isArray) return `Add at least ${String(issue.minimum)}`;
    return issue.inclusive === false
      ? `Enter a value above ${String(issue.minimum)}`
      : `Enter ${String(issue.minimum)} or more`;
  }
  if (issue.code === 'too_big') {
    if (isArray) return `At most ${String(issue.maximum)} can be entered`;
    return issue.inclusive === false
      ? `Enter a value below ${String(issue.maximum)}`
      : `Enter ${String(issue.maximum)} or less`;
  }
  return undefined;
}

/** Values filled from the active plan, and what they were taken from. */
export interface PlanValues<TIn> {
  values: TIn;
  /** Shown after the values are applied, e.g. "Filled from Sam’s ages and the household’s savings." */
  note: string;
}

export type PlanPrefill<TIn> = (
  household: Household,
  ctx: EngineContext,
  personId: string | null,
) => PlanValues<TIn> | null;

/** Props every calculator component receives from the page. */
export interface CalculatorProps {
  /** The active profile’s household, if any (enables "Use my plan’s values"). */
  household: Household | null;
  /** Open prefilled from this person’s plan (a deep link such as the Roth IRA page’s). */
  prefillPersonId: string | null;
  autoPrefill: boolean;
}

export type CalcView<R> =
  /** The form values do not pass the schema: field errors, no figures. */
  | { kind: 'invalid' }
  /** A search is running for the first time. */
  | { kind: 'computing' }
  | { kind: 'result'; result: EngineResult<R>; pending: boolean };

export interface Calculator<TIn extends FieldValues, R> {
  form: UseFormReturn<TIn>;
  view: CalcView<R>;
  /** Null when there is no active plan or nothing in it fits this calculator. */
  planValues: PlanValues<TIn> | null;
  applyPlanValues: () => void;
  /** Set after plan values were applied (until the next reset to defaults). */
  appliedNote: string | null;
  resetToDefaults: () => void;
}

export function useCalculator<TIn extends FieldValues, R>(opts: {
  schema: z.ZodType<unknown, TIn>;
  run: (input: TIn, ctx: EngineContext) => EngineResult<R>;
  defaults: TIn;
  heavy: boolean;
  prefill?: PlanPrefill<TIn>;
  props: CalculatorProps;
}): Calculator<TIn, R> {
  const { schema, run, defaults, heavy, prefill, props } = opts;
  const ctx = useEngineContext();
  const { household, prefillPersonId, autoPrefill } = props;
  const planValues = useMemo(
    () => (household && prefill ? prefill(household, ctx, prefillPersonId) : null),
    [household, prefill, ctx, prefillPersonId],
  );
  const [initial] = useState(() => (autoPrefill && planValues ? planValues : null));
  const [appliedNote, setAppliedNote] = useState<string | null>(initial?.note ?? null);
  const startValues = initial?.values ?? defaults;

  const form = useForm<TIn>({
    resolver: zodResolver(schema as never, {
      error: (issue) => calculatorIssueMessage(issue),
    }) as unknown as Resolver<TIn>,
    mode: 'onChange',
    defaultValues: startValues as DefaultValues<TIn>,
  });

  const [snapshot, setSnapshot] = useState<{ valid: boolean; input: TIn }>(() => ({
    valid: schema.safeParse(startValues).success,
    input: startValues,
  }));
  const [debouncing, setDebouncing] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        clearTimeout(timer);
        const input = structuredClone(values) as TIn;
        if (!schema.safeParse(input).success) {
          setDebouncing(false);
          setSnapshot({ valid: false, input });
          // Show every field's error (cross-field checks land on fields other than the one edited).
          void form.trigger();
          return;
        }
        // A valid form has no schema errors; engine-reported ones are set again from the next result.
        form.clearErrors();
        setDebouncing(true);
        timer = setTimeout(() => {
          setDebouncing(false);
          setSnapshot({ valid: true, input });
        }, RECALC_DELAY_MS);
      },
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [form, schema]);

  const latest = snapshot.valid ? snapshot.input : null;
  // Searches start from null so the first paint is not blocked; later inputs keep the previous result
  // on screen while the new one is computed.
  const deferred = useDeferredValue(latest, heavy ? null : latest);
  const result = useMemo(() => (deferred === null ? null : run(deferred, ctx)), [deferred, run, ctx]);

  // Checks the engine makes after its schema (for example a range of ages) are shown on their fields.
  useEffect(() => {
    if (result?.status !== 'invalid') return;
    for (const issue of result.issues) {
      const name = issue.path.join('.');
      if (name) form.setError(name as Path<TIn>, { type: 'engine', message: issue.message });
    }
  }, [result, form]);

  const applyPlanValues = useCallback(() => {
    if (!planValues) return;
    form.reset(planValues.values);
    setAppliedNote(planValues.note);
  }, [form, planValues]);

  const resetToDefaults = useCallback(() => {
    form.reset(defaults);
    setAppliedNote(null);
  }, [form, defaults]);

  let view: CalcView<R>;
  if (!snapshot.valid) view = { kind: 'invalid' };
  else if (result === null) view = { kind: 'computing' };
  else view = { kind: 'result', result, pending: debouncing || deferred !== latest };

  return { form, view, planValues, applyPlanValues, appliedNote, resetToDefaults };
}

/**
 * The form's control typed loosely, for the shared field groups that take dot-path names
 * (e.g. "socialSecurity.monthlyAtClaim") across several calculators' forms.
 */
export function looseControl<T extends FieldValues>(control: Control<T>): Control<FieldValues> {
  return control as unknown as Control<FieldValues>;
}
