/** HSA contribution limit (docs/financial-model.md §3.6). Contributions require HDHP attestation. */
import type { Cents } from '../domain/primitives';
import type { EngineResult } from '../domain/results';
import type { ResolvedYearRules } from '../api';
import { RuleAccess, unverified } from '../rules/access';

export function hsaLimit(
  input: { coverage: 'selfOnly' | 'family'; age: number; hdhpAttested: boolean },
  rules: ResolvedYearRules,
): EngineResult<Cents> {
  if (!input.hdhpAttested) {
    return {
      status: 'ok',
      value: 0 as Cents,
      warnings: [
        {
          code: 'hsaNoHdhp',
          year: rules.taxYear,
          message: 'HSA contributions need high-deductible health plan coverage; confirm HDHP coverage to contribute.',
        },
      ],
    };
  }
  const access = new RuleAccess(rules.taxYear);
  const hsa = rules.values.hsa;
  const base = access.get(hsa[input.coverage], `hsa.${input.coverage}`, 'hsaLimits');
  const catchUp = input.age >= 55 ? access.get(hsa.catchUp55, 'hsa.catchUp55', 'hsaLimits') : 0;
  if (base === null || catchUp === null) return unverified(access.missing);
  return { status: 'ok', value: (base + catchUp) as Cents, warnings: [] };
}
