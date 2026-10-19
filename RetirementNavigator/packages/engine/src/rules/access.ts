/**
 * Rule access for calculations: read a Verified<T> value, recording every null value the calculation
 * needed. A calculation that needed any null value returns `{ status: 'unverified', missing }` and
 * never substitutes a default.
 */
import type { RuleDependentFeature, UnverifiedDetail, EngineResult } from '../domain/results';
import type { RuleKey, Verified } from '../domain/rules';

export class RuleAccess {
  private readonly byKey = new Map<string, UnverifiedDetail>();

  /** `scope` prefixes keys: a tax year (e.g. 2026) or 'standing'. */
  constructor(private readonly scope: number | 'standing') {}

  /** The value if verified; otherwise null, and the key is recorded as missing for `feature`. */
  get<T>(rule: Verified<T>, key: string, feature: RuleDependentFeature): T | null {
    if (rule.status === 'verified') return rule.value;
    const fullKey = `${this.scope}:${key}` as RuleKey;
    const existing = this.byKey.get(fullKey);
    if (existing) {
      if (!existing.features.includes(feature)) existing.features.push(feature);
    } else {
      this.byKey.set(fullKey, { key: fullKey, reason: rule.unverifiedReason, features: [feature] });
    }
    return null;
  }

  get missing(): UnverifiedDetail[] {
    return [...this.byKey.values()];
  }

  get ok(): boolean {
    return this.byKey.size === 0;
  }

  /** Merge another accessor's missing keys into this one. */
  absorb(details: readonly UnverifiedDetail[]): void {
    for (const d of details) {
      const existing = this.byKey.get(d.key);
      if (existing) {
        for (const f of d.features) if (!existing.features.includes(f)) existing.features.push(f);
      } else {
        this.byKey.set(d.key, { ...d, features: [...d.features] });
      }
    }
  }
}

export function unverified(missing: readonly UnverifiedDetail[]): EngineResult<never> {
  return { status: 'unverified', missing: [...missing] };
}
