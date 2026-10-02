import { describe, expect, it } from 'vitest';
import { csvCell, parseBoundedJson, toCsv, addDays, daysBetween, isIsoDate } from './safe';

describe('bounded JSON import', () => {
  it('rejects oversized input', () => {
    const r = parseBoundedJson('{"a":"' + 'x'.repeat(600 * 1024) + '"}');
    expect(r.ok).toBe(false);
  });
  it('rejects invalid JSON and non-object roots', () => {
    expect(parseBoundedJson('{nope').ok).toBe(false);
    expect(parseBoundedJson('[1,2]').ok).toBe(false);
    expect(parseBoundedJson('"str"').ok).toBe(false);
  });
  it('rejects deep nesting', () => {
    const deep = '{"a":'.repeat(12) + '1' + '}'.repeat(12);
    expect(parseBoundedJson(deep).ok).toBe(false);
  });
  it('rejects __proto__ keys', () => {
    expect(parseBoundedJson('{"__proto__":{"x":1}}').ok).toBe(false);
  });
  it('accepts a small object', () => {
    const r = parseBoundedJson('{"records":[{"id":"r1"}]}');
    expect(r.ok).toBe(true);
  });
});

describe('CSV export safety', () => {
  it('neutralises formula prefixes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('neutralises formula prefixes hidden behind whitespace or control characters', () => {
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell('\t@x')).toBe("'\t@x");
    expect(csvCell('\u0000=cmd')).toBe("'\u0000=cmd");
    expect(csvCell('\u200b-1')).toBe("'\u200b-1");
    expect(csvCell('plain text')).toBe('plain text');
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsv(['h'], [['x\ny']])).toBe('h\r\n"x\ny"\r\n');
  });
});

describe('date helpers', () => {
  it('rejects calendar-invalid dates that Date.parse would normalise', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-10-01')).toBe(true);
  });
  it('adds and diffs days', () => {
    expect(addDays('2026-01-30', 2)).toBe('2026-02-01');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
});
