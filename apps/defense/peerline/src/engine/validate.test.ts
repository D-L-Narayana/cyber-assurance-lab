import { describe, it, expect } from 'vitest';
import { validateRecords, parseRecords, LIMITS } from './validate';
import type { ActivityRecord } from './ueba';

const rec = (user: string, day: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({ user, dept: 'finance', day, logins: 4, uploadMB: 20, distinctHosts: 3, afterHoursPct: 0.05, ...over });
const errorsOf = (v: ReturnType<typeof validateRecords>) => (v.ok ? [] : v.errors).join('\n');

describe('bounded record import', () => {
  it('parseRecords enforces the byte cap before JSON.parse and reports invalid JSON', () => {
    const bad = parseRecords('[');
    expect(bad.ok).toBe(false);
    expect(errorsOf(bad)).toMatch(/JSON/);
    const multibyte = '"' + 'é'.repeat(LIMITS.maxBytes / 2 + 16) + '"'; // fewer characters than the cap, more bytes
    expect(multibyte.length).toBeLessThan(LIMITS.maxBytes);
    const big = parseRecords(multibyte);
    expect(big.ok).toBe(false);
    expect(errorsOf(big)).toMatch(/bytes/i);
    const ok = parseRecords(JSON.stringify([rec('ada.example', '2026-09-01')]));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.records).toEqual([rec('ada.example', '2026-09-01')]);
    expect(validateRecords(JSON.stringify([rec('u', '2026-09-01')])).ok).toBe(true); // text is accepted on the same entry point
    // Text is decoded exactly once: a JSON string literal that itself contains a record array is rejected, not re-parsed.
    const wrapped = parseRecords(JSON.stringify(JSON.stringify([rec('u', '2026-09-01')])));
    expect(wrapped.ok).toBe(false);
    expect(errorsOf(wrapped)).toMatch(/array/);
  });

  it('rejects nesting deeper than the record shape and oversized value counts without recursing', () => {
    const deep = parseRecords('['.repeat(4000) + ']'.repeat(4000));
    expect(deep.ok).toBe(false);
    expect(errorsOf(deep)).toMatch(/depth/i);
    const nestedField = [{ ...rec('u', '2026-09-01'), extra: { a: { b: { c: 1 } } } }];
    expect(validateRecords(nestedField).ok).toBe(false);
    expect(LIMITS.maxDepth).toBe(3);
  });

  it('rejects impossible calendar days such as 2026-02-30 and accepts a real leap day', () => {
    const feb30 = validateRecords([rec('u', '2026-02-30')]);
    expect(feb30.ok).toBe(false);
    expect(errorsOf(feb30)).toMatch(/records\[0\]\.day/);
    expect(validateRecords([rec('u', '2026-04-31')]).ok).toBe(false);
    expect(validateRecords([rec('u', '2026-13-01')]).ok).toBe(false);
    expect(validateRecords([rec('u', '2026-02-29')]).ok).toBe(false);
    expect(validateRecords([rec('u', '2028-02-29')]).ok).toBe(true);
  });

  it('rejects duplicate (user, day) rows naming both row indices', () => {
    const v = validateRecords([rec('ada.example', '2026-09-01'), rec('bram.example', '2026-09-01'), rec('ada.example', '2026-09-01')]);
    expect(v.ok).toBe(false);
    expect(errorsOf(v)).toMatch(/records\[2\].*records\[0\]/);
    expect(errorsOf(v)).toMatch(/duplicate/i);
    expect(validateRecords([rec('ada.example', '2026-09-01'), rec('ada.example', '2026-09-02')]).ok).toBe(true);
  });

  it('restricts user and dept to printable characters', () => {
    expect(validateRecords([rec('ada\u0000.example', '2026-09-01')]).ok).toBe(false);
    expect(validateRecords([rec('ada​.example', '2026-09-01')]).ok).toBe(false); // zero-width space (format character)
    const dept = validateRecords([rec('ada.example', '2026-09-01', { dept: 'fin\nance' })]);
    expect(dept.ok).toBe(false);
    expect(errorsOf(dept)).toMatch(/records\[0\]\.dept/);
    expect(validateRecords([rec('josé.example', '2026-09-01', { dept: 'R&D — platform' })]).ok).toBe(true);
  });

  it('addresses every error by path, requires finite numbers, drops unknown keys and caps the list at 20', () => {
    const v = validateRecords([{ ...rec('u', '2026-09-01'), logins: Number.POSITIVE_INFINITY, afterHoursPct: Number.NaN } as unknown]);
    expect(v.ok).toBe(false);
    expect(errorsOf(v)).toMatch(/records\[0\]\.logins/);
    expect(errorsOf(v)).toMatch(/records\[0\]\.afterHoursPct/);
    const clean = validateRecords([{ ...rec('u', '2026-09-01'), extra: 'dropped' } as unknown]);
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(Object.keys(clean.records[0]).sort()).toEqual(['afterHoursPct', 'day', 'dept', 'distinctHosts', 'logins', 'uploadMB', 'user']);
    const many = validateRecords(Array.from({ length: 40 }, (_, i) => ({ ...rec('u', '2026-09-01'), logins: -1 - i })));
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors).toHaveLength(20);
  });
});
