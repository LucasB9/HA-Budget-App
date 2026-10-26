/** Minimal RFC 4180 CSV handling, with the `;` delimiter French spreadsheets expect. */

export const CSV_BOM = '﻿';

function escapeField(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsv(rows: readonly (readonly string[])[], delimiter = ';'): string {
  return `${CSV_BOM}${rows.map((row) => row.map((f) => escapeField(f, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}

/** Picks `;` or `,` from the header line, preferring `;` when both appear. */
export function detectDelimiter(text: string): string {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  return header.split(';').length >= header.split(',').length ? ';' : ',';
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let sawContent = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    if (sawContent || row.some((f) => f !== '')) rows.push(row);
    row = [];
    sawContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      sawContent = true;
    } else if (ch === delimiter) {
      endField();
      sawContent = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      sawContent = true;
    }
  }
  if (quoted) throw new Error('Guillemet non fermé dans le CSV');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Lower-cases and strips accents so "Électricité" matches "electricite". */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Parses "12,50", "1 234.5", "42 €" into cents. Returns null when it is not an amount. */
export function parseAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function formatAmountCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Accepts `YYYY-MM-DD` and `DD/MM/YYYY`; returns an ISO date or null. */
export function parseDateFlexible(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const fr = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (fr) return `${fr[3]}-${(fr[2] as string).padStart(2, '0')}-${(fr[1] as string).padStart(2, '0')}`;
  return null;
}

export interface CsvTable {
  header: string[];
  rows: { line: number; values: Record<string, string> }[];
}

/** Turns parsed rows into records keyed by normalized header names. */
export function toTable(rows: string[][]): CsvTable {
  const [head, ...body] = rows;
  if (!head) return { header: [], rows: [] };
  const header = head.map((h) => normalizeName(h).replace(/\s+/g, '_'));
  return {
    header,
    rows: body.map((cells, i) => ({
      line: i + 2,
      values: Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()])),
    })),
  };
}
