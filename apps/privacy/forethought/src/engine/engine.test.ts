import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { band, score, visibleQuestions } from './scoring';
import { signOffBlockers, signOff, contentHash, snapshot, applyAnswer, canonicalContent, fromCanonical } from './approval';
import { executiveSummary } from './narrative';
import { parseAssessment, serializeAssessment } from './assessmentIO';
import { QUESTIONS, MITIGATIONS } from './rubric';
import demo from '../fixtures/recommendation-feature.json';
import lowFixture from '../fixtures/calibration-low.json';
import veryHighFixture from '../fixtures/calibration-very-high.json';
import type { Assessment } from './types';

function load(json: unknown): Assessment {
  const r = parseAssessment(JSON.stringify(json));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.assessment;
}

describe('band', () => {
  it('maps a 5x5 likelihood x impact product to four bands', () => {
    expect(band(1)).toBe('low');
    expect(band(4)).toBe('low');
    expect(band(5)).toBe('medium');
    expect(band(9)).toBe('medium');
    expect(band(10)).toBe('high');
    expect(band(14)).toBe('high');
    expect(band(15)).toBe('very-high');
    expect(band(25)).toBe('very-high');
  });
});

describe('rubric', () => {
  it('has ten top-level questions plus follow-ups, and every question has at least one option that moves a theme', () => {
    const top = QUESTIONS.filter((q) => !q.showIf);
    expect(top).toHaveLength(10);
    expect(QUESTIONS.length).toBeGreaterThan(10);
    for (const q of QUESTIONS) expect(q.options.some((o) => o.effects.length > 0), q.id).toBe(true);
    for (const q of QUESTIONS) expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
  });

  it('reveals follow-up questions only when their trigger answer is chosen', () => {
    const base = load(demo);
    const without = visibleQuestions({ ...base, answers: { ...base.answers, 'q-children': 'no' } });
    const withChildren = visibleQuestions({ ...base, answers: { ...base.answers, 'q-children': 'yes-directed' } });
    expect(without.some((q) => q.id === 'q-children-age-assurance')).toBe(false);
    expect(withChildren.some((q) => q.id === 'q-children-age-assurance')).toBe(true);
  });

  it('every mitigation references real themes', () => {
    for (const m of MITIGATIONS) expect(m.themes.length).toBeGreaterThan(0);
  });
});

