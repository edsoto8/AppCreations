/**
 * M7a gate "no duplicated formulas" (docs/BRIEF.md §5.8, §11; docs/financial-model.md §12).
 *
 * The calculators must call the shared engine instead of re-deriving its math. This check reads every
 * calculator source file (tests excluded: tests may contain closed forms) and fails if, outside
 * comments, it contains exponentiation or logarithm/exponential primitives — `Math.pow`, `**`,
 * `Math.exp`, `Math.expm1`, `Math.log*` — which compounding, annuity or discounting formulas need.
 * The remaining arithmetic in the calculators (sums and differences of engine outputs, bisection
 * midpoints, input construction such as rate × balance) is reviewed by hand and listed in §12.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

/** Remove block and line comments (string contents are kept; none of the banned tokens is in a string). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const BANNED: { name: string; pattern: RegExp }[] = [
  { name: 'Math.pow', pattern: /Math\s*\.\s*pow\b/ },
  { name: '** (exponentiation)', pattern: /\*\*/ },
  { name: 'Math.exp', pattern: /Math\s*\.\s*expm?1?\b/ },
  { name: 'Math.log', pattern: /Math\s*\.\s*log(?:10|2|1p)?\b/ },
];

describe('M7a: no duplicated formulas in the calculators', () => {
  it('finds the calculator sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(16);
    expect(sources).toContain('compoundInterest.ts');
  });

  it.each(sources)('%s has no exponentiation or logarithm outside comments', (file) => {
    const code = stripComments(readFileSync(join(dir, file), 'utf8'));
    const found = BANNED.filter((b) => b.pattern.test(code)).map((b) => b.name);
    expect(found).toEqual([]);
  });

  it('the check itself detects a formula and ignores comments', () => {
    const offending = 'const fv = pv * (1 + r) ** n; // growth\nconst y = Math.pow(2, 3);';
    const code = stripComments(offending);
    expect(BANNED.filter((b) => b.pattern.test(code)).map((b) => b.name)).toEqual(['Math.pow', '** (exponentiation)']);
    expect(
      BANNED.some((b) => b.pattern.test(stripComments('/** Math.pow and ** in a doc comment */\nconst a = 1;'))),
    ).toBe(false);
  });
});
