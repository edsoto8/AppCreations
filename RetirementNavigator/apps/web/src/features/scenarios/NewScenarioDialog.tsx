import { useMemo, useState } from 'react';
import type { Household, Scenario, ScenarioPreset } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/form/Field';
import { IntegerInput, PercentInput } from '@/components/form/inputs';
import { newId } from '@/lib/ids';
import { buildPreset, paramError, paramLimits, PRESET_BY_ID, PRESETS, type PresetParams } from './scenarioModel';

type Choice = ScenarioPreset | 'custom';

/** Defaults for a preset; preset D's start year is the engine's default (the first year everyone is retired). */
function defaultsFor(choice: Choice, base: Household, currentYear: number): PresetParams {
  if (choice === 'custom') return {};
  const meta = PRESET_BY_ID[choice];
  if (choice !== 'D_marketDownturn') return { ...meta.defaults };
  const probe = buildPreset(
    choice,
    base,
    meta.defaults,
    { scenarioId: 'probe', name: 'probe', baseProfileId: base.id },
    currentYear,
  );
  const startYear = probe.presetParams.startYear;
  return { ...meta.defaults, ...(typeof startYear === 'number' ? { startYear } : {}) };
}

function nameFor(choice: Choice, params: PresetParams): string {
  return choice === 'custom' ? 'Custom scenario' : PRESET_BY_ID[choice].defaultName(params);
}

/** Create a scenario from a preset (with its parameters) or an empty custom scenario. */
export function NewScenarioDialog({
  open,
  onOpenChange,
  household,
  profileId,
  currentYear,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  household: Household;
  profileId: string;
  currentYear: number;
  onCreate: (scenario: Scenario) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New scenario</DialogTitle>
        <DialogDescription>
          A scenario stores only its changes to the base plan, so later edits to the base plan flow through to it.
        </DialogDescription>
        {open ? (
          <NewScenarioForm
            household={household}
            profileId={profileId}
            currentYear={currentYear}
            onCancel={() => onOpenChange(false)}
            onCreate={onCreate}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewScenarioForm({
  household,
  profileId,
  currentYear,
  onCancel,
  onCreate,
}: {
  household: Household;
  profileId: string;
  currentYear: number;
  onCancel: () => void;
  onCreate: (scenario: Scenario) => void;
}) {
  const [choice, setChoice] = useState<Choice>('B_earlyRetirement');
  const [params, setParams] = useState<PresetParams>(() => defaultsFor('B_earlyRetirement', household, currentYear));
  const [name, setName] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const meta = choice === 'custom' ? null : PRESET_BY_ID[choice];
  const shownName = name ?? nameFor(choice, params);
  // Preset D's start year runs from this year to the last plan year (the engine never starts a shock earlier).
  const limits = useMemo(() => paramLimits(household, currentYear), [household, currentYear]);
  const errors = useMemo(
    () => Object.fromEntries((meta?.fields ?? []).map((f) => [f.key, paramError(f, params[f.key], limits)])),
    [meta, params, limits],
  );
  const nameError =
    shownName.trim().length === 0 ? 'Enter a name' : shownName.trim().length > 80 ? 'Use 80 characters or fewer' : null;
  const valid = !nameError && Object.values(errors).every((e) => e === null);

  const exampleFor = (key: string, example: string) => {
    const l = limits[key];
    return l?.min !== undefined && l.max !== undefined ? `${example} From ${l.min} to ${l.max}.` : example;
  };

  const choose = (next: Choice) => {
    setChoice(next);
    setParams(defaultsFor(next, household, currentYear));
    setSubmitted(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    const ids = { scenarioId: newId('scenario'), name: shownName.trim(), baseProfileId: profileId };
    const scenario: Scenario =
      choice === 'custom'
        ? {
            id: ids.scenarioId as Scenario['id'],
            name: ids.name,
            baseProfileId: profileId as Scenario['baseProfileId'],
            preset: null,
            presetParams: {},
            ops: [],
          }
        : buildPreset(choice, household, params, ids, currentYear);
    onCreate(scenario);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field
        label="Start from"
        tip="Presets A–G build their changes from your base plan. A custom scenario starts empty: you choose which base values to override."
        example={meta ? meta.description : 'Choose which base values to override after creating it.'}
      >
        {(a) => (
          <NativeSelect {...a} value={choice} onChange={(e) => choose(e.target.value as Choice)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.letter} · {p.label}
              </option>
            ))}
            <option value="custom">Custom (choose your own changes)</option>
          </NativeSelect>
        )}
      </Field>

      {meta?.fields.map((f) => {
        const value = params[f.key];
        const error = submitted || value !== undefined ? (errors[f.key] ?? undefined) : undefined;
        if (f.kind === 'switch') {
          return (
            <Field key={f.key} label={f.label} tip={f.tip} example={f.example}>
              {(a) => (
                <Switch
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  checked={value === true}
                  onCheckedChange={(checked) => setParams((p) => ({ ...p, [f.key]: checked }))}
                />
              )}
            </Field>
          );
        }
        const onChange = (v: number) => setParams((p) => ({ ...p, [f.key]: v }));
        return (
          <Field
            key={f.key}
            label={f.label}
            tip={f.tip}
            example={exampleFor(f.key, f.example)}
            error={error ?? undefined}
          >
            {(a) =>
              f.kind === 'percent' ? (
                <PercentInput {...a} value={typeof value === 'number' ? value : null} onChange={onChange} />
              ) : (
                <IntegerInput {...a} value={typeof value === 'number' ? value : null} onChange={onChange} />
              )
            }
          </Field>
        );
      })}

      {choice === 'G_rothStrategy' ? (
        <p className="text-sm text-muted-foreground">
          The comparison shows an after-tax ending balance: the ending balance minus an assumed tax on tax-deferred
          money at the model’s own marginal rate in the final year. While tax rules are unverified it shows “Unverified
          rule”.
        </p>
      ) : null}

      <Field label="Name" error={submitted ? (nameError ?? undefined) : undefined}>
        {(a) => <Input {...a} value={shownName} maxLength={80} onChange={(e) => setName(e.target.value)} />}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Create scenario</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
