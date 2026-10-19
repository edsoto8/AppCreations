/** CSV export (formula injection, basis, nulls) and JSON export/import (BRIEF §5.11, M7b gates). */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, type ExportBundle } from '../domain/documents';
import { HouseholdSchema } from '../domain/household';
import { SAMPLE_PROFILES } from '../samples/profiles';
import { projectHousehold } from '../projection/project';
import { RULES } from '../rules/index';
import { FIXTURE_YEAR, fixtureRules } from '../testing/fixtureRules';
import * as api from '../api';
import { csvCell, toCsv } from './csv';
import { MAX_IMPORT_CHARS, exportJson, importJson } from './json';

const YEAR = 2026;
const fixtureDir = new URL('./fixtures/', import.meta.url);
const v1 = () => JSON.parse(readFileSync(new URL('v1-export.json', fixtureDir), 'utf8')) as ExportBundle;

describe('CSV export', () => {
  it('is wired into the frozen API', () => {
    expect(api.toCsv).toBe(toCsv);
    expect(api.importJson).toBe(importJson);
    expect(api.exportJson).toBe(exportJson);
  });

  it.each(['=SUM(A1:A2)', '+1+1', '-1+cmd', '@SUM(1)', '\t=1', '\r=1'])('escapes %j so it is shown as text', (v) => {
    expect(csvCell(v).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
  });

  it('keeps plain numbers (also negative) as numbers and quotes commas, quotes and line breaks', () => {
    expect(csvCell('-12.05')).toBe('-12.05');
    expect(csvCell(42)).toBe('42');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });

  it('escapes user-entered account names in the header (injection through a name)', () => {
    const base = SAMPLE_PROFILES[0]!.build(YEAR);
    const h = HouseholdSchema.parse({
      ...base,
      accounts: base.accounts.map((a, i) => (i === 0 ? { ...a, name: '=HYPERLINK("x")' } : a)),
    });
    const r = projectHousehold(h, { currentYear: YEAR, rules: RULES });
    if (r.status !== 'ok') throw new Error('projection');
    const csv = toCsv(r.value, {
      dollarBasis: 'nominal',
      accountNames: Object.fromEntries(h.accounts.map((a) => [a.id, a.name])),
    });
    const header = csv.split('\r\n')[0]!;
    expect(header).toContain(`"End balance: =HYPERLINK(""x"")"`);
    // The header cell starts with "End balance", so no formula can start the cell; a bare name would be escaped:
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('writes one row per year in the chosen basis, and leaves uncomputed taxes empty', () => {
    const h = SAMPLE_PROFILES.find((s) => s.id === 'nearRetirement')!.build(YEAR);
    const r = projectHousehold(h, { currentYear: YEAR, rules: RULES });
    if (r.status !== 'ok') throw new Error('projection');
    const nominal = toCsv(r.value, { dollarBasis: 'nominal' }).trimEnd().split('\r\n');
    expect(nominal).toHaveLength(r.value.rows.length + 1);
    const headers = nominal[0]!.split(',');
    const col = (name: RegExp) => headers.findIndex((x) => name.test(x));
    const last = r.value.rows.at(-1)!;
    const lastCells = nominal.at(-1)!.split(',');
    const end = lastCells[col(/^Portfolio end/)]!;
    expect(Math.round(Number(end) * 100)).toBe(last.totals.portfolioEnd);
    expect(lastCells[col(/^Total tax/)]).toBe(''); // unverified with the bundled rules
    const todays = toCsv(r.value, { dollarBasis: 'todays' }).trimEnd().split('\r\n');
    expect(todays[0]).toContain("today's dollars");
    expect(Math.round(Number(todays.at(-1)!.split(',')[col(/^Portfolio end/)]) * 100)).toBe(last.real.portfolioEnd);
    // Taxes appear when the tax rules are verified (synthetic fixture).
    const fx = projectHousehold(h, { currentYear: FIXTURE_YEAR, rules: fixtureRules() });
    if (fx.status !== 'ok') throw new Error('projection');
    const withTax = toCsv(fx.value, { dollarBasis: 'nominal' }).trimEnd().split('\r\n');
    const t = fx.value.rows.findIndex((row) => row.tax !== null);
    expect(Math.round(Number(withTax[t + 1]!.split(',')[col(/^Total tax/)]) * 100)).toBe(
      fx.value.rows[t]!.tax!.totalTax,
    );
  });
});

describe('JSON export and import', () => {
  it('round-trips an export bundle exactly', () => {
    const bundle = v1();
    const text = exportJson(bundle);
    const back = importJson(text);
    expect(back.status).toBe('ok');
    if (back.status === 'ok') expect(back.value).toEqual(JSON.parse(text));
  });

  it('has a fixture for every schema version up to the current one, each importing cleanly', () => {
    const versions = readdirSync(fixtureDir)
      .map((f) => /^v(\d+)-export\.json$/.exec(f)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) expect(versions).toContain(v);
    for (const v of versions) {
      const r = importJson(readFileSync(new URL(`v${v}-export.json`, fixtureDir), 'utf8'));
      expect(r.status, `v${v}`).toBe('ok');
    }
  });

  it.each([
    ['', 'The file is empty'],
    ['{ not json', 'not valid JSON'],
    ['[1, 2]', 'does not contain an export object'],
    ['{"format":"something-else"}', 'not a Retirement Navigator export'],
    ['{"format":"retirement-navigator-export","schemaVersion":"1"}', 'invalid schemaVersion'],
    ['{"format":"retirement-navigator-export","schemaVersion":99}', 'newer version of the app'],
  ])('rejects %j with a clear message', (text, message) => {
    const r = importJson(text);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues.map((i) => i.message).join(' ')).toContain(message);
  });

  it('rejects oversized files and reports field problems with their paths', () => {
    expect(importJson(' '.repeat(MAX_IMPORT_CHARS + 1)).status).toBe('invalid');
    const bad = v1() as unknown as { profiles: { household: { people: { retirementAge: unknown }[] } }[] };
    bad.profiles[0]!.household.people[0]!.retirementAge = 'sixty';
    const r = importJson(JSON.stringify(bad));
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.issues[0]!.path.slice(0, 5)).toEqual(['profiles', 0, 'household', 'people', 0]);
    }
    const noList = { ...v1(), profiles: 'none' };
    expect(importJson(JSON.stringify(noList)).status).toBe('invalid');
  });

  it('rejects scenarios whose base profile is missing, duplicate profiles and a dangling active profile', () => {
    const orphan = { ...v1(), profiles: [] };
    const r = importJson(JSON.stringify(orphan));
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      const text = r.issues.map((i) => i.message).join(' ');
      expect(text).toContain('refers to a profile that is not in the file');
      expect(text).toContain('active profile is not in the file');
    }
    const dup = v1();
    const twice = importJson(JSON.stringify({ ...dup, profiles: [dup.profiles[0], dup.profiles[0]] }));
    expect(twice.status === 'invalid' && twice.issues[0]!.message).toMatch(/appears twice/);
  });

  it('refuses to export an invalid bundle (so every export can be imported)', () => {
    expect(() => exportJson({ ...v1(), format: 'x' } as never)).toThrow();
  });
});
