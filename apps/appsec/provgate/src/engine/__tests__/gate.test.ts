import { describe, expect, it } from 'vitest';
import rel140 from '../../fixtures/release-1.4.0.json';
import rel141 from '../../fixtures/release-1.4.1.json';
import policyFixture from '../../fixtures/policy-default.json';
import { parseManifest, parsePolicy, validateManifest, validatePolicy, LIMITS } from '../schema';
import { classifyChanges, globToRegExp } from '../classify';
import { evaluateRelease } from '../gate';
import { buildBundle, sha256Hex } from '../bundle';
import type { Manifest, Policy } from '../types';

const manifest = (raw: unknown): Manifest => {
  const r = validateManifest(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.manifest;
};
const policy = (): Policy => {
  const r = validatePolicy(policyFixture);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.policy;
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('schema validation', () => {
  it('accepts both synthetic releases and the default policy', () => {
    expect(validateManifest(rel140).ok).toBe(true);
    expect(validateManifest(rel141).ok).toBe(true);
    expect(validatePolicy(policyFixture).ok).toBe(true);
  });
  it('rejects malformed JSON, oversized text and over-limit evidence lists', () => {
    expect(parseManifest('nope').ok).toBe(false);
    expect(parsePolicy('{').ok).toBe(false);
    expect(parseManifest(JSON.stringify(rel140) + ' '.repeat(LIMITS.maxBytes)).ok).toBe(false);
    const big = clone(rel140);
    big.evidence = Array.from({ length: LIMITS.maxEvidence + 1 }, (_, i) => ({ ...big.evidence[0], id: `e${i}` }));
    expect(validateManifest(big).ok).toBe(false);
  });
  it('rejects unknown identity references and invalid timestamps', () => {
    const bad = clone(rel140);
    bad.evidence[1].reviewers = ['ghost'];
    bad.release.createdAt = 'yesterday';
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/ghost/);
  });
  it('rejects a policy whose change class references an unknown evidence type', () => {
    const bad = clone(policyFixture);
    bad.changeClasses[0].requires = ['vibes'];
    expect(validatePolicy(bad).ok).toBe(false);
  });
});

describe('change classification', () => {
  it('matches ** across segments and * within one segment', () => {
    expect(globToRegExp('auth/**').test('auth/session.ts')).toBe(true);
    expect(globToRegExp('auth/**').test('web/auth.ts')).toBe(false);
    expect(globToRegExp('db/**/*.sql').test('db/migrations/0004_add_index.sql')).toBe(true);
    expect(globToRegExp('*.json').test('nested/package.json')).toBe(false);
    expect(globToRegExp('**/package-lock.json').test('services/api/package-lock.json')).toBe(true);
  });
  it('derives required evidence as baseline plus matched classes with the strictest reviewer count', () => {
    const req = classifyChanges(manifest(rel140), policy());
    expect(req.classes.map((c) => c.id).sort()).toEqual(['authentication', 'dependencies']);
    expect(req.required).toEqual(expect.arrayContaining(['code-review', 'unit-tests', 'secret-scan', 'threat-model', 'sast', 'security-retest', 'dependency-review']));
    expect(req.minReviewers).toBe(2);
  });
});

describe('gate evaluation — vulnerable release 1.4.0', () => {
  it('blocks and names each weak-evidence state', async () => {
    const ev = await evaluateRelease(manifest(rel140), policy());
    expect(ev.verdict).toBe('blocked');
    const states = Object.fromEntries(ev.requirements.map((r) => [r.type, r.problems.map((p) => p.code).sort()]));
    expect(states['threat-model']).toEqual(expect.arrayContaining(['stale', 'scope-gap']));
    expect(states['code-review']).toEqual(expect.arrayContaining(['self-review', 'insufficient-reviewers']));
    expect(states['unit-tests']).toContain('hash-mismatch');
    expect(states['sast']).toContain('wrong-commit');
    expect(states['security-retest']).toContain('missing');
    expect(states['secret-scan']).toEqual([]);
  });
  it('treats an expired acceptance as no acceptance', async () => {
    const ev = await evaluateRelease(manifest(rel140), policy());
    const dep4 = ev.findings.find((f) => f.id === 'DEP-4')!;
    expect(dep4.blocking).toBe(true);
    expect(dep4.acceptance?.problems.map((p) => p.code)).toContain('expired');
    const sast17 = ev.findings.find((f) => f.id === 'SAST-17')!;
    expect(sast17.blocking).toBe(true);
    expect(sast17.acceptance).toBeUndefined();
  });
});

describe('gate evaluation — remediated release 1.4.1', () => {
  it('releases with accepted risk and no requirement problems', async () => {
    const ev = await evaluateRelease(manifest(rel141), policy());
    expect(ev.requirements.every((r) => r.problems.length === 0)).toBe(true);
    expect(ev.verdict).toBe('release-with-accepted-risk');
    expect(ev.findings.find((f) => f.id === 'DEP-4')?.blocking).toBe(false);
    expect(ev.findings.find((f) => f.id === 'DEP-5')?.blocking).toBe(false);
  });
  it('marks evidence without an inline artifact as unverified rather than failed', async () => {
    const ev = await evaluateRelease(manifest(rel141), policy());
    const review = ev.requirements.find((r) => r.type === 'code-review')!;
    expect(review.hashStatus).toBe('unverified');
    const tests = ev.requirements.find((r) => r.type === 'unit-tests')!;
    expect(tests.hashStatus).toBe('verified');
  });
});

describe('bypass attempts', () => {
  it('rejects an acceptance approved by the release author even with the security role', async () => {
    const m = clone(rel141);
    m.identities.find((i: { id: string }) => i.id === 'dev-priya')!.roles.push('security');
    m.acceptances[0].approvedBy = 'dev-priya';
    const ev = await evaluateRelease(manifest(m), policy());
    expect(ev.verdict).toBe('blocked');
    expect(ev.findings.find((f) => f.id === 'DEP-4')?.acceptance?.problems.map((p) => p.code)).toContain('approver-is-author');
  });
  it('rejects an acceptance longer than the policy maximum or approved by a non-security identity', async () => {
    const long = clone(rel141);
    long.acceptances[0].expiresAt = '2027-09-20T00:00:00Z';
    const ev1 = await evaluateRelease(manifest(long), policy());
    expect(ev1.findings.find((f) => f.id === 'DEP-4')?.acceptance?.problems.map((p) => p.code)).toContain('too-long');
    const wrongRole = clone(rel141);
    wrongRole.acceptances[0].approvedBy = 'rm-joe';
    const ev2 = await evaluateRelease(manifest(wrongRole), policy());
    expect(ev2.findings.find((f) => f.id === 'DEP-4')?.acceptance?.problems.map((p) => p.code)).toContain('approver-role');
  });
  it('counts duplicate reviewer identities once and rejects reviewers without the reviewer role', async () => {
    const m = clone(rel141);
    m.evidence[1].reviewers = ['rev-ana', 'rev-ana', 'rm-joe'];
    const ev = await evaluateRelease(manifest(m), policy());
    const codes = ev.requirements.find((r) => r.type === 'code-review')!.problems.map((p) => p.code);
    expect(codes).toContain('insufficient-reviewers');
    expect(codes).toContain('reviewer-role');
  });
  it('rejects evidence dated after the as-of time', async () => {
    const m = clone(rel141);
    m.evidence[2].producedAt = '2026-10-05T00:00:00Z';
    const ev = await evaluateRelease(manifest(m), policy());
    expect(ev.requirements.find((r) => r.type === 'unit-tests')!.problems.map((p) => p.code)).toContain('future-dated');
  });
  it('prefers the strongest candidate when several pieces of evidence share a type', async () => {
    const m = clone(rel141);
    m.evidence.push({ ...m.evidence[2], id: 'ev-ut-old', commit: 'a1b2c3d', producedAt: '2026-06-01T00:00:00Z' });
    const ev = await evaluateRelease(manifest(m), policy());
    const tests = ev.requirements.find((r) => r.type === 'unit-tests')!;
    expect(tests.evidenceId).toBe('ev-ut-141');
    expect(tests.problems).toEqual([]);
    expect(tests.alternatives).toContain('ev-ut-old');
  });
  it('is sensitive to the as-of date: the same evidence goes stale', async () => {
    const ev = await evaluateRelease(manifest(rel141), policy(), { asOf: '2026-12-01T00:00:00Z' });
    expect(ev.verdict).toBe('blocked');
    expect(ev.requirements.find((r) => r.type === 'threat-model')!.problems.map((p) => p.code)).toContain('stale');
    expect(ev.findings.find((f) => f.id === 'DEP-4')?.acceptance?.problems.map((p) => p.code)).toContain('expired');
  });
});

describe('bundle export', () => {
  it('computes SHA-256 correctly and stamps a reproducible content digest', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const m = manifest(rel141);
    const ev = await evaluateRelease(m, policy());
    const a = await buildBundle(m, policy(), ev, '2026-10-01T00:00:00.000Z');
    const b = await buildBundle(m, policy(), ev, '2026-10-01T00:00:00.000Z');
    expect(a.schema).toBe('provgate.bundle/1');
    expect(a.digest).toBe(b.digest);
    expect(a.digestNote).toMatch(/not a signature/i);
    const tampered = { ...a, evaluation: { ...a.evaluation, verdict: 'release' } };
    expect(await sha256Hex(JSON.stringify({ ...tampered, digest: undefined, digestNote: undefined }))).not.toBe(a.digest);
  });
});

