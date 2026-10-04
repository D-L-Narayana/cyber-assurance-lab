import type { ActivityRecord } from './ueba';

/**
 * Import bounds. `maxBytes` is checked on the UTF-8 length of the text BEFORE `JSON.parse`; `maxDepth`/`maxValues` are
 * enforced by an iterative (stack-based) scan of the parsed value before any row is read. A record array is exactly
 * two containers deep (array → record); depth 3 leaves room for one unknown nested object, which is then dropped.
 */
export const LIMITS = { maxRecords: 5000, maxBytes: 2_000_000, maxDepth: 3, maxValues: 100_000, maxErrors: 20, maxName: 64, maxCount: 1e9 };
export type ValidateResult = { ok: true; records: ActivityRecord[] } | { ok: false; errors: string[] };

/** Bounded text entry point used by the import dialog: byte cap → JSON.parse → structural scan → row rules. Never throws. */
export function parseRecords(text: string): ValidateResult {
  if (utf8LengthExceeds(text, LIMITS.maxBytes)) return { ok: false, errors: [`Input exceeds ${LIMITS.maxBytes.toLocaleString()} bytes (UTF-8).`] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, errors: ['Not valid JSON.'] }; }
  return validateParsed(parsed); // decoded exactly once: a JSON string literal is a value, never re-parsed
}

/** Validate records given as JSON text (bounded parse) or as an already-parsed value. Errors are path-addressed (`records[i].field`). */
export function validateRecords(input: unknown): ValidateResult {
  if (typeof input === 'string') return parseRecords(input);
  return validateParsed(input);
}

/** Structural scan + row rules for an already-decoded value. Strings are plain values here (not re-parsed). */
function validateParsed(input: unknown): ValidateResult {
  const structural = scanStructure(input);
  if (structural) return { ok: false, errors: [structural] };
  if (!Array.isArray(input)) return { ok: false, errors: ['Input must be a JSON array of activity records.'] };
  if (input.length > LIMITS.maxRecords) return { ok: false, errors: [`Too many records: ${input.length.toLocaleString()} (limit ${LIMITS.maxRecords.toLocaleString()}).`] };
  const errors: string[] = []; const out: ActivityRecord[] = [];
  const seen = new Map<string, number>();
  input.forEach((raw: unknown, i: number) => {
    const p = `records[${i}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { errors.push(`${p}: must be an object.`); return; }
    const r = raw as Record<string, unknown>;
    const user = printable(errors, `${p}.user`, r.user);
    const dept = printable(errors, `${p}.dept`, r.dept);
    const day = calendarDay(errors, `${p}.day`, r.day);
    const logins = finite(errors, `${p}.logins`, r.logins, 0, LIMITS.maxCount);
    const uploadMB = finite(errors, `${p}.uploadMB`, r.uploadMB, 0, LIMITS.maxCount);
    const distinctHosts = finite(errors, `${p}.distinctHosts`, r.distinctHosts, 0, LIMITS.maxCount);
    const afterHoursPct = finite(errors, `${p}.afterHoursPct`, r.afterHoursPct, 0, 1);
    if (user !== undefined && day !== undefined) {
      const key = `${user}\u0000${day}`;
      const first = seen.get(key);
      if (first !== undefined) errors.push(`${p}: duplicate (user, day) row — ${JSON.stringify(user)} on ${day} already appears at records[${first}].`);
      else seen.set(key, i);
    }
    if (user !== undefined && dept !== undefined && day !== undefined && logins !== undefined && uploadMB !== undefined && distinctHosts !== undefined && afterHoursPct !== undefined) {
      out.push({ user, dept, day, logins, uploadMB, distinctHosts, afterHoursPct }); // unknown keys are dropped here
    }
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, LIMITS.maxErrors) };
  return { ok: true, records: out };
}

/** Printable: no control (Cc), format (Cf, e.g. zero-width space), surrogate, private-use or unassigned code points, no line/paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;
function printable(errors: string[], path: string, v: unknown): string | undefined {
  if (typeof v === 'string' && v.length >= 1 && v.length <= LIMITS.maxName && PRINTABLE.test(v)) return v;
  errors.push(`${path}: must be a printable string of 1–${LIMITS.maxName} characters.`);
  return undefined;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Strict calendar date: `YYYY-MM-DD` that round-trips through `Date.UTC` (so `2026-02-30` and `2026-04-31` are rejected). */
export function isCalendarDay(s: string): boolean {
  const m = DAY.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && dt.toISOString().slice(0, 10) === s;
}
function calendarDay(errors: string[], path: string, v: unknown): string | undefined {
  if (typeof v === 'string' && isCalendarDay(v)) return v;
  errors.push(`${path}: must be a real calendar date in YYYY-MM-DD form.`);
  return undefined;
}

function finite(errors: string[], path: string, v: unknown, min: number, max: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  errors.push(`${path}: must be a finite number between ${min} and ${max === 1e9 ? '1e9' : max}.`);
  return undefined;
}

/** True when the UTF-8 encoding of `s` is longer than `max` bytes; stops counting as soon as the cap is passed. */
function utf8LengthExceeds(s: string, max: number): boolean {
  if (s.length > max) return true; // UTF-8 never needs fewer bytes than UTF-16 code units
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
    if (n > max) return true;
  }
  return false;
}

/** Iterative depth/value scan: containers nested deeper than `maxDepth` or more than `maxValues` values are rejected. */
function scanStructure(root: unknown): string | null {
  const stack: { v: unknown; depth: number }[] = [{ v: root, depth: 0 }];
  let values = 0;
  while (stack.length) {
    const { v, depth } = stack.pop()!;
    if (++values > LIMITS.maxValues) return `Input has too many values (more than ${LIMITS.maxValues.toLocaleString()}).`;
    if (typeof v === 'object' && v !== null) {
      if (depth + 1 > LIMITS.maxDepth) return `Input nesting depth exceeds ${LIMITS.maxDepth} levels (expected an array of flat records).`;
      const children = Array.isArray(v) ? v : Object.values(v);
      for (const c of children) stack.push({ v: c, depth: depth + 1 });
    }
  }
  return null;
}
