/** React Hook Form over the Monte Carlo settings, validated by the engine's MonteCarloConfigSchema. */
import { useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { MonteCarloConfigSchema, type MonteCarloConfig } from '@rn/engine';

export type ConfigInput = z.input<typeof MonteCarloConfigSchema>;
export type ConfigControl = Control<ConfigInput, unknown, MonteCarloConfig>;

export function useRunSettingsForm(initial: MonteCarloConfig) {
  return useForm<ConfigInput, unknown, MonteCarloConfig>({
    resolver: zodResolver(MonteCarloConfigSchema),
    mode: 'onChange',
    defaultValues: initial,
  });
}

export type RunSettingsForm = ReturnType<typeof useRunSettingsForm>;
