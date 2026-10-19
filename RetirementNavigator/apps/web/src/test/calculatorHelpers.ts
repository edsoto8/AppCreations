/** Test helpers for the calculators: read a key figure by its label, unwrap an engine result. */
import { screen } from '@testing-library/react';
import { RULES, type EngineResult } from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';

/** The same engine context the UI uses (current year and the bundled rules). */
export const uiCtx = { currentYear: CURRENT_YEAR, rules: RULES };

/** The value shown for a key figure, found by its <dt> label (waits for deferred results). */
export async function figure(label: string, timeout = 5000): Promise<string> {
  const dt = await screen.findByText(label, { selector: 'dt' }, { timeout });
  return dt.parentElement?.querySelector('dd')?.textContent ?? '';
}

export function okValue<T>(r: EngineResult<T>): T {
  if (r.status !== 'ok') throw new Error(`expected an ok result, got ${r.status}`);
  return r.value;
}
