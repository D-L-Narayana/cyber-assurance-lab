import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/engine/sha256';
import { analyze, bindingHash, buildManifest, canonical, diffBundles, manifestRoot, signOff, verifyManifest, SignoffError } from '../src/engine/lineage';
import { validateBundle, validateManifest, MAX_BUNDLE_BYTES } from '../src/engine/validate';
import type { Artifact, Assertion, Bundle } from '../src/engine/types';

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

describe('sha256 and canonical JSON', () => {
  it('matches node:crypto for several inputs', () => {
    for (const s of ['', 'abc', 'weft — ☃', 'x'.repeat(777)]) expect(sha256Hex(s)).toBe(h(s));
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});

describe('artifact analysis', () => {
  it('computes hashes and compares with declared hashes (null when none declared)', () => {
    const a = analyze(bundle({ artifacts: [artifact({ id: 'A', declaredSha256: h('content of A') }), artifact({ id: 'B', declaredSha256: 'deadbeef'.repeat(8) }), artifact({ id: 'C' })] }));
    const by = (id: string) => a.artifacts.find((x) => x.id === id)!;
    expect(by('A').declaredMatches).toBe(true);
    expect(by('B').declaredMatches).toBe(false);
    expect(by('C').declaredMatches).toBeNull();
    expect(a.issues.filter((i) => i.kind === 'hash-mismatch').map((i) => i.refs)).toEqual([['B']]);
  });
  it('detects duplicate content across different ids and names', () => {
    const a = analyze(bundle({ artifacts: [artifact({ id: 'A', content: 'same' }), artifact({ id: 'B', name: 'other.log', content: 'same' }), artifact({ id: 'C', content: 'diff' })] }));
    expect(a.artifacts.find((x) => x.id === 'A')!.duplicateOf).toEqual(['B']);
    expect(a.issues.filter((i) => i.kind === 'duplicate-content').length).toBe(1);
  });
  it('flags orphan artifacts and unsupported assertions', () => {
    const a = analyze(bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' })] }));
    expect(a.issues.some((i) => i.kind === 'orphan-artifact' && i.refs[0] === 'A')).toBe(true);
    expect(a.issues.some((i) => i.kind === 'unsupported-assertion' && i.refs[0] === 'S1')).toBe(true);
    expect(a.assertions[0].status).toBe('unsupported');
  });
  it('flags broken and duplicate links', () => {
    const a = analyze(bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' })], links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S9', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'Z' }] }));
    expect(a.issues.filter((i) => i.kind === 'broken-link').length).toBe(2);
    expect(a.issues.filter((i) => i.kind === 'duplicate-link').length).toBe(1);
    expect(a.cells['S9|A']).toBe('broken');
  });
});

describe('period and status', () => {
  it('artifacts captured outside the assertion period are out-of-period; an assertion with only such evidence is weak', () => {
    const a = analyze(bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'OLD', capturedOn: '2026-01-10' })], links: [{ assertionId: 'S1', artifactId: 'OLD' }] }));
    expect(a.assertions[0].status).toBe('weak');
    expect(a.assertions[0].outOfPeriod).toEqual(['OLD']);
    expect(a.cells['S1|OLD']).toBe('out-of-period');
    expect(a.issues.some((i) => i.kind === 'out-of-period')).toBe(true);
    expect(a.issues.some((i) => i.kind === 'weak-assertion')).toBe(true);
  });
  it('period boundaries are inclusive', () => {
    const a = analyze(bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A', capturedOn: '2026-07-01' }), artifact({ id: 'B', capturedOn: '2026-09-30' })], links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'B' }] }));
    expect(a.assertions[0].inPeriod).toEqual(['A', 'B']);
    expect(a.assertions[0].status).toBe('supported');
  });
  it('a hash-mismatched artifact cannot support an assertion (tainted)', () => {
    const a = analyze(bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A', declaredSha256: '0'.repeat(64) })], links: [{ assertionId: 'S1', artifactId: 'A' }] }));
    expect(a.assertions[0].status).toBe('unsupported');
    expect(a.assertions[0].tainted).toEqual(['A']);
    expect(a.cells['S1|A']).toBe('tainted');
  });
});

