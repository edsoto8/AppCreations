import { describe, expect, it } from 'vitest';

/**
 * Only IEEE-exact operations may influence sim state (CLAUDE.md "Engine-independent math"):
 * Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt can differ between JavaScript engines.
 */
const BANNED = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*/;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

// Raw source text of every sim file. `import.meta.glob` (Vite) is used instead of node:fs because the
// test project's tsconfig only has the Vite client types.
const sources = import.meta.glob('../../src/sim/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('src/sim determinism rules', () => {
  const files = Object.keys(sources).map((p) => p.slice(p.lastIndexOf('/') + 1));

  it('finds the sim sources', () => {
    expect(files).toContain('worldgen.ts');
    expect(files).toContain('noise.ts');
  });

  it.each(files)('%s uses no engine-dependent math', (file) => {
    const lines = stripComments(sources[`../../src/sim/${file}`] as string).split('\n');
    const offenders = lines
      .map((text, i) => ({ line: i + 1, text }))
      .filter(({ text }) => BANNED.test(text.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""')));
    expect(offenders).toEqual([]);
  });
});
