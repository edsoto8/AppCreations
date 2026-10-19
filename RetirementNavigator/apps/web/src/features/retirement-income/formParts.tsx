/** Small form pieces shared by the Retirement Income editors (all bound to the household form). */
import { Trash2 } from 'lucide-react';
import { useController } from 'react-hook-form';
import type { Account, GrowthMode } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { PercentField } from '@/components/form/fields';
import { ACCOUNT_TYPE_LABELS } from '@/features/accounts/accountModel';
import { setter, type HouseholdControl, type HouseholdForm } from './formHelpers';

const GROWTH_LABELS: Record<GrowthMode['mode'], string> = {
  flat: 'Stays flat (no increase)',
  inflation: 'Rises with inflation',
  rate: 'Rises at a set rate',
};

/** Growth mode (flat / inflation / rate) with its rate input. */
export function GrowthModeField({
  form,
  path,
  value,
  label,
  tip,
  example,
}: {
  form: HouseholdForm;
  path: string;
  value: GrowthMode;
  label: string;
  tip: string;
  example: string;
}) {
  const set = setter(form);
  return (
    <>
      <Field label={label} tip={tip} example={example}>
        {(a) => (
          <NativeSelect
            {...a}
            value={value.mode}
            onChange={(e) => {
              const mode = e.target.value as GrowthMode['mode'];
              set(path, mode === 'rate' ? { mode, rate: 0.02 } : { mode });
            }}
          >
            {(Object.keys(GROWTH_LABELS) as GrowthMode['mode'][]).map((m) => (
              <option key={m} value={m}>
                {GROWTH_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {value.mode === 'rate' ? (
        <PercentField
          control={form.control as HouseholdControl}
          name={`${path}.rate` as never}
          label={`${label}: rate per year`}
          example="A nominal rate, for example 2%."
        />
      ) : null}
    </>
  );
}

/** A select over people (and optionally "the household"), bound to an id field. */
export function OwnerField({
  control,
  name,
  people,
  allowHousehold = false,
  label = 'Owner',
  tip,
  example,
}: {
  control: HouseholdControl;
  name: string;
  people: readonly { id: string; name: string }[];
  allowHousehold?: boolean;
  label?: string;
  tip?: string;
  example?: string;
}) {
  const { field, fieldState } = useController({ control, name: name as never });
  const value = field.value as string | null | undefined;
  return (
    <Field label={label} tip={tip} example={example} error={fieldState.error?.message}>
      {(a) => (
        <NativeSelect
          {...a}
          value={value ?? ''}
          onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
        >
          {allowHousehold ? <option value="">Household (no single owner)</option> : null}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/**
 * Destination account select listing only `eligible` accounts. A current choice that is no longer
 * eligible stays visible (marked) so the validation message has something to point at.
 */
export function AccountField({
  control,
  name,
  eligible,
  all,
  label,
  tip,
  example,
  defaultOption,
}: {
  control: HouseholdControl;
  name: string;
  eligible: readonly Account[];
  all: readonly Account[];
  label: string;
  tip?: string;
  example?: string;
  /** Label for the null choice; omit when an account is required. */
  defaultOption?: string;
}) {
  const { field, fieldState } = useController({ control, name: name as never });
  const value = (field.value as string | null | undefined) ?? null;
  const stray = value !== null && !eligible.some((a) => a.id === value) ? all.find((a) => a.id === value) : undefined;
  const error =
    fieldState.error?.message ?? (stray ? 'This account cannot receive this money; choose another.' : undefined);
  return (
    <Field label={label} tip={tip} example={example} error={error}>
      {(a) => (
        <NativeSelect
          {...a}
          value={value ?? ''}
          onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
        >
          {defaultOption !== undefined || value === null ? (
            <option value="">{defaultOption ?? 'Choose an account'}</option>
          ) : null}
          {eligible.map((acct) => (
            <option key={acct.id} value={acct.id}>
              {acct.name} ({ACCOUNT_TYPE_LABELS[acct.type]})
            </option>
          ))}
          {stray ? (
            <option value={stray.id}>
              {stray.name} ({ACCOUNT_TYPE_LABELS[stray.type]}, not allowed)
            </option>
          ) : null}
        </NativeSelect>
      )}
    </Field>
  );
}

/** Header row of an editable list item: its title and a labeled remove button (24 px+ target). */
export function ItemHeader({
  title,
  onRemove,
  removeLabel,
}: {
  title: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={removeLabel}>
        <Trash2 aria-hidden="true" /> Remove
      </Button>
    </div>
  );
}
