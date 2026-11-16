import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const PURE = ['simulation', 'entities', 'production', 'logistics', 'optimization'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('simulation layer purity', () => {
  const all = PURE.flatMap((d) => files(join(ROOT, d)));

  it('finds the simulation sources', () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it.each(all.map((f) => [f.slice(ROOT.length + 1), f]))('%s has no forbidden imports or globals', (_name, file) => {
    const src = stripComments(readFileSync(file, 'utf8'));
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(imp, `import ${imp}`).not.toMatch(/^(react|react-dom|three|@react-three\/|zustand|recharts)/);
      if (imp.startsWith('.')) expect(imp, `import ${imp}`).not.toMatch(/(rendering|components|dashboard|workers)\//);
    }
    expect(src).not.toMatch(/Math\.random\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/performance\.now\s*\(/);
    expect(src).not.toMatch(/new Date\s*\(/);
    expect(src).not.toMatch(/\b(window|document|navigator|localStorage|requestAnimationFrame|HTMLElement)\b/);
  });
});
