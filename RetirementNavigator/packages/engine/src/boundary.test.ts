/**
 * Gate (M1): the engine package has no React/DOM/storage dependencies and reads no clock or global
 * randomness. Complements the ESLint rules and the DOM-free tsconfig.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

const BANNED: [RegExp, string][] = [
  [/from\s+['"](react|react-dom|react\/[^'"]*|idb|radix-ui|@radix-ui\/[^'"]*|@rn\/web)['"]/, 'banned import'],
  [/\bwindow\./, 'window global'],
  [/\bdocument\./, 'document global'],
  [/\blocalStorage\b|\bindexedDB\b/, 'browser storage'],
  [/Date\.now\(|new Date\(/, 'clock read'],
  [/Math\.random\(/, 'global randomness'],
  [/\.toFixed\(/, 'toFixed in logic'],
];

describe('engine boundary', () => {
  const files = sourceFiles(SRC);

  it('finds the engine sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(BANNED)('contains no %s', (pattern, label) => {
    const offenders = files
      .filter((f) => {
        // Strip comments so documentation may mention the banned names.
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        return pattern.test(code);
      })
      .map((f) => relative(SRC, f));
    expect(offenders, `${label} found`).toEqual([]);
  });

  it('declares no browser libs in its tsconfig', () => {
    const tsconfig = JSON.parse(readFileSync(join(SRC, '..', 'tsconfig.json'), 'utf8')) as {
      compilerOptions: { lib: string[]; types: string[] };
    };
    expect(tsconfig.compilerOptions.lib.some((l) => /dom/i.test(l))).toBe(false);
    expect(tsconfig.compilerOptions.types).toEqual([]);
  });

  it('lists only zod as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['zod']);
  });
});