describe('binding hash and sign-off', () => {
  const base = () => bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' }), artifact({ id: 'B' })], links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'B' }] });

  it('binding hash depends on assertion text and the set of evidence hashes, not link order', () => {
    const b1 = base();
    const b2 = base();
    b2.links.reverse();
    expect(bindingHash(b1, 'S1')).toBe(bindingHash(b2, 'S1'));
    const b3 = base();
    b3.assertions[0].statement += '!';
    expect(bindingHash(b3, 'S1')).not.toBe(bindingHash(b1, 'S1'));
    const b4 = base();
    b4.artifacts[0].content = 'edited';
    expect(bindingHash(b4, 'S1')).not.toBe(bindingHash(b1, 'S1'));
  });
  it('signOff records a valid binding; later evidence edits invalidate it', () => {
    const signed = signOff(base(), 'S1', 'r.kaur', '2026-10-01');
    expect(analyze(signed).assertions[0].signoff).toMatchObject({ reviewer: 'r.kaur', valid: true });
    const tampered: Bundle = { ...signed, artifacts: signed.artifacts.map((a) => (a.id === 'A' ? { ...a, content: 'edited after sign-off' } : a)) };
    const an = analyze(tampered);
    expect(an.assertions[0].signoff!.valid).toBe(false);
    expect(an.issues.some((i) => i.kind === 'invalid-signoff' && i.refs.includes('S1'))).toBe(true);
  });
  it('adding or removing a linked artifact after sign-off also invalidates it', () => {
    const signed = signOff(base(), 'S1', 'r.kaur', '2026-10-01');
    const fewer: Bundle = { ...signed, links: signed.links.slice(0, 1) };
    expect(analyze(fewer).assertions[0].signoff!.valid).toBe(false);
  });
  it('refuses to sign weak or unsupported assertions and refuses double signing', () => {
    const weak = bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'OLD', capturedOn: '2025-01-01' })], links: [{ assertionId: 'S1', artifactId: 'OLD' }] });
    expect(() => signOff(weak, 'S1', 'r', '2026-10-01')).toThrow(SignoffError);
    expect(() => signOff(bundle({ assertions: [assertion({ id: 'S1' })] }), 'S1', 'r', '2026-10-01')).toThrow(/unsupported/);
    const once = signOff(base(), 'S1', 'r', '2026-10-01');
    expect(() => signOff(once, 'S1', 'r2', '2026-10-02')).toThrow(/already/);
    expect(() => signOff(base(), 'NOPE', 'r', '2026-10-01')).toThrow(/unknown/);
  });
  it('does not mutate the input bundle', () => {
    const b = base();
    const snap = JSON.stringify(b);
    signOff(b, 'S1', 'r', '2026-10-01');
    expect(JSON.stringify(b)).toBe(snap);
  });
});

describe('manifest and verification', () => {
  const base = () => bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'B' }), artifact({ id: 'A' })], links: [{ assertionId: 'S1', artifactId: 'A' }] });

  it('manifest entries are sorted by id with hash and byte length; root is a 64-hex digest independent of input order', () => {
    const m = buildManifest(base(), '2026-10-01');
    expect(m.entries.map((e) => e.id)).toEqual(['A', 'B']);
    expect(m.entries[0].bytes).toBe(new TextEncoder().encode('content of A').byteLength);
    expect(m.root).toMatch(/^[0-9a-f]{64}$/);
    const b2 = base();
    b2.artifacts.reverse();
    expect(buildManifest(b2, '2026-10-01').root).toBe(m.root);
  });
  it('verify reports intact for an unchanged bundle', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    expect(verifyManifest(b, m)).toEqual({ rootMatches: true, intact: true, modified: [], missing: [], added: [], bindingChanged: [], missingAssertions: [], addedAssertions: [], renamed: [], signoffsChanged: [], bundleNameChanged: false });
  });
  it('verify detects modified, missing and added artifacts and changed bindings', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const changed: Bundle = {
      ...b,
      artifacts: [...b.artifacts.filter((a) => a.id !== 'B').map((a) => ({ ...a, content: a.content + ' (edited)' })), artifact({ id: 'C' })],
    };
    const r = verifyManifest(changed, m);
    expect(r.intact).toBe(false);
    expect(r.rootMatches).toBe(true); // the manifest itself is self-consistent; it is the bundle that drifted
    expect(r.modified).toEqual(['A']);
    expect(r.missing).toEqual(['B']);
    expect(r.added).toEqual(['C']);
    expect(r.bindingChanged).toEqual(['S1']);
  });
  it('verify flags a manifest whose root does not match its own entries (tampered manifest)', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const forged = { ...m, entries: m.entries.map((e) => (e.id === 'A' ? { ...e, sha256: sha256Hex('content of A') } : e)), root: 'f'.repeat(64) };
    expect(verifyManifest(b, forged).rootMatches).toBe(false);
  });
});

describe('diff', () => {
  it('reports added, removed and changed artifacts, assertions and links', () => {
    const a = bundle({ assertions: [assertion({ id: 'S1' }), assertion({ id: 'S2' })], artifacts: [artifact({ id: 'A' }), artifact({ id: 'B' })], links: [{ assertionId: 'S1', artifactId: 'A' }] });
    const b = bundle({ assertions: [assertion({ id: 'S1', statement: 'changed' }), assertion({ id: 'S3' })], artifacts: [artifact({ id: 'A', content: 'new' }), artifact({ id: 'C' })], links: [{ assertionId: 'S1', artifactId: 'C' }] });
    expect(diffBundles(a, b)).toEqual({
      addedArtifacts: ['C'], removedArtifacts: ['B'], changedArtifacts: ['A'],
      addedAssertions: ['S3'], removedAssertions: ['S2'], changedAssertions: ['S1'],
      addedLinks: ['S1|C'], removedLinks: ['S1|A'],
    });
  });
});

