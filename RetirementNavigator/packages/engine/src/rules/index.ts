/** The bundled rules set: standing rules plus one file per tax year. */
import type { RulesSet } from '../domain/rules';
import { RULES_2026 } from './2026';
import { RULES_2027 } from './2027';
import { STANDING_RULES } from './standing';

export const RULES: RulesSet = {
  standing: STANDING_RULES,
  years: { '2026': RULES_2026, '2027': RULES_2027 },
};

export { RULES_2026, RULES_2027, STANDING_RULES };
