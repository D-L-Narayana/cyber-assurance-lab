import { describe, expect, it } from 'vitest';
import rel140 from '../../fixtures/release-1.4.0.json';
import rel141 from '../../fixtures/release-1.4.1.json';
import policyFixture from '../../fixtures/policy-default.json';
import { validateManifest, validatePolicy } from '../schema';
import { evaluateRelease } from '../gate';
import { buildBundle, bundleToMarkdown } from '../bundle';
import { ACTION_SUMMARY, remediationFor } from '../remediation';
import type { AcceptanceProblemCode, Manifest, Policy, ProblemCode } from '../types';

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

// Type-level exhaustiveness: `tsc` (run by `npm run build`) rejects this literal as soon as a code is added to
// ProblemCode or AcceptanceProblemCode without appearing here, so the runtime checks below can never silently skip
// a code. The value is a word the generic action for that code must contain.
const EXPECTED_WORD: Record<ProblemCode | AcceptanceProblemCode, string> = {
  missing: 'produce',
  stale: 're-run',
  'future-dated': 'producedAt',
  'wrong-commit': 'commit',
  'hash-mismatch': 'artifactHash',
  failed: 'pass',
  'self-review': 'author',
  'insufficient-reviewers': 'reviewer',
  'reviewer-role': 'role',
  'scope-gap': 'scope',
  'scope-missing': 'scope',
  expired: 'renew',
  'not-yet-effective': 'approvedAt',
  'too-long': 'window',
  'approver-role': 'role',
  'approver-is-author': 'author',
  'unknown-finding': 'retire',
};
const ALL_CODES = Object.keys(EXPECTED_WORD).sort() as (ProblemCode | AcceptanceProblemCode)[];

