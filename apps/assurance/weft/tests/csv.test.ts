import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { artifactsToCsvRows, findingsToCsvRows, toCsv } from '../src/engine/csv';
import { analyze } from '../src/engine/lineage';
import { validateBundle } from '../src/engine/validate';
import type { Artifact, Assertion, Bundle } from '../src/engine/types';

// Formula-safe CSV export of the findings ledger and the artifact table (October 2026 round). The neutralisation
// is the same as Tessera's: a cell that starts with = + - @ (even behind whitespace/control characters) or with a
// tab/CR is prefixed with an apostrophe; every cell is double-quoted (RFC 4180) and rows end with CRLF.
const h = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function assertion(p: Partial<Assertion> & { id: string }): Assertion {
  return { controlRef: 'CSF 2.0 PR.DS-11', statement: 'Backups are tested quarterly.', owner: 'platform.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30', ...p };
}
function artifact(p: Partial<Artifact> & { id: string }): Artifact {
  return { name: p.id + '.log', kind: 'log', capturedOn: '2026-08-15', content: 'content of ' + p.id, ...p };
}
function bundle(p: Partial<Bundle> = {}): Bundle {
  return { schema: 'weft.bundle/1', name: 'Test bundle', asOf: '2026-10-01', assertions: [], artifacts: [], links: [], signoffs: [], ...p };
}
/** Cells of one CSV line as written (each cell is quoted, so split on the quote-comma-quote seam). */
const cells = (line: string): string[] => line.slice(1, -1).split('","');

describe('toCsv — RFC 4180 with formula neutralisation', () => {
  it('quotes every cell, joins rows with CRLF and renders numbers as text', () => {
    expect(toCsv([['a', 'b'], ['1', 2]])).toBe('"a","b"\r\n"1","2"');
    expect(toCsv([])).toBe('');
  });
  it("prefixes cells starting with = + - @ with an apostrophe", () => {
    expect(toCsv([['=1+1', '+cmd', '-x', '@SUM(A1)', 'safe']])).toBe(`"'=1+1","'+cmd","'-x","'@SUM(A1)","safe"`);
  });
  it('neutralises formulas hidden behind leading spaces, tabs, carriage returns, newlines or NUL bytes', () => {
    for (const c of cells(toCsv([[' =HYPERLINK("x")', '\t=1+1', '\r=cmd', '  @SUM(A1)', '\u0000-1', '\n+1']]))) expect(c.startsWith(`'`)).toBe(true);
  });
  it('also prefixes cells that merely start with a tab or carriage return (spreadsheet field-separator tricks)', () => {
    expect(toCsv([['\tplain', '\rplain', ' plain']])).toBe(`"'\tplain","'\rplain"," plain"`);
  });
  it('escapes embedded quotes by doubling and keeps commas and newlines inside the quoted cell', () => {
    expect(toCsv([['say "hi"', 'a,b', 'line1\nline2']])).toBe(`"say ""hi""","a,b","line1\nline2"`);
  });
});

