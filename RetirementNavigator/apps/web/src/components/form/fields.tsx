/**
 * React Hook Form bindings for the shared inputs. Field names are dot paths into the form values
 * (the household), e.g. "people.0.retirementAge". Errors come from the engine's Zod schema.
 */
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Field, type FieldChrome } from './Field';
import { IntegerInput, MoneyInput, PercentInput, PercentSlider } from './inputs';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

interface BaseProps<T extends FieldValues> extends Omit<FieldChrome, 'error'> {
  control: Control<T>;
  name: Path<T>;
  disabled?: boolean;
}

export function MoneyField<T extends FieldValues>({ control, name, disabled, ...chrome }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <MoneyInput
          {...a}
          disabled={disabled}
          value={(field.value as number | null) ?? null}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

export function PercentField<T extends FieldValues>({ control, name, disabled, ...chrome }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <PercentInput
          {...a}
          disabled={disabled}
          value={(field.value as number | null) ?? null}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

export function PercentSliderField<T extends FieldValues>({
  control,
  name,
  disabled,
  min,
  max,
  step,
  ...chrome
}: BaseProps<T> & { min: number; max: number; step: number }) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <PercentSlider
          {...a}
          label={chrome.label}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={(field.value as number | undefined) ?? 0}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

export function IntegerField<T extends FieldValues>({ control, name, disabled, ...chrome }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <IntegerInput
          {...a}
          disabled={disabled}
          value={(field.value as number | null) ?? null}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

export function TextField<T extends FieldValues>({ control, name, disabled, ...chrome }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <Input
          {...a}
          disabled={disabled}
          value={(field.value as string | undefined) ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  disabled,
  options,
  ...chrome
}: BaseProps<T> & { options: readonly { value: string; label: string }[] }) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <NativeSelect
          {...a}
          disabled={disabled}
          value={(field.value as string | undefined) ?? ''}
          onChange={(e) => field.onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

export function SwitchField<T extends FieldValues>({ control, name, disabled, ...chrome }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field {...chrome} error={fieldState.error?.message}>
      {(a) => (
        <Switch
          id={a.id}
          aria-describedby={a['aria-describedby']}
          disabled={disabled}
          checked={!!field.value}
          onCheckedChange={field.onChange}
        />
      )}
    </Field>
  );
}