describe('score', () => {
  it('starts every theme at likelihood 1 x impact 1 when nothing is answered', () => {
    const empty = load({ ...demo, answers: {}, mitigations: [], acceptances: [] });
    const card = score(empty);
    expect(card.themes.every((t) => t.inherent.score === 1 && t.inherent.band === 'low')).toBe(true);
    expect(card.overall.inherent).toBe('low');
  });

  it('clamps likelihood and impact to the 1..5 range', () => {
    const card = score(load(veryHighFixture));
    for (const t of card.themes) {
      expect(t.inherent.likelihood).toBeLessThanOrEqual(5);
      expect(t.inherent.impact).toBeLessThanOrEqual(5);
      expect(t.residual.likelihood).toBeGreaterThanOrEqual(1);
      expect(t.residual.impact).toBeGreaterThanOrEqual(1);
    }
  });

  it('lists the answers that contributed to each theme', () => {
    const card = score(load(demo));
    const profiling = card.themes.find((t) => t.theme === 'automated-decisions')!;
    expect(profiling.contributingAnswers.map((a) => a.questionId)).toContain('q-profiling');
  });

  it('only implemented or verified mitigations reduce residual risk; planned ones affect the projection', () => {
    const base = load(demo);
    const planned: Assessment = { ...base, mitigations: [{ mitigationId: 'm-pseudonymise', status: 'planned' }] };
    const implemented: Assessment = { ...base, mitigations: [{ mitigationId: 'm-pseudonymise', status: 'implemented' }] };
    const none: Assessment = { ...base, mitigations: [] };
    const theme = 'security';
    const n = score(none).themes.find((t) => t.theme === theme)!;
    const p = score(planned).themes.find((t) => t.theme === theme)!;
    const i = score(implemented).themes.find((t) => t.theme === theme)!;
    expect(p.residual.score).toBe(n.residual.score);
    expect(p.projected.score).toBeLessThan(n.residual.score);
    expect(i.residual.score).toBeLessThan(n.residual.score);
    expect(i.residual.score).toBe(p.projected.score);
  });

  it('a mitigation that requires evidence counts only when verified with an evidence reference', () => {
    const base = load(demo);
    const theme = 'security';
    const none = score({ ...base, mitigations: [] }).themes.find((t) => t.theme === theme)!.residual.score;
    const implementedOnly = score({ ...base, mitigations: [{ mitigationId: 'm-pentest', status: 'implemented' }] }).themes.find((t) => t.theme === theme)!.residual.score;
    const verifiedNoRef = score({ ...base, mitigations: [{ mitigationId: 'm-pentest', status: 'verified' }] }).themes.find((t) => t.theme === theme)!.residual.score;
    const verified = score({ ...base, mitigations: [{ mitigationId: 'm-pentest', status: 'verified', evidenceRef: 'report-2026-09' }] }).themes.find((t) => t.theme === theme)!.residual.score;
    expect(implementedOnly).toBe(none);
    expect(verifiedNoRef).toBe(none);
    expect(verified).toBeLessThan(none);
  });

  it('residual never exceeds inherent and projected never exceeds residual (property over random mitigation sets)', () => {
    const base = load(demo);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ mitigationId: fc.constantFrom(...MITIGATIONS.map((m) => m.id)), status: fc.constantFrom<'planned' | 'implemented' | 'verified'>('planned', 'implemented', 'verified'), evidenceRef: fc.option(fc.constant('ref'), { nil: undefined }) }), { selector: (m) => m.mitigationId, maxLength: 8 }),
        (mits) => {
          const card = score({ ...base, mitigations: mits.map((m) => ({ mitigationId: m.mitigationId, status: m.status, ...(m.evidenceRef ? { evidenceRef: m.evidenceRef } : {}) })) });
          return card.themes.every((t) => t.residual.score <= t.inherent.score && t.projected.score <= t.residual.score);
        },
      ),
    );
  });

  it('calibration: the low fixture scores low overall, the demo scores high, the children-and-profiling fixture scores very high', () => {
    expect(score(load(lowFixture)).overall.inherent).toBe('low');
    expect(score(load(demo)).overall.inherent).toBe('high');
    const vh = score(load(veryHighFixture));
    expect(vh.overall.inherent).toBe('very-high');
    expect(vh.isDpiaScale).toBe(true);
    expect(vh.highThemes).toContain('vulnerable-subjects');
  });
});

