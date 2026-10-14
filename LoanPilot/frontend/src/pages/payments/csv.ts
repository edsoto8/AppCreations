/** Client-side helpers for the payment CSV import (the server parses and validates the file). */

export const CSV_COLUMNS = 'date,amount[,principal,interest,note]';

/** A small, valid example file users can download and fill in. */
export const SAMPLE_CSV = [
  'date,amount,principal,interest,note',
  '2026-07-10,537.77,421.10,116.67,July statement',
  '2026-08-10,537.77,423.38,114.39,August statement',
  '09/10/2026,537.77,,,',
  '2026-10-10,600.00,,,Paid a little extra',
  '',
].join('\n');

export interface CsvPreview {
  /** Non-empty lines with their 1-based line numbers in the file. */
  lines: { line: number; cells: string[] }[];
  totalLines: number;
  hasHeader: boolean;
  /** Data lines (excluding a header). */
  dataLines: number;
}

/** Splits one CSV line, honouring double-quoted cells (for notes that contain commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

export function previewCsv(text: string, maxLines = 6): CsvPreview {
  const all = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const numbered = all.map((raw, i) => ({ raw, line: i + 1 })).filter((l) => l.raw.trim() !== '');
  const hasHeader = numbered.length > 0 && /^\s*"?date"?\s*,/i.test(numbered[0].raw);
  return {
    lines: numbered.slice(0, maxLines).map((l) => ({ line: l.line, cells: splitCsvLine(l.raw) })),
    totalLines: numbered.length,
    hasHeader,
    dataLines: numbered.length - (hasHeader ? 1 : 0),
  };
}

export const MAX_CSV_BYTES = 1024 * 1024;

export function looksLikeCsv(file: File): boolean {
  return /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain' || file.type === 'application/vnd.ms-excel';
}