describe('findings ledger CSV', () => {
  it('has the documented header and one row per finding in ledger order (severity, kind, refs)', () => {
    const b = bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' }), artifact({ id: 'B', declaredSha256: '0'.repeat(64) })], links: [{ assertionId: 'S1', artifactId: 'B' }] });
    const issues = analyze(b).issues;
    const rows = findingsToCsvRows(issues);
    expect(rows[0]).toEqual(['kind', 'severity', 'refs', 'message']);
    expect(rows).toHaveLength(issues.length + 1);
    expect(rows.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual([
      ['hash-mismatch', 'high', 'B'],
      ['unsupported-assertion', 'high', 'S1'],
      ['orphan-artifact', 'medium', 'A'],
    ]);
    expect(rows[1][3]).toMatch(/computed SHA-256 differs/);
  });
  it('joins several refs with "; " and neutralises hostile ids that reach refs and messages', () => {
    const b = bundle({ artifacts: [artifact({ id: '=cmd', name: '-evil.log', content: 'same' }), artifact({ id: '+two', name: '@x', content: 'same' })] });
    const lines = toCsv(findingsToCsvRows(analyze(b).issues)).split('\r\n');
    expect(lines[0]).toBe('"kind","severity","refs","message"');
    expect(lines[1].startsWith(`"duplicate-content","medium","'=cmd; +two","'=cmd, +two have identical content`)).toBe(true);
    expect(lines.filter((l) => l.startsWith('"orphan-artifact"')).map((l) => cells(l)[2]).sort()).toEqual([`'+two`, `'=cmd`]);
    for (const l of lines) for (const c of cells(l)) expect(c).not.toMatch(/^[=+\-@]/);
  });
  it('fixture: every planted finding appears once, in ledger order, and the CSV line count matches', async () => {
    const demo = (await import('../src/fixtures/harbourline-bundle.json')).default;
    const r = validateBundle(JSON.stringify(demo));
    if (!r.ok) throw new Error('fixture invalid');
    const issues = analyze(r.value).issues;
    expect(issues).toHaveLength(11);
    expect(issues.filter((i) => i.severity === 'high')).toHaveLength(4);
    const rows = findingsToCsvRows(issues);
    expect(rows).toHaveLength(issues.length + 1);
    expect(rows.slice(1).map((x) => x[0])).toEqual(issues.map((i) => i.kind));
    // ledger order: severity, then kind, then refs — the four high findings lead
    expect(rows.slice(1, 5).map((x) => [x[0], x[2]])).toEqual([
      ['broken-link', 'AS-07; AR-01'],
      ['hash-mismatch', 'AR-05'],
      ['invalid-signoff', 'AS-02'],
      ['unsupported-assertion', 'AS-03'],
    ]);
    expect(toCsv(rows).split('\r\n')).toHaveLength(issues.length + 1);
  });
});

describe('artifact table CSV', () => {
  it('has the documented header, one row per artifact sorted by id, and yes / no / none declared for the hash check', () => {
    const b = bundle({
      assertions: [assertion({ id: 'S1' })],
      artifacts: [artifact({ id: 'B', declaredSha256: '0'.repeat(64) }), artifact({ id: 'A', content: 'same' }), artifact({ id: 'C', content: 'same', declaredSha256: h('same') })],
      links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'C' }],
    });
    const rows = artifactsToCsvRows(b, analyze(b));
    expect(rows[0]).toEqual(['id', 'name', 'kind', 'capturedOn', 'sha256', 'bytes', 'declaredMatches', 'duplicateOf', 'linkedAssertions']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['A', 'B', 'C']);
    const byId = (id: string) => rows.find((r) => r[0] === id)!;
    expect(byId('A')).toEqual(['A', 'A.log', 'log', '2026-08-15', h('same'), 4, 'none declared', 'C', 'S1']);
    expect(byId('B')).toEqual(['B', 'B.log', 'log', '2026-08-15', h('content of B'), 12, 'no', '', '']);
    expect(byId('C')).toEqual(['C', 'C.log', 'log', '2026-08-15', h('same'), 4, 'yes', 'A', 'S1']);
  });
  it('neutralises hostile ids and names and sorts by id regardless of bundle order', () => {
    const b = bundle({ artifacts: [artifact({ id: 'Z', name: '=HYPERLINK("x")' }), artifact({ id: '-A', name: 'ok' })] });
    const lines = toCsv(artifactsToCsvRows(b, analyze(b))).split('\r\n');
    expect(lines[1].startsWith(`"'-A","ok","log"`)).toBe(true);
    expect(lines[2].startsWith(`"Z","'=HYPERLINK(""x"")","log"`)).toBe(true);
  });
  it('fixture: ten rows in manifest order with the planted mismatch, duplicate and orphan visible; deterministic', async () => {
    const demo = (await import('../src/fixtures/harbourline-bundle.json')).default;
    const r = validateBundle(JSON.stringify(demo));
    if (!r.ok) throw new Error('fixture invalid');
    const rows = artifactsToCsvRows(r.value, analyze(r.value));
    expect(rows.slice(1).map((x) => x[0])).toEqual(Array.from({ length: 10 }, (_, i) => `AR-${String(i + 1).padStart(2, '0')}`));
    const byId = (id: string) => rows.find((x) => x[0] === id)!;
    expect(byId('AR-05')[6]).toBe('no');
    expect(byId('AR-09')[6]).toBe('none declared');
    expect(byId('AR-09')[8]).toBe('');
    expect(byId('AR-06')[7]).toBe('AR-07');
    expect(byId('AR-01')[8]).toBe('AS-01'); // the broken AS-07 link is not a known assertion and is not listed
    const again = artifactsToCsvRows(structuredClone(r.value), analyze(structuredClone(r.value)));
    expect(JSON.stringify(again)).toBe(JSON.stringify(rows));
  });
});
