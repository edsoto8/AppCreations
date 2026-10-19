/**
 * One React Hook Form instance over the whole household, validated by the engine's HouseholdSchema
 * (so cross-field rules such as "Roth elections need a plan that offers Roth" surface on the right
 * field). Every valid change is committed to the profile store, which persists it (debounced).
 */
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { HouseholdSchema, type Household, type HouseholdInput } from '@rn/engine';
import { useProfileStore } from '@/state/profileStore';

export function useHouseholdForm(household: Household) {
  const update = useProfileStore((s) => s.updateActiveHousehold);
  const form = useForm<HouseholdInput, unknown, Household>({
    resolver: zodResolver(HouseholdSchema),
    mode: 'onChange',
    defaultValues: household as HouseholdInput,
  });

  // Switching profiles resets the form to the newly active household.
  const lastId = useRef(household.id);
  useEffect(() => {
    if (lastId.current !== household.id) {
      lastId.current = household.id;
      form.reset(household as HouseholdInput);
    }
  }, [household, form]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      const parsed = HouseholdSchema.safeParse(values);
      if (parsed.success) update(parsed.data);
      else void form.trigger();
    });
    return () => subscription.unsubscribe();
  }, [form, update]);

  return form;
}