describe('sign-off invariants', () => {
  it('blocks when visible questions are unanswered', () => {
    const a = load(demo);
    const { 'q-purpose': _drop, ...rest } = a.answers;
    const blockers = signOffBlockers({ ...a, answers: rest });
    expect(blockers.map((b) => b.code)).toContain('UNANSWERED_QUESTIONS');
  });

  it('blocks a high residual theme without a recorded acceptance and clears it with one', () => {
    const a = load(demo);
    const noAccept = { ...a, mitigations: [], acceptances: [] };
    const blockers = signOffBlockers(noAccept);
    expect(blockers.some((b) => b.code === 'HIGH_RESIDUAL_WITHOUT_ACCEPTANCE')).toBe(true);
    const highTheme = score(noAccept).highThemes[0]!;
    const accepted = { ...noAccept, acceptances: score(noAccept).highThemes.map((t) => ({ theme: t, acceptedBy: 'data-protection-lead' as const, acceptedByName: 'Ines Okafor', rationale: 'Residual risk understood and accepted for the pilot cohort only.', acceptedOn: '2026-10-01' })) };
    expect(signOffBlockers(accepted).some((b) => b.code === 'HIGH_RESIDUAL_WITHOUT_ACCEPTANCE' && b.subject === highTheme)).toBe(false);
  });

  it('a very-high residual theme cannot be accepted by the product owner alone', () => {
    const a = load(veryHighFixture);
    const vhTheme = score(a).themes.find((t) => t.residual.band === 'very-high')!.theme;
    const poOnly = { ...a, acceptances: [{ theme: vhTheme, acceptedBy: 'product-owner' as const, acceptedByName: 'Someone', rationale: 'We really need this feature to ship on time this quarter.', acceptedOn: '2026-10-01' }] };
    expect(signOffBlockers(poOnly).some((b) => b.code === 'VERY_HIGH_NEEDS_DP_LEAD' && b.subject === vhTheme)).toBe(true);
  });

  it('blocks when a flow leaves the origin region with no mechanism', () => {
    const a = load(demo);
    const bad = { ...a, flows: [...a.flows, { id: 'f-x', from: 'app', to: 'analytics vendor', dataCategories: ['usage'], outsideOriginRegion: true, mechanism: 'none' as const }] };
    expect(signOffBlockers(bad).map((b) => b.code)).toContain('UNRESOLVED_TRANSFER');
  });

  it('requires DPO consultation when the inherent risk is DPIA-scale', () => {
    const a = load(veryHighFixture);
    expect(signOffBlockers({ ...a, dpoConsulted: false }).map((b) => b.code)).toContain('DPO_NOT_CONSULTED');
    expect(signOffBlockers({ ...a, dpoConsulted: true }).map((b) => b.code)).not.toContain('DPO_NOT_CONSULTED');
  });

  it('blocks when a verified mitigation lacks its evidence reference', () => {
    const a = load(demo);
    const bad = { ...a, mitigations: [{ mitigationId: 'm-pentest', status: 'verified' as const }] };
    expect(signOffBlockers(bad).map((b) => b.code)).toContain('EVIDENCE_MISSING');
  });

  it('the demo fixture is signable as shipped', () => {
    expect(signOffBlockers(load(demo))).toEqual([]);
  });

  it('signOff refuses while blockers exist and records the content hash when clear', async () => {
    const a = load(demo);
    const { 'q-purpose': _drop, ...rest } = a.answers;
    await expect(signOff({ ...a, answers: rest }, { role: 'product-owner', name: 'Tamsin Reyes', signedAt: '2026-10-01T10:00:00Z' })).rejects.toThrow(/blocked/i);
    const signed = await signOff(a, { role: 'product-owner', name: 'Tamsin Reyes', signedAt: '2026-10-01T10:00:00Z' });
    expect(signed.signatures).toHaveLength(1);
    expect(signed.signatures[0]?.contentHash).toBe(await contentHash(a));
  });

  it('changing an answer after sign-off makes the signature stale', async () => {
    const a = load(demo);
    const signed = await signOff(a, { role: 'product-owner', name: 'Tamsin Reyes', signedAt: '2026-10-01T10:00:00Z' });
    const edited = applyAnswer(signed, 'q-volume', 'over-1m');
    expect(await contentHash(edited)).not.toBe(signed.signatures[0]?.contentHash);
  });

  it('content hash ignores signatures and versions but changes with answers, mitigations, flows and acceptances', async () => {
    const a = load(demo);
    const h = await contentHash(a);
    expect(await contentHash({ ...a, signatures: [{ role: 'product-owner', name: 'x', signedAt: 't', contentHash: 'h' }] })).toBe(h);
    expect(await contentHash({ ...a, versions: [{ number: 9, at: 't', contentHash: 'h', changeSummary: [] }] })).toBe(h);
    expect(await contentHash({ ...a, mitigations: [] })).not.toBe(h);
    expect(await contentHash({ ...a, dpoConsulted: !a.dpoConsulted })).not.toBe(h);
  });
});

