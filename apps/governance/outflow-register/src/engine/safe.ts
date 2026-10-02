/** Shared defensive helpers: bounded JSON import and injection-safe CSV. Copied per project to keep each app standalone. */

export interface ImportLimits {
  maxBytes: number;
  maxDepth: number;
  maxItems: number;
}

export const DEFAULT_LIMITS: ImportLimits = { maxBytes: 512 * 1024, maxDepth: 8, maxItems: 5000 };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function depthOf(value: unknown, depth = 0, limits = DEFAULT_LIMITS): number {
  if (depth > limits.maxDepth) return depth;
  if (Array.isArray(value)) {
    let max = depth + 1;
    for (const item of value) max = Math.max(max, depthOf(item, depth + 1, limits));
    return max;
  }
  if (value && typeof value === 'object') {
    let max = depth + 1;
    for (const item of Object.values(value as Record<string, unknown>)) {
      max = Math.max(max, depthOf(item, depth + 1, limits));
    }
    return max;
  }
  return depth;
}

function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + 1 + countItems(v), 0);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + 1 + countItems(v), 0);
  }
  return 0;
}

/** Parse untrusted JSON text with byte, depth and item bounds. Never throws. */
export function parseBoundedJson(text: string, limits: ImportLimits = DEFAULT_LIMITS): Parsed<unknown> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > limits.maxBytes) {
    return { ok: false, error: `File is ${bytes.toLocaleString()} bytes; the limit is ${limits.maxBytes.toLocaleString()} bytes.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'The top level must be a JSON object.' };
  }
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) {
    return { ok: false, error: 'Rejected a key named __proto__.' };
  }
  if (depthOf(value, 0, limits) > limits.maxDepth) {
    return { ok: false, error: `Nesting deeper than ${limits.maxDepth} levels is not accepted.` };
  }
  if (countItems(value) > limits.maxItems) {
    return { ok: false, error: `More than ${limits.maxItems.toLocaleString()} values; reduce the file.` };
  }
  return { ok: true, value };
}

/**
 * Quote a CSV cell and neutralise spreadsheet formula injection.
 * Intended safety: when the export is opened in Excel/LibreOffice/Sheets, no cell may be interpreted as a
 * formula. A cell whose first non-whitespace, non-control character is one of = + - @ (or that starts with a
 * tab/CR) is prefixed with an apostrophe so the spreadsheet treats it as literal text. Whitespace, C0 controls,
 * NBSP, zero-width and BOM characters are skipped before the check because spreadsheets trim them.
 */
const FORMULA_LEAD = /^[\s\u0000-\u001f\u007f\u00a0\u200b-\u200f\u2028\u2029\ufeff]*[=+\-@\t\r]/;
export function csvCell(input: unknown): string {
  let s = input === null || input === undefined ? '' : String(input);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Strict YYYY-MM-DD: must round-trip through UTC so normalised dates like 2026-02-30 are rejected. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(date) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