describe('sixth-review regressions — acceptance order and scope omission', () => {
  const expiredFirst = () => { const m = clone(rel141); m.acceptances = [{ ...m.acceptances[0], id: 'ra-old', approvedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' }, ...m.acceptances]; return m; };
  const validFirst = () => { const m = clone(rel141); m.acceptances = [...m.acceptances, { ...m.acceptances[0], id: 'ra-old', approvedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' }]; return m; };
  it('chooses a valid acceptance regardless of list order and warns about the duplicate', async () => {
    const a = await evaluateRelease(manifest(expiredFirst()), policy());
    const b = await evaluateRelease(manifest(validFirst()), policy());
    expect(a.verdict).toBe('release-with-accepted-risk');
    expect(b.verdict).toBe('release-with-accepted-risk');
    expect(a.findings.find((f) => f.id === 'DEP-4')?.acceptance?.id).toBe('ra-2');
    expect(a.warnings.join(' ')).toMatch(/DEP-4 has 2 acceptances/);
  });
  it('reports the least-broken acceptance when none is valid', async () => {
    const m = clone(rel141);
    m.acceptances = [{ ...m.acceptances[0], id: 'ra-bad', approvedBy: 'rm-joe', expiresAt: '2026-02-01T00:00:00Z' }, { ...m.acceptances[0], id: 'ra-exp', expiresAt: '2026-09-25T00:00:00Z' }];
    const ev = await evaluateRelease(manifest(m), policy());
    expect(ev.verdict).toBe('blocked');
    expect(ev.findings.find((f) => f.id === 'DEP-4')?.acceptance?.id).toBe('ra-exp');
  });
  it('fails closed when class-required evidence omits scope', async () => {
    const m = clone(rel141);
    for (const e of m.evidence) delete e.scope;
    const ev = await evaluateRelease(manifest(m), policy());
    expect(ev.verdict).toBe('blocked');
    const codes = ev.requirements.find((r) => r.type === 'threat-model')!.problems.map((p) => p.code);
    expect(codes).toContain('scope-missing');
    // Baseline-only types do not need scope: they cover the whole release by definition.
    expect(ev.requirements.find((r) => r.type === 'secret-scan')!.problems).toEqual([]);
  });
  it('still releases 1.4.1 when scope is present on every class-required item (fixture contract)', async () => {
    const ev = await evaluateRelease(manifest(rel141), policy());
    expect(ev.verdict).toBe('release-with-accepted-risk');
    expect(ev.blockers).toEqual([]);
  });
  it('1.4.0 has exactly 7 blockers carrying 8 problem codes', async () => {
    const ev = await evaluateRelease(manifest(rel140), policy());
    expect(ev.blockers).toHaveLength(7);
    const codes = ev.requirements.flatMap((r) => r.problems.map((p) => p.code));
    expect(new Set(codes).size).toBeGreaterThanOrEqual(8);
  });
});