describe('versioning', () => {
  it('snapshot increments the version and summarises what changed since the last snapshot', async () => {
    const a = load(demo);
    const v1 = await snapshot(a, '2026-10-01T09:00:00Z');
    expect(v1.versions.at(-1)?.number).toBe(a.versions.length + 1);
    const edited = applyAnswer(v1, 'q-volume', 'over-1m');
    const v2 = await snapshot({ ...edited, mitigations: [...edited.mitigations, { mitigationId: 'm-dpa', status: 'planned' }] }, '2026-10-02T09:00:00Z');
    const summary = v2.versions.at(-1)!.changeSummary.join(' | ');
    expect(summary).toMatch(/q-volume/);
    expect(summary).toMatch(/m-dpa/);
  });

  it('snapshotting without changes records no-change', async () => {
    const a = await snapshot(load(demo), '2026-10-01T09:00:00Z');
    const again = await snapshot(a, '2026-10-01T09:05:00Z');
    expect(again.versions.at(-1)?.changeSummary).toEqual(['No content changes since the previous version.']);
  });
});

describe('version content persistence (October 2026 upgrade round)', () => {
  const T1 = '2026-10-01T09:00:00Z';
  const T2 = '2026-10-02T09:00:00Z';

  it('snapshot stores the canonical content on the version', async () => {
    const a = load(demo);
    const v1 = await snapshot(a, T1);
    expect(v1.versions.at(-1)?.content).toBe(canonicalContent(a));
  });

  it('export → import → snapshot yields a field-level diff (answer change and mitigation status change)', async () => {
    const v1 = await snapshot(load(demo), T1);
    const imported = parseAssessment(serializeAssessment(v1));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const edited = applyAnswer(imported.assessment, 'q-volume', 'over-1m');
    const withMitigation: Assessment = { ...edited, mitigations: edited.mitigations.map((m) => (m.mitigationId === 'm-human-review' ? { ...m, status: 'verified' as const, evidenceRef: 'review-log-2026-10 (synthetic)' } : m)) };
    const v2 = await snapshot(withMitigation, T2);
    const summary = v2.versions.at(-1)!.changeSummary.join(' | ');
    expect(summary).toMatch(/Answer q-volume: 100k-1m → over-1m/);
    expect(summary).toMatch(/Mitigation m-human-review: implemented → verified/);
    expect(summary).not.toMatch(/unavailable/);
  });

  it('legacy files whose versions carry no content still import; the next summary says the previous content is unavailable', async () => {
    const legacy = parseAssessment(JSON.stringify({ ...demo, versions: [{ number: 1, at: '2026-09-30T09:00:00Z', contentHash: 'a'.repeat(64), changeSummary: ['Initial version.'] }] }));
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const next = await snapshot(applyAnswer(legacy.assessment, 'q-volume', 'over-1m'), T1);
    expect(next.versions.at(-1)?.number).toBe(2);
    expect(next.versions.at(-1)?.changeSummary.join(' ')).toMatch(/previous snapshot content unavailable/);
    const same = parseAssessment(JSON.stringify({ ...demo, versions: [{ number: 1, at: '2026-09-30T09:00:00Z', contentHash: await contentHash(load(demo)), changeSummary: ['Initial version.'] }] }));
    if (same.ok) expect((await snapshot(same.assessment, T1)).versions.at(-1)?.changeSummary).toEqual(['No content changes since the previous version.']);
  });

  it('omits content above 64 KiB and says so; the following snapshot then has no field-level basis', async () => {
    const big: Assessment = { ...load(demo), description: 'x'.repeat(70_000) };
    const v1 = await snapshot(big, T1);
    expect(v1.versions.at(-1)?.content).toBeUndefined();
    expect(v1.versions.at(-1)?.changeSummary.join(' ')).toMatch(/content too large to retain/);
    const v2 = await snapshot(applyAnswer(v1, 'q-volume', 'over-1m'), T2);
    expect(v2.versions.at(-1)?.changeSummary.join(' ')).toMatch(/previous snapshot content unavailable/);
  });

  it('does not leak snapshot content across assessments that share a content hash', async () => {
    const a = await snapshot(load(demo), T1);
    const sharedHash = a.versions.at(-1)!.contentHash;
    const other: Assessment = { ...load(demo), id: 'PIA-OTHER', versions: [{ number: 1, at: T1, contentHash: sharedHash, changeSummary: ['Initial version.'] }] };
    const next = await snapshot(applyAnswer(other, 'q-volume', 'over-1m'), T2);
    const summary = next.versions.at(-1)!.changeSummary.join(' ');
    expect(summary).toMatch(/previous snapshot content unavailable/);
    expect(summary).not.toMatch(/Answer q-volume/);
  });

  it('ignores retained content whose hash does not match the version it sits on', async () => {
    const a = load(demo);
    const planted: Assessment = { ...a, versions: [{ number: 1, at: T1, contentHash: 'f'.repeat(64), changeSummary: ['Initial version.'], content: canonicalContent({ ...a, title: 'Planted title' }) }] };
    const next = await snapshot(applyAnswer(planted, 'q-volume', 'over-1m'), T2);
    const summary = next.versions.at(-1)!.changeSummary.join(' ');
    expect(summary).toMatch(/previous snapshot content unavailable.*does not match/);
    expect(summary).not.toMatch(/title changed/);
  });

  it('fromCanonical reconstructs the assessable content and round-trips through canonicalContent', () => {
    const a = load(demo);
    const back = fromCanonical(canonicalContent(a));
    expect(back).toBeDefined();
    if (!back) return;
    expect(back.title).toBe(a.title);
    expect(back.owner).toBe(a.owner);
    expect(back.description).toBe(a.description);
    expect(back.dpoConsulted).toBe(a.dpoConsulted);
    expect(back.answers).toEqual(a.answers);
    expect(back.mitigations.map((m) => m.mitigationId).sort()).toEqual(a.mitigations.map((m) => m.mitigationId).sort());
    expect(back.flows.map((f) => f.id).sort()).toEqual(a.flows.map((f) => f.id).sort());
    expect(back.acceptances).toHaveLength(a.acceptances.length);
    expect(canonicalContent({ ...a, ...back })).toBe(canonicalContent(a));
    expect(fromCanonical('not json')).toBeUndefined();
    expect(fromCanonical(JSON.stringify({ answers: 5 }))).toBeUndefined();
    expect(fromCanonical(JSON.stringify([]))).toBeUndefined();
  });
});

