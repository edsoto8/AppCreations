import { useId, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { applyScenario, type Household, type Scenario, type WithdrawalStrategy } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { IntegerInput, MoneyInput, PercentInput } from '@/components/form/inputs';
import { formatCents, formatPercent } from '@/lib/format';
import { useScenarioStore } from '@/state/scenarioStore';
import { ScenarioWarnings } from './ScenarioWarnings';
import {
  describeOp,
  initialOverrideValue,
  marketShockValue,
  opKey,
  overrideError,
  overrideTargets,
  paramError,
  paramLimits,
  PRESET_BY_ID,
  shockParams,
  WITHDRAWAL_STRATEGY_LABELS,
  withOverride,
  withoutOp,
  type OverrideTarget,
  type ParamField,
  type ShockParams,
} from './scenarioModel';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The base plan's value in words, shown beside each override. */
function baseText(target: OverrideTarget): string {
  const v = target.baseValue;
  switch (target.kind) {
    case 'age':
      return String(v);
    case 'money':
      return `${formatCents(num(v) ?? 0)} a year`;
    case 'rate':
    case 'inflation':
    case 'deferral':
      return formatPercent(num(v) ?? 0, 2);
    case 'strategy':
      return WITHDRAWAL_STRATEGY_LABELS[v as WithdrawalStrategy] ?? String(v);
    case 'claimAge': {
      const a = v as { years: number; months: number };
      return `${a.years} years${a.months ? ` ${a.months} months` : ''}`;
    }
    case 'marketShock': {
      const s = shockParams(v);
      return s ? `${formatPercent(s.severity)} from ${s.startYear}` : 'none';
    }
  }
}

const EXAMPLES: Record<OverrideTarget['kind'], string> = {
  age: 'A whole age, for example 62.',
  money: 'In today’s dollars per year, for example 72,000.',
  rate: 'A nominal annual return, for example 5%.',
  inflation: 'Annual inflation, for example 3%.',
  deferral: 'Share of salary, for example 10%.',
  strategy: 'The order accounts are drawn from in retirement.',
  claimAge: '',
  marketShock: '',
};

/** One override's input, by kind. */
function OverrideInput({
  target,
  value,
  onChange,
  household,
  currentYear,
}: {
  target: OverrideTarget;
  value: unknown;
  onChange: (value: unknown) => void;
  household: Household;
  currentYear: number;
}) {
  const error = overrideError(target, value) ?? undefined;
  const chrome = {
    label: target.label,
    example: `${EXAMPLES[target.kind]} Base plan: ${baseText(target)}.`.trim(),
    error,
  };
  switch (target.kind) {
    case 'age':
      return <Field {...chrome}>{(a) => <IntegerInput {...a} value={num(value)} onChange={onChange} />}</Field>;
    case 'money':
      return <Field {...chrome}>{(a) => <MoneyInput {...a} value={num(value)} onChange={onChange} />}</Field>;
    case 'rate':
    case 'inflation':
    case 'deferral':
      return <Field {...chrome}>{(a) => <PercentInput {...a} value={num(value)} onChange={onChange} />}</Field>;
    case 'strategy':
      return (
        <Field {...chrome}>
          {(a) => (
            <NativeSelect {...a} value={String(value)} onChange={(e) => onChange(e.target.value)}>
              {(Object.keys(WITHDRAWAL_STRATEGY_LABELS) as WithdrawalStrategy[]).map((s) => (
                <option key={s} value={s}>
                  {WITHDRAWAL_STRATEGY_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      );
    case 'claimAge': {
      const v = (value ?? {}) as { years?: number; months?: number };
      const errorId = `${target.key}-error`;
      return (
        <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
          <legend className="mb-1 text-sm font-medium">{target.label}</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Years">
              {(a) => (
                <IntegerInput
                  {...a}
                  aria-invalid={!!error}
                  value={num(v.years)}
                  onChange={(years) => onChange({ months: 0, ...v, years })}
                />
              )}
            </Field>
            <Field label="Months">
              {(a) => (
                <IntegerInput
                  {...a}
                  aria-invalid={!!error}
                  value={num(v.months)}
                  onChange={(months) => onChange({ years: 67, ...v, months })}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Between 62 and 70. Base plan: {baseText(target)}.</p>
          {error ? (
            <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }
    case 'marketShock':
      return (
        <MarketShockInput
          label={target.label}
          baseLabel={baseText(target)}
          value={value}
          onChange={onChange}
          household={household}
          currentYear={currentYear}
        />
      );
  }
}

type ShockDraft = { [K in keyof ShockParams]: number | null };
const SHOCK_KEYS = ['severity', 'durationYears', 'startYear'] as const;
const shockField = (key: keyof ShockParams) =>
  PRESET_BY_ID.D_marketDownturn.fields.find((f) => f.key === key) as ParamField;

/**
 * Market shock override with preset D's bounds: a total drop above −100% and at most 0%, 1 to 10
 * years, starting from this year to the last plan year. The engine builds the per-year sequence. An
 * out-of-range entry shows its error and is not saved (the engine would otherwise move it silently).
 */
function MarketShockInput({
  label,
  baseLabel,
  value,
  onChange,
  household,
  currentYear,
}: {
  label: string;
  baseLabel: string;
  value: unknown;
  onChange: (value: unknown) => void;
  household: Household;
  currentYear: number;
}) {
  const [draft, setDraft] = useState<ShockDraft>(
    () => shockParams(value) ?? { severity: -0.3, durationYears: 1, startYear: currentYear },
  );
  const limits = paramLimits(household, currentYear);
  const errorOf = (d: ShockDraft, key: keyof ShockParams): string | null => {
    const v = d[key];
    return v === null ? 'Enter a value' : paramError(shockField(key), v, limits);
  };
  const update = (patch: Partial<ShockDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const { severity, durationYears, startYear } = next;
    if (severity === null || durationYears === null || startYear === null) return;
    if (SHOCK_KEYS.some((key) => errorOf(next, key) !== null)) return;
    onChange(marketShockValue(household, { severity, durationYears, startYear }, currentYear));
  };
  const error = (key: keyof ShockParams) => errorOf(draft, key) ?? undefined;
  const lastYear = limits.startYear?.max ?? currentYear;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Total market drop"
          example="Above −100% and at most 0%, for example −30%."
          error={error('severity')}
        >
          {(a) => <PercentInput {...a} value={draft.severity} onChange={(severity) => update({ severity })} />}
        </Field>
        <Field label="Duration (years)" example="1 to 10." error={error('durationYears')}>
          {(a) => (
            <IntegerInput {...a} value={draft.durationYears} onChange={(durationYears) => update({ durationYears })} />
          )}
        </Field>
        <Field label="Start year" example={`${currentYear} to ${lastYear}.`} error={error('startYear')}>
          {(a) => <IntegerInput {...a} value={draft.startYear} onChange={(startYear) => update({ startYear })} />}
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        A deterministic return shock on every account, spread evenly over its years. Base plan: {baseLabel}. A value out
        of range is not saved.
      </p>
    </fieldset>
  );
}

/**
 * Custom scenario builder: choose base values to override; each override is a `set` op on the
 * entity id. Changes from a preset that are not in the catalog are listed and can be removed.
 */
export function ScenarioEditor({
  scenario,
  household,
  currentYear,
  onClose,
}: {
  scenario: Scenario;
  household: Household;
  currentYear: number;
  onClose: () => void;
}) {
  const setOps = useScenarioStore((s) => s.setOps);
  const targets = useMemo(() => overrideTargets(household), [household]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const application = useMemo(() => applyScenario(household, scenario), [household, scenario]);
  const orphanedIndexes = new Set(application.orphaned.map((o) => o.opIndex));
  const used = new Set(scenario.ops.flatMap((op) => (op.op === 'set' ? [opKey(op.collection, op.id, op.path)] : [])));
  const available = targets.filter((t) => !used.has(t.key));
  const groups = [...new Set(available.map((t) => t.group))];
  const [adding, setAdding] = useState<string>('');
  const addKey = available.some((t) => t.key === adding) ? adding : (available[0]?.key ?? '');
  const selectId = useId();
  const titleId = useId();
  // Editing a preset's changes makes it a custom scenario, so its preset label no longer applies.
  const edit = (ops: Scenario['ops']) => setOps(scenario.id, ops, { asCustom: true });

  const add = () => {
    const target = byKey.get(addKey);
    if (!target) return;
    edit(withOverride(scenario.ops, target, initialOverrideValue(target, household, currentYear)));
  };

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle id={titleId}>Changes in “{scenario.name}”</CardTitle>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close the change editor">
            <X aria-hidden="true" />
          </Button>
        </div>
        <CardDescription>
          Each change overrides one value of the base plan in this scenario. Everything else follows the base plan,
          including your later edits to it. Changes save automatically.
          {scenario.preset !== null
            ? ' Editing a preset’s changes turns it into a custom scenario (its preset settings no longer describe it).'
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ScenarioWarnings application={application} household={household} scenario={scenario} />

        {scenario.ops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet: this scenario matches the base plan.</p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Changes">
            {scenario.ops.map((op, index) => {
              const target = op.op === 'set' ? byKey.get(opKey(op.collection, op.id, op.path)) : undefined;
              const description = describeOp(op, household);
              return (
                <li
                  key={op.op === 'add' ? `add-${index}` : `${op.op}:${opKey(op.collection, op.id, op.path ?? [])}`}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-end"
                >
                  <div className="min-w-0 flex-1">
                    {target && op.op === 'set' && !orphanedIndexes.has(index) ? (
                      <OverrideInput
                        target={target}
                        value={op.value}
                        household={household}
                        currentYear={currentYear}
                        onChange={(value) => edit(withOverride(scenario.ops, target, value))}
                      />
                    ) : (
                      <p className="text-sm">
                        {description}
                        {orphanedIndexes.has(index) ? (
                          <span className="ml-1 font-medium text-attention">(not applied)</span>
                        ) : null}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-end"
                    onClick={() => edit(withoutOp(scenario.ops, index))}
                    aria-label={`Remove change: ${target ? target.label : description}`}
                  >
                    <Trash2 aria-hidden="true" /> Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {available.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={selectId}>Add a change</Label>
              <NativeSelect id={selectId} value={addKey} onChange={(e) => setAdding(e.target.value)}>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {available
                      .filter((t) => t.group === g)
                      .map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" onClick={add}>
              <Plus aria-hidden="true" /> Add change
            </Button>
          </div>
        ) : null}
        <div>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