describe('validation', () => {
  it('accepts a valid bundle and a valid manifest', () => {
    const b = bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' })], links: [{ assertionId: 'S1', artifactId: 'A' }] });
    expect(validateBundle(JSON.stringify(b)).ok).toBe(true);
    expect(validateManifest(JSON.stringify(buildManifest(b, '2026-10-01'))).ok).toBe(true);
  });
  it('rejects oversized (UTF-8), malformed, non-object and wrong-schema input', () => {
    expect(validateBundle('€'.repeat(Math.ceil(MAX_BUNDLE_BYTES / 3) + 1)).ok).toBe(false);
    expect(validateBundle('{').ok).toBe(false);
    expect(validateBundle('1').ok).toBe(false);
    expect(validateBundle(JSON.stringify({ ...bundle(), schema: 'x' })).ok).toBe(false);
    expect(validateManifest(JSON.stringify({ schema: 'weft.manifest/2', entries: 'no' })).ok).toBe(false);
  });
  it('rejects a period that ends before it starts, bad dates, bad declared hashes, unknown kinds and duplicate ids with paths', () => {
    const b = bundle({
      assertions: [assertion({ id: 'S1', periodStart: '2026-09-30', periodEnd: '2026-07-01' })],
      artifacts: [artifact({ id: 'A', capturedOn: '2026-13-01', declaredSha256: 'zz' }), artifact({ id: 'A', kind: 'pdf' as never })],
    });
    const r = validateBundle(JSON.stringify(b));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('assertions[0].periodEnd');
      expect(paths).toContain('artifacts[0].capturedOn');
      expect(paths).toContain('artifacts[0].declaredSha256');
      expect(paths).toContain('artifacts[1].kind');
      expect(paths).toContain('artifacts[1].id');
    }
  });
  it('rejects more than 300 artifacts or content over 50,000 characters', () => {
    expect(validateBundle(JSON.stringify(bundle({ artifacts: Array.from({ length: 301 }, (_, i) => artifact({ id: 'A' + i })) }))).ok).toBe(false);
    expect(validateBundle(JSON.stringify(bundle({ artifacts: [artifact({ id: 'A', content: 'x'.repeat(50_001) })] }))).ok).toBe(false);
  });
});

describe('bundled fixture', () => {
  it('validates and contains every planned defect kind', async () => {
    const demo = (await import('../src/fixtures/harbourline-bundle.json')).default;
    const r = validateBundle(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = analyze(r.value);
    const kinds = new Set(a.issues.map((i) => i.kind));
    for (const k of ['hash-mismatch', 'duplicate-content', 'orphan-artifact', 'unsupported-assertion', 'weak-assertion', 'broken-link', 'out-of-period', 'invalid-signoff']) expect(kinds.has(k as never)).toBe(true);
    expect(a.assertions.some((s) => s.status === 'supported' && s.signoff?.valid)).toBe(true);
  });
});

describe('parent review regressions — binding scope and added assertions', () => {
  const base = () => bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' }), artifact({ id: 'B' })], links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'B' }] });

  it('verify reports an assertion appended after the manifest was built (not intact)', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const appended: Bundle = { ...b, assertions: [...b.assertions, assertion({ id: 'S2', statement: 'Added later.' })] };
    const r = verifyManifest(appended, m);
    expect(r.intact).toBe(false);
    expect(r.addedAssertions).toEqual(['S2']);
  });

  it('verify reports an assertion removed after the manifest was built', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const r = verifyManifest({ ...b, assertions: [] }, m);
    expect(r.intact).toBe(false);
    expect(r.missingAssertions).toEqual(['S1']);
  });

  it('changing an artifact capturedOn after sign-off invalidates the sign-off (evidence metadata is bound)', () => {
    const signed = signOff(base(), 'S1', 'r.kaur', '2026-10-01');
    const moved: Bundle = { ...signed, artifacts: signed.artifacts.map((a) => (a.id === 'A' ? { ...a, capturedOn: '2026-01-05' } : a)) };
    const an = analyze(moved);
    expect(an.assertions[0].signoff!.valid).toBe(false);
    expect(an.assertions[0].outOfPeriod).toEqual(['A']); // support changed, so the binding must change too
  });

  it('renaming an artifact id (same content) after sign-off invalidates the sign-off', () => {
    const signed = signOff(base(), 'S1', 'r.kaur', '2026-10-01');
    const renamed: Bundle = {
      ...signed,
      artifacts: signed.artifacts.map((a) => (a.id === 'A' ? { ...a, id: 'A2' } : a)),
      links: signed.links.map((l) => (l.artifactId === 'A' ? { ...l, artifactId: 'A2' } : l)),
    };
    expect(analyze(renamed).assertions[0].signoff!.valid).toBe(false);
  });

  it('a manifest binding also changes when an artifact capturedOn changes', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const moved: Bundle = { ...b, artifacts: b.artifacts.map((a) => (a.id === 'B' ? { ...a, capturedOn: '2025-01-01' } : a)) };
    const r = verifyManifest(moved, m);
    expect(r.bindingChanged).toEqual(['S1']);
    expect(r.modified).toEqual([]); // content unchanged; only metadata moved
  });
});