describe('version content import (October 2026 upgrade round)', () => {
  const base = demo as unknown as Record<string, unknown>;
  const version = (extra: Record<string, unknown>) => ({ number: 1, at: '2026-10-01T09:00:00Z', contentHash: 'h'.repeat(64), changeSummary: ['Initial version.'], ...extra });

  it('accepts and round-trips a version with canonical content', () => {
    const content = canonicalContent(load(demo));
    const r = parseAssessment(JSON.stringify({ ...base, versions: [version({ content })] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assessment.versions[0]?.content).toBe(content);
    expect(parseAssessment(serializeAssessment(r.assessment)).ok).toBe(true);
  });

  it('still imports legacy files whose versions have no content', () => {
    const r = parseAssessment(JSON.stringify({ ...base, versions: [version({})] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.assessment.versions[0]?.content).toBeUndefined();
  });

  it('rejects content that is not a string, is above 64 KiB, or is not canonical content JSON, naming the path', () => {
    for (const bad of [42, 'x'.repeat(65_537), 'not json', JSON.stringify({ answers: 5 })]) {
      const r = parseAssessment(JSON.stringify({ ...base, versions: [version({ content: bad })] }));
      expect(r.ok, String(bad).slice(0, 20)).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/versions\[0\]\.content/);
    }
  });
});

describe('narrative', () => {
  it('produces a deterministic executive summary naming the overall band and the top themes', () => {
    const a = load(demo);
    const text = executiveSummary(a, score(a));
    expect(text).toMatch(/high/i);
    expect(text).toMatch(/Recommendation/);
    expect(executiveSummary(a, score(a))).toBe(text);
  });
});

describe('import/export', () => {
  it('round-trips and rejects unknown question/option/mitigation ids', () => {
    const a = load(demo);
    expect(parseAssessment(serializeAssessment(a)).ok).toBe(true);
    expect(parseAssessment(JSON.stringify({ ...demo, answers: { ...demo.answers, 'q-nope': 'x' } })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...demo, answers: { ...demo.answers, 'q-purpose': 'not-an-option' } })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...demo, mitigations: [{ mitigationId: 'm-nope', status: 'planned' }] })).ok).toBe(false);
  });

  it('bounds size and nesting and validates enums', () => {
    expect(parseAssessment('x'.repeat(20), { maxBytes: 10 }).ok).toBe(false);
    let deep: unknown = 1;
    for (let i = 0; i < 10; i += 1) deep = { deep };
    expect(parseAssessment(JSON.stringify({ ...demo, extra: deep })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...demo, acceptances: [{ theme: 'security', acceptedBy: 'intern', acceptedByName: 'x', rationale: 'y'.repeat(40), acceptedOn: '2026-10-01' }] })).ok).toBe(false);
  });
});

