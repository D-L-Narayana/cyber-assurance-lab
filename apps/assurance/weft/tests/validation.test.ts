import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManifest } from '../src/engine/lineage';
import { MAX_BUNDLE_BYTES, isIsoDate, validateBundle, validateManifest } from '../src/engine/validate';
import type { Artifact, Assertion, Bundle } from '../src/engine/types';

// Validation audit (October 2026 round): strict calendar dates in every date field and hostile nesting.
function assertion(p: Partial<Assertion> & { id: string }): Assertion {
  return { controlRef: 'CSF 2.0 PR.DS-11', statement: 'Backups are tested quarterly.', owner: 'platform.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30', ...p };
}
function artifact(p: Partial<Artifact> & { id: string }): Artifact {
  return { name: p.id + '.log', kind: 'log', capturedOn: '2026-08-15', content: 'content of ' + p.id, ...p };
}
function bundle(p: Partial<Bundle> = {}): Bundle {
  return { schema: 'weft.bundle/1', name: 'Test bundle', asOf: '2026-10-01', assertions: [], artifacts: [], links: [], signoffs: [], ...p };
}
const signed = (): Bundle =>
  bundle({
    assertions: [assertion({ id: 'S1' })],
    artifacts: [artifact({ id: 'A' })],
    links: [{ assertionId: 'S1', artifactId: 'A' }],
    signoffs: [{ assertionId: 'S1', reviewer: 'r.kaur', signedOn: '2026-09-01', bindingHash: 'a'.repeat(64) }],
  });
const pathsOf = (r: { ok: true } | { ok: false; issues: { path: string }[] }): string[] => (r.ok ? [] : r.issues.map((i) => i.path));

describe('validation audit — strict calendar dates', () => {
  it('rejects 2026-02-30 in asOf, periodStart, periodEnd, capturedOn and signedOn with the exact path', () => {
    const cases: [(b: Bundle) => void, string][] = [
      [(b) => { b.asOf = '2026-02-30'; }, 'asOf'],
      [(b) => { b.assertions[0].periodStart = '2026-02-30'; }, 'assertions[0].periodStart'],
      [(b) => { b.assertions[0].periodEnd = '2026-02-30'; }, 'assertions[0].periodEnd'],
      [(b) => { b.artifacts[0].capturedOn = '2026-02-30'; }, 'artifacts[0].capturedOn'],
      [(b) => { b.signoffs[0].signedOn = '2026-02-30'; }, 'signoffs[0].signedOn'],
    ];
    for (const [mutate, path] of cases) {
      const b = signed();
      mutate(b);
      const r = validateBundle(JSON.stringify(b));
      expect(r.ok, path).toBe(false);
      expect(pathsOf(r), path).toContain(path);
      if (!r.ok) expect(r.issues.find((i) => i.path === path)!.message).toMatch(/ISO date/);
    }
    expect(validateBundle(JSON.stringify(signed())).ok).toBe(true);
  });

  it('rejects other impossible or malformed dates and accepts real leap days', () => {
    for (const bad of ['2026-04-31', '2027-02-29', '2026-00-10', '2026-13-01', '2026-1-01', '20260101', '2026-02-30T00:00:00Z', '', 'yesterday']) expect(isIsoDate(bad), bad).toBe(false);
    for (const good of ['2028-02-29', '2024-02-29', '2026-12-31', '2000-01-01']) expect(isIsoDate(good), good).toBe(true);
    expect(isIsoDate(20260101)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('the shipped sample qa/samples/invalid-bundle-calendar-date.json is rejected with exactly the three date paths', () => {
    // Kept in the repository so the import-rejection path can be exercised through the UI with a committed file.
    const text = readFileSync(resolve(process.cwd(), 'qa/samples/invalid-bundle-calendar-date.json'), 'utf8');
    const r = validateBundle(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => `${i.path} — ${i.message}`)).toEqual([
        'assertions[0].periodStart — must be an ISO date (YYYY-MM-DD)',
        'artifacts[0].capturedOn — must be an ISO date (YYYY-MM-DD)',
        'signoffs[0].signedOn — must be an ISO date (YYYY-MM-DD)',
      ]);
    }
  });

  it('rejects calendar-invalid dates in manifests too (generatedOn, signoffs[].signedOn)', () => {
    const m = buildManifest(signed(), '2026-10-01');
    expect(validateManifest(JSON.stringify(m)).ok).toBe(true);
    expect(pathsOf(validateManifest(JSON.stringify({ ...m, generatedOn: '2026-02-30' })))).toContain('generatedOn');
    expect(pathsOf(validateManifest(JSON.stringify({ ...m, signoffs: [{ ...m.signoffs[0], signedOn: '2026-11-31' }] })))).toContain('signoffs[0].signedOn');
  });
});

describe('validation audit — hostile nesting (20 000 levels)', () => {
  const DEPTH = 20_000;

  it('a 20 000-deep array at the root is refused as "not an object" without throwing', () => {
    const text = '['.repeat(DEPTH) + ']'.repeat(DEPTH);
    expect(text.length).toBeLessThan(MAX_BUNDLE_BYTES);
    const r = validateBundle(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/must be a JSON object/);
    const m = validateManifest(text);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.issues[0].message).toMatch(/must be a JSON object/);
  });

  it('20 000-deep nesting inside fields is reported at the field path (the validator never descends into unknown structure)', () => {
    const deepObject = '{"a":'.repeat(DEPTH) + '1' + '}'.repeat(DEPTH);
    const deepArray = '['.repeat(DEPTH) + ']'.repeat(DEPTH);
    const text = `{"schema":"weft.bundle/1","name":"x","asOf":"2026-10-01","assertions":[{"id":${deepObject},"controlRef":"c","statement":"s","periodStart":"2026-07-01","periodEnd":"2026-09-30"}],"artifacts":${deepArray},"links":${deepObject},"signoffs":[]}`;
    expect(text.length).toBeLessThan(MAX_BUNDLE_BYTES);
    const r = validateBundle(text);
    expect(r.ok).toBe(false);
    const paths = pathsOf(r);
    expect(paths).toContain('assertions[0].id');
    expect(paths).toContain('artifacts[0].id');
    expect(paths).toContain('links');
    const manifest = `{"schema":"weft.manifest/2","bundleName":"x","generatedOn":"2026-10-01","entries":${deepArray},"bindings":[],"signoffs":[],"root":"${'a'.repeat(64)}"}`;
    const m = validateManifest(manifest);
    expect(m.ok).toBe(false);
    expect(pathsOf(m)).toContain('entries[0].id');
  });
});