describe('sixth-review regressions — the manifest root binds sign-offs and names', () => {
  const base = () => bundle({ assertions: [assertion({ id: 'S1' })], artifacts: [artifact({ id: 'A' }), artifact({ id: 'B' })], links: [{ assertionId: 'S1', artifactId: 'A' }, { assertionId: 'S1', artifactId: 'B' }] });
  const signedBase = () => signOff(base(), 'S1', 'r.kaur', '2026-10-01');

  it('manifest v2 carries the bundle name and a sorted sign-off list under the root', () => {
    const m = buildManifest(signedBase(), '2026-10-01');
    expect(m.schema).toBe('weft.manifest/2');
    expect(m.signoffs).toEqual([{ assertionId: 'S1', reviewer: 'r.kaur', signedOn: '2026-10-01', bindingHash: signedBase().signoffs[0].bindingHash }]);
    const tampered = { ...m, signoffs: [] };
    expect(manifestRoot(tampered)).not.toBe(m.root);
    expect(manifestRoot({ ...m, bundleName: 'other' })).not.toBe(m.root);
  });

  it('deleting a sign-off after the manifest was built is reported (external repro A)', () => {
    const b = signedBase();
    const m = buildManifest(b, '2026-10-01');
    const r = verifyManifest({ ...b, signoffs: [] }, m);
    expect(r.intact).toBe(false);
    expect(r.signoffsChanged).toEqual(['S1']);
  });

  it('swapping the reviewer or back-dating a sign-off is reported (external repro B)', () => {
    const b = signedBase();
    const m = buildManifest(b, '2026-10-01');
    const swapped = { ...b, signoffs: b.signoffs.map((s) => ({ ...s, reviewer: 'mallory' })) };
    expect(verifyManifest(swapped, m)).toMatchObject({ intact: false, signoffsChanged: ['S1'] });
    const backdated = { ...b, signoffs: b.signoffs.map((s) => ({ ...s, signedOn: '2020-01-01' })) };
    expect(verifyManifest(backdated, m)).toMatchObject({ intact: false, signoffsChanged: ['S1'] });
  });

  it('a sign-off added after the manifest was built is reported', () => {
    const b = base();
    const m = buildManifest(b, '2026-10-01');
    const r = verifyManifest(signOff(b, 'S1', 'r.kaur', '2026-10-02'), m);
    expect(r.intact).toBe(false);
    expect(r.signoffsChanged).toEqual(['S1']);
  });

  it('renaming an artifact display name after the manifest was built is reported (external repro C)', () => {
    const b = signedBase();
    const m = buildManifest(b, '2026-10-01');
    const renamed = { ...b, artifacts: b.artifacts.map((a) => (a.id === 'A' ? { ...a, name: 'renamed-evidence.txt' } : a)) };
    const r = verifyManifest(renamed, m);
    expect(r.intact).toBe(false);
    expect(r.renamed).toEqual(['A']);
  });

  it('changing the bundle name is reported; an untouched signed bundle stays intact', () => {
    const b = signedBase();
    const m = buildManifest(b, '2026-10-01');
    expect(verifyManifest({ ...b, name: 'Different bundle' }, m)).toMatchObject({ intact: false, bundleNameChanged: true });
    expect(verifyManifest(b, m).intact).toBe(true);
  });

  it('the validator accepts manifest v2 and refuses v1 with a clear path message', () => {
    const m = buildManifest(signedBase(), '2026-10-01');
    expect(validateManifest(JSON.stringify(m)).ok).toBe(true);
    const v1 = validateManifest(JSON.stringify({ ...m, schema: 'weft.manifest/1' }));
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.issues.some((i) => i.path === 'schema' && /weft\.manifest\/2/.test(i.message))).toBe(true);
    const bad = validateManifest(JSON.stringify({ ...m, signoffs: [{ assertionId: 'S1', reviewer: '', signedOn: 'nope', bindingHash: 'zz' }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['signoffs[0].reviewer', 'signoffs[0].signedOn', 'signoffs[0].bindingHash']));
  });
});