describe('remediation checklist', () => {
  it('has a generic action for every problem and acceptance-problem code', () => {
    expect(Object.keys(ACTION_SUMMARY).sort()).toEqual(ALL_CODES);
    for (const code of ALL_CODES) {
      expect(ACTION_SUMMARY[code].length, code).toBeGreaterThan(30);
      expect(ACTION_SUMMARY[code], code).toMatch(new RegExp(EXPECTED_WORD[code], 'i'));
    }
  });

  it('turns every problem in the 1.4.0 evaluation into a concrete, policy-aware action', async () => {
    const m = manifest(rel140);
    const p = policy();
    const ev = await evaluateRelease(m, p);
    const items = remediationFor(ev, { policy: p, manifest: m });

    const requirementProblems = ev.requirements.flatMap((r) => r.problems.map((x) => x.code));
    const acceptanceProblems = ev.findings.flatMap((f) => f.acceptance?.problems.map((x) => x.code) ?? []);
    const unaccepted = ev.findings.filter((f) => f.blocking && !f.acceptance);
    expect(requirementProblems.length).toBeGreaterThanOrEqual(8);
    for (const code of new Set([...requirementProblems, ...acceptanceProblems])) expect(items.some((i) => i.code === code), code).toBe(true);
    expect(items).toHaveLength(requirementProblems.length + acceptanceProblems.length + unaccepted.length);
    for (const i of items) {
      expect(i.target.length).toBeGreaterThan(0);
      expect(i.action.length).toBeGreaterThan(30);
    }

    const stale = items.find((i) => i.code === 'stale')!;
    expect(stale.target).toMatch(/threat-model/);
    expect(stale.target).toMatch(/ev-tm-3/);
    expect(stale.action).toMatch(/re-run threat-model against commit a1b2c3d/i);
    expect(stale.action).toMatch(/30 days/);

    const wrong = items.find((i) => i.code === 'wrong-commit')!;
    expect(wrong.target).toMatch(/sast/);
    expect(wrong.action).toMatch(/a1b2c3d/);
    expect(wrong.action).not.toMatch(/9f8e7d6 \(the release commit\)/);

    const missing = items.find((i) => i.code === 'missing')!;
    expect(missing.target).toMatch(/security-retest/);
    expect(missing.action).toMatch(/a1b2c3d/);
    expect(missing.action).toMatch(/authentication/);

    const reviewers = items.find((i) => i.code === 'insufficient-reviewers')!;
    expect(reviewers.action).toMatch(/2 distinct/);
    expect(reviewers.action).toMatch(/"reviewer"/);

    const selfReview = items.find((i) => i.code === 'self-review')!;
    expect(selfReview.action).toMatch(/dev-priya/);

    const scopeGap = items.find((i) => i.code === 'scope-gap')!;
    expect(scopeGap.action).toMatch(/auth\/session\.ts/);

    const expired = items.find((i) => i.code === 'expired')!;
    expect(expired.target).toMatch(/DEP-4/);
    expect(expired.target).toMatch(/ra-1/);
    expect(expired.action).toMatch(/90 days/);
    expect(expired.action).toMatch(/"security"/);

    const open = items.find((i) => i.code === 'no-acceptance')!;
    expect(open.target).toMatch(/SAST-17/);
    expect(open.action).toMatch(/"security"/);
    expect(open.action).toMatch(/90 days/);
    // The finding came from evidence ev-sast-61; the action must name the evidence *type*, not the id stem.
    expect(open.action).toMatch(/record it as fixed in new sast evidence for the release commit/);
    expect(open.action).not.toMatch(/-type evidence/);
  });

  it('is empty for the clean 1.4.1 evaluation and surfaces acceptances that reference unknown findings', async () => {
    const p = policy();
    const clean = manifest(rel141);
    expect(remediationFor(await evaluateRelease(clean, p), { policy: p, manifest: clean })).toEqual([]);
    const m = clone(rel141);
    m.acceptances.push({ ...m.acceptances[0], id: 'ra-ghost', findingRef: 'GHOST-1' });
    const ghost = manifest(m);
    const ev = await evaluateRelease(ghost, p);
    expect(ev.verdict).toBe('release-with-accepted-risk');
    const items = remediationFor(ev, { policy: p, manifest: ghost });
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('unknown-finding');
    expect(items[0].target).toMatch(/ra-ghost/);
    expect(items[0].action).toMatch(/GHOST-1/);
  });

  it('is deterministic and still produces an action per problem without policy or manifest context', async () => {
    const m = manifest(rel140);
    const p = policy();
    const ev = await evaluateRelease(m, p);
    const a = remediationFor(ev, { policy: p, manifest: m });
    const b = remediationFor(ev, { policy: p, manifest: m });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const generic = remediationFor(ev);
    expect(generic.map((i) => `${i.code}|${i.target}`)).toEqual(a.map((i) => `${i.code}|${i.target}`));
    for (const i of generic) expect(i.action.length).toBeGreaterThan(30);
    expect(generic.find((i) => i.code === 'stale')!.action).toMatch(/evidence age limit|maxEvidenceAgeDays/i);
    expect(generic.find((i) => i.code === 'no-acceptance')!.action).toMatch(/new evidence of the same type/);
  });

  it('appends a "Remediation checklist" section to the Markdown memo', async () => {
    const p = policy();
    const m140 = manifest(rel140);
    const md140 = bundleToMarkdown(await buildBundle(m140, p, await evaluateRelease(m140, p), '2026-10-04T00:00:00.000Z'));
    expect(md140).toMatch(/\n## Remediation checklist\n/);
    expect(md140.indexOf('## Remediation checklist')).toBeGreaterThan(md140.indexOf('## Blockers'));
    expect(md140).toMatch(/- \[ \] \*\*stale\*\* .*threat-model.*re-run threat-model against commit a1b2c3d/i);
    expect(md140).toMatch(/- \[ \] \*\*no-acceptance\*\* .*SAST-17/);
    const m141 = manifest(rel141);
    const md141 = bundleToMarkdown(await buildBundle(m141, p, await evaluateRelease(m141, p), '2026-10-04T00:00:00.000Z'));
    expect(md141).toMatch(/## Remediation checklist\n- none/);
  });
});