describe('hostile nesting (review finding)', () => {
  it('returns a validation error, not a RangeError, for 20,000 nested arrays inside the byte limit', () => {
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    const text = `{"schema":"forethought.assessment","version":1,"id":"x","title":"t","owner":"o","description":"","asOf":"2026-10-01","answers":{},"dpoConsulted":true,"extra":${deep}}`;
    let result: ReturnType<typeof parseAssessment> | undefined;
    expect(() => { result = parseAssessment(text); }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.errors[0]).toMatch(/Nesting deeper than 6/);
  });
});

describe('strict import (review findings)', () => {
  const base = demo as unknown as Record<string, unknown>;
  it('rejects impossible calendar dates even when they match the pattern', () => {
    expect(parseAssessment(JSON.stringify({ ...base, asOf: '2026-02-30' })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...base, asOf: '2026-99-99' })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...base, acceptances: [{ ...(demo.acceptances[0] as object), acceptedOn: '2026-13-01' }] })).ok).toBe(false);
  });

  it('rejects malformed or oversized list fields instead of silently filtering them', () => {
    expect(parseAssessment(JSON.stringify({ ...base, flows: [{ ...(demo.flows[0] as object), dataCategories: ['ok', 42] }] })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...base, flows: [{ ...(demo.flows[0] as object), dataCategories: Array.from({ length: 51 }, (_, i) => `c${i}`) }] })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...base, versions: [{ number: 1, at: 't', contentHash: 'h', changeSummary: Array.from({ length: 101 }, () => 'x') }] })).ok).toBe(false);
    expect(parseAssessment(JSON.stringify({ ...base, versions: [{ number: 1, at: 't', contentHash: 'h', changeSummary: ['ok', 7] }] })).ok).toBe(false);
  });

  it('rejects duplicate mitigation ids, flow ids, acceptance themes, signature roles and version numbers', () => {
    const m = demo.mitigations[0] as object;
    expect(parseAssessment(JSON.stringify({ ...base, mitigations: [m, m] })).ok).toBe(false);
    const f = demo.flows[0] as object;
    expect(parseAssessment(JSON.stringify({ ...base, flows: [f, f] })).ok).toBe(false);
    const acc = demo.acceptances[0] as object;
    expect(parseAssessment(JSON.stringify({ ...base, acceptances: [acc, acc] })).ok).toBe(false);
    const sig = { role: 'product-owner', name: 'a', signedAt: '2026-10-01T00:00:00Z', contentHash: 'h' };
    expect(parseAssessment(JSON.stringify({ ...base, signatures: [sig, sig] })).ok).toBe(false);
    const v = { number: 1, at: '2026-10-01T00:00:00Z', contentHash: 'h', changeSummary: [] };
    expect(parseAssessment(JSON.stringify({ ...base, versions: [v, v] })).ok).toBe(false);
  });

  it('reports the offending path in the error message', () => {
    const r = parseAssessment(JSON.stringify({ ...base, asOf: '2026-02-30' }));
    if (r.ok) throw new Error('expected rejection');
    expect(r.errors.join(' ')).toMatch(/asOf/);
  });
});
