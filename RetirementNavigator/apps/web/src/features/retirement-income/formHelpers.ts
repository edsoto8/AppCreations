/** Household-form helpers shared by the Retirement Income editors. */
import type { Control, UseFormReturn } from 'react-hook-form';
import type { Household, HouseholdInput } from '@rn/engine';

export type HouseholdForm = UseFormReturn<HouseholdInput, unknown, Household>;
export type HouseholdControl = Control<HouseholdInput, unknown, Household>;

/** setValue on any household path, validating and marking dirty (the form commits valid households). */
export function setter(form: HouseholdForm) {
  return (path: string, value: unknown) =>
    form.setValue(path as never, value as never, { shouldDirty: true, shouldValidate: true });
}

/** Error message at a dot path of the form's errors (array-level messages live under `root`). */
export function errorAt(form: HouseholdForm, path: string): string | undefined {
  let node: unknown = form.formState.errors;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  const n = node as { message?: string; root?: { message?: string } } | undefined;
  return n?.message ?? n?.root?.message;
}
