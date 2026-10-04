import { describe, expect, it } from 'vitest';
import { MAX_EXCEPTION_DAYS, QUESTIONS, REQUIREMENTS, REVIEW_MONTHS, TIER_THRESHOLDS } from '../src/engine/model';
import { addDays, addMonths, assessVendor, buildQueue, inherentScore, requirementResults, sensitivity, tierFor, toCsv, queueToCsvRows, SCORING_NOTE } from '../src/engine/assess';
import { validateRegister, MAX_REGISTER_BYTES } from '../src/engine/validate';
import type { Register, Vendor } from '../src/engine/types';

const AS_OF = '2026-10-01';

function answers(points: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of QUESTIONS) {
    const p = points[q.id] ?? 0;
    const opt = q.options.find((o) => o.points === p);
    if (!opt) throw new Error(`no option with ${p} points on ${q.id}`);
    out[q.id] = opt.id;
  }
  return out;
}

function vendor(partial: Partial<Vendor> = {}): Vendor {
  return {
    id: 'V-1',
    name: 'Northwind Freight Analytics',
    service: 'Route optimisation SaaS',
    owner: 'ops.lead',
    answers: answers({}),
    evidence: [],
    exceptions: [],
    ...partial,
  };
}

function register(vendors: Vendor[]): Register {
  return { schema: 'tierline.register/1', asOf: AS_OF, vendors };
}

describe('model', () => {
  it('has 8 questions whose weights sum to 100 and whose options are unique with 0..4 points', () => {
    expect(QUESTIONS.length).toBe(8);
    expect(QUESTIONS.reduce((a, q) => a + q.weight, 0)).toBe(100);
    for (const q of QUESTIONS) {
      expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
      expect(q.options.some((o) => o.points === 0)).toBe(true);
      expect(q.options.some((o) => o.points === 4)).toBe(true);
    }
  });
  it('defines stricter evidence and cadence for higher tiers', () => {
    expect(REQUIREMENTS[1].length).toBeGreaterThan(REQUIREMENTS[2].length);
    expect(REQUIREMENTS[2].length).toBeGreaterThan(REQUIREMENTS[3].length);
    expect(REVIEW_MONTHS[1]).toBeLessThan(REVIEW_MONTHS[2]);
    expect(REVIEW_MONTHS[2]).toBeLessThan(REVIEW_MONTHS[3]);
    expect(TIER_THRESHOLDS.tier1).toBeGreaterThan(TIER_THRESHOLDS.tier2);
  });
});

describe('inherent score and tier', () => {
  it('is 0 for all-minimum answers and 100 for all-maximum answers', () => {
    expect(inherentScore(answers({})).score).toBe(0);
    const max: Record<string, number> = {};
    for (const q of QUESTIONS) max[q.id] = 4;
    expect(inherentScore(answers(max)).score).toBe(100);
  });
  it('weights contributions: a 4-point answer on a 25-weight question contributes 25', () => {
    const r = inherentScore(answers({ q1: 4 }));
    expect(r.score).toBe(25);
    expect(r.contributions.find((c) => c.questionId === 'q1')!.contribution).toBe(25);
  });
  it('maps score to tiers at the documented thresholds (inclusive)', () => {
    expect(tierFor(TIER_THRESHOLDS.tier1, []).tier).toBe(1);
    expect(tierFor(TIER_THRESHOLDS.tier1 - 0.01, []).tier).toBe(2);
    expect(tierFor(TIER_THRESHOLDS.tier2, []).tier).toBe(2);
    expect(tierFor(TIER_THRESHOLDS.tier2 - 0.01, []).tier).toBe(3);
  });
  it('hard trigger: regulated data with privileged access is tier 1 even at a low score', () => {
    const a = assessVendor(vendor({ answers: answers({ q1: 4, q2: 4 }) }), AS_OF);
    expect(a.inherent).toBe(45);
    expect(a.tier).toBe(1);
    expect(a.hardTriggers.length).toBe(1);
    expect(a.distanceToTierDown).toBeNull();
  });
  it('hard trigger: unknown subprocessors with personal data is at least tier 2', () => {
    const a = assessVendor(vendor({ answers: answers({ q1: 2, q5: 4 }) }), AS_OF);
    expect(a.inherent).toBeLessThan(TIER_THRESHOLDS.tier2);
    expect(a.tier).toBe(2);
  });
  it('treats unanswered questions as unknown, reports them and scores them at maximum (conservative)', () => {
    const v = vendor();
    delete v.answers.q3;
    const a = assessVendor(v, AS_OF);
    expect(a.unanswered).toEqual(['q3']);
    expect(a.inherent).toBe(20);
    expect(a.tierReasons.join(' ')).toMatch(/unanswered/i);
  });
});

describe('sensitivity analysis', () => {
  it('finds single-answer changes that move the tier up or down', () => {
    // q1=3 (18.75) + q2=3 (15) = 33.75 → tier 3, just below tier 2 (35)
    const a = answers({ q1: 3, q2: 3 });
    const flips = sensitivity(a);
    expect(flips.some((f) => f.direction === 'up' && f.newTier === 2)).toBe(true);
    expect(flips.every((f) => f.deltaScore !== 0)).toBe(true);
    // distance to tier 2 is 1.25 points
    const v = assessVendor(vendor({ answers: a }), AS_OF);
    expect(v.distanceToNextTierUp).toBeCloseTo(1.25);
    expect(v.tier).toBe(3);
  });
  it('reports a downward flip when a vendor sits just above a boundary', () => {
    // q1=4 (25) + q3=2 (10) = 35 → tier 2 exactly
    const flips = sensitivity(answers({ q1: 4, q3: 2 }));
    expect(flips.some((f) => f.direction === 'down' && f.newTier === 3)).toBe(true);
  });
  it('returns no downward flips for hard-triggered tier 1 vendors except those that remove the trigger', () => {
    const flips = sensitivity(answers({ q1: 4, q2: 4 }));
    for (const f of flips.filter((x) => x.direction === 'down')) expect(['q1', 'q2']).toContain(f.questionId);
  });
});

describe('evidence requirements and coverage', () => {
  it('addMonths handles month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-10-01', 12)).toBe('2027-10-01');
  });
  it('tier 1 requires six evidence types; tier 3 only a questionnaire', () => {
    expect(REQUIREMENTS[1].map((r) => r.type).sort()).toEqual(['assurance-report', 'bcp-dr-test', 'dpa', 'insurance', 'pen-test', 'questionnaire']);
    expect(REQUIREMENTS[3].map((r) => r.type)).toEqual(['questionnaire']);
  });
  it('marks evidence valid, expiring (≤ 60 days), expired or missing against asOf', () => {
    const v = vendor({
      evidence: [
        { id: 'E1', type: 'questionnaire', title: 'Q', issuedOn: '2026-09-01', validMonths: 12 },
        { id: 'E2', type: 'pen-test', title: 'P', issuedOn: '2025-10-15', validMonths: 12 }, // expires 2026-10-15 → 14 days
        { id: 'E3', type: 'assurance-report', title: 'A', issuedOn: '2025-01-01', validMonths: 12 }, // expired
      ],
    });
    const res = requirementResults(v, 1, AS_OF);
    const by = (t: string) => res.find((r) => r.type === t)!;
    expect(by('questionnaire').state).toBe('valid');
    expect(by('pen-test').state).toBe('expiring');
    expect(by('pen-test').daysLeft).toBe(14);
    expect(by('assurance-report').state).toBe('expired');
    expect(by('bcp-dr-test').state).toBe('missing');
  });
  it('uses the newest evidence of a type, and the requirement validity caps the item validity', () => {
    const v = vendor({
      evidence: [
        { id: 'OLD', type: 'questionnaire', title: 'Q', issuedOn: '2024-01-01', validMonths: 12 },
        { id: 'NEW', type: 'questionnaire', title: 'Q', issuedOn: '2026-01-01', validMonths: 60 }, // tier 1 caps questionnaire at 12 months
      ],
    });
    const r = requirementResults(v, 1, AS_OF).find((x) => x.type === 'questionnaire')!;
    expect(r.evidenceId).toBe('NEW');
    expect(r.expiresOn).toBe('2027-01-01');
  });
  it('an active exception gives half credit; an expired exception gives none', () => {
    const v = vendor({
      exceptions: [
        { id: 'X1', evidenceType: 'pen-test', approvedBy: 'ciso', rationale: 'Vendor pen test scheduled Q4.', expiresOn: '2026-12-31' },
        { id: 'X2', evidenceType: 'insurance', approvedBy: 'ciso', rationale: 'old', expiresOn: '2026-01-01' },
      ],
    });
    const res = requirementResults(v, 1, AS_OF);
    expect(res.find((r) => r.type === 'pen-test')!.state).toBe('exception');
    expect(res.find((r) => r.type === 'pen-test')!.credit).toBe(0.5);
    expect(res.find((r) => r.type === 'insurance')!.state).toBe('exception-expired');
    expect(res.find((r) => r.type === 'insurance')!.credit).toBe(0);
  });
  it('residual = inherent × (1 − 0.6 × coverage), rounded to one decimal', () => {
    const v = vendor({
      answers: answers({ q1: 4, q2: 4 }),
      evidence: REQUIREMENTS[1].map((r, i) => ({ id: 'E' + i, type: r.type, title: r.type, issuedOn: '2026-09-01', validMonths: 12 })),
    });
    const a = assessVendor(v, AS_OF);
    expect(a.coverage).toBe(1);
    expect(a.residual).toBe(18); // 45 × 0.4
    const none = assessVendor(vendor({ answers: answers({ q1: 4, q2: 4 }) }), AS_OF);
    expect(none.residual).toBe(45);
  });
  it('review cadence: due = lastReview + tier months; overdue when asOf is later; missing review is overdue', () => {
    const t1 = assessVendor(vendor({ answers: answers({ q1: 4, q2: 4 }), lastReviewOn: '2025-09-01' }), AS_OF);
    expect(t1.reviewDueOn).toBe('2026-09-01');
    expect(t1.reviewOverdue).toBe(true);
    const t3 = assessVendor(vendor({ lastReviewOn: '2025-09-01' }), AS_OF);
    expect(t3.reviewDueOn).toBe('2028-09-01');
    expect(t3.reviewOverdue).toBe(false);
    expect(assessVendor(vendor(), AS_OF).reviewOverdue).toBe(true);
  });
});

describe('review queue', () => {
  it('creates items for missing/expired/expiring evidence, exceptions, review cadence, tier drift and incomplete answers', () => {
    const v = vendor({
      answers: answers({ q1: 4, q2: 4 }),
      recordedTier: 3,
      lastReviewOn: '2024-01-01',
      evidence: [{ id: 'E2', type: 'pen-test', title: 'P', issuedOn: '2025-10-15', validMonths: 12 }],
      exceptions: [{ id: 'X1', evidenceType: 'dpa', approvedBy: 'legal', rationale: 'DPA in negotiation', expiresOn: '2026-10-20' }],
    });
    delete v.answers.q8;
    const q = buildQueue(register([v]));
    const kinds = new Set(q.map((i) => i.kind));
    for (const k of ['missing-evidence', 'expiring-evidence', 'exception-expiring', 'review-overdue', 'tier-drift', 'incomplete-questionnaire']) expect(kinds.has(k as never)).toBe(true);
  });
  it('orders by priority descending: tier-1 overdue items outrank tier-3 items; ties broken by vendor name', () => {
    const t1 = vendor({ id: 'A', name: 'Zeta Logistics', answers: answers({ q1: 4, q2: 4 }), lastReviewOn: '2024-01-01' });
    const t3 = vendor({ id: 'B', name: 'Alpha Snacks', lastReviewOn: '2020-01-01' });
    const q = buildQueue(register([t1, t3]));
    expect(q[0].vendorId).toBe('A');
    for (let i = 1; i < q.length; i++) expect(q[i - 1].priority).toBeGreaterThanOrEqual(q[i].priority);
  });
  it('produces no items for a fully covered, recently reviewed vendor with the recorded tier', () => {
    const v = vendor({ recordedTier: 3, lastReviewOn: '2026-09-01', evidence: [{ id: 'E1', type: 'questionnaire', title: 'Q', issuedOn: '2026-09-01', validMonths: 24 }] });
    expect(buildQueue(register([v]))).toEqual([]);
  });
  it('is deterministic', () => {
    const r = register([vendor({ answers: answers({ q1: 3 }) })]);
    expect(JSON.stringify(buildQueue(r))).toBe(JSON.stringify(buildQueue(structuredClone(r))));
  });
  it('exports a formula-safe CSV of the queue', () => {
    const v = vendor({ name: '=HYPERLINK("x")' });
    const csv = toCsv(queueToCsvRows(buildQueue(register([v]))));
    expect(csv.split('\r\n')[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('register validation', () => {
  it('accepts a valid register', () => {
    expect(validateRegister(JSON.stringify(register([vendor()]))).ok).toBe(true);
  });
  it('rejects oversized input by UTF-8 bytes, malformed JSON and non-objects', () => {
    expect(validateRegister('€'.repeat(Math.ceil(MAX_REGISTER_BYTES / 3) + 1)).ok).toBe(false);
    expect(validateRegister('{').ok).toBe(false);
    expect(validateRegister('[]').ok).toBe(false);
  });
  it('rejects unknown question ids, unknown option ids, bad dates and validMonths out of range with paths', () => {
    const v = vendor({ evidence: [{ id: 'E1', type: 'pen-test', title: 'P', issuedOn: '2026-02-30', validMonths: 0 }] });
    v.answers.q9 = 'x';
    v.answers.q1 = 'nope';
    const r = validateRegister(JSON.stringify(register([v])));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('vendors[0].answers.q9');
      expect(paths).toContain('vendors[0].answers.q1');
      expect(paths).toContain('vendors[0].evidence[0].issuedOn');
      expect(paths).toContain('vendors[0].evidence[0].validMonths');
    }
  });
  it('rejects more than 200 vendors and duplicate vendor ids', () => {
    expect(validateRegister(JSON.stringify(register(Array.from({ length: 201 }, (_, i) => vendor({ id: 'V' + i }))))).ok).toBe(false);
    const r = validateRegister(JSON.stringify(register([vendor(), vendor()])));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => /duplicate/i.test(i.message))).toBe(true);
  });
  it('rejects an exception for an evidence type the vendor tier does not even require? no — exceptions are validated only for type', () => {
    const v = vendor({ exceptions: [{ id: 'X', evidenceType: 'bogus' as never, approvedBy: 'a', rationale: 'r', expiresOn: AS_OF }] });
    expect(validateRegister(JSON.stringify(register([v]))).ok).toBe(false);
  });
});

describe('bundled fixture', () => {
  it('validates, has 15 vendors, covers all three tiers and contains the planned adversarial cases', async () => {
    const demo = (await import('../src/fixtures/harbourline-register.json')).default;
    const r = validateRegister(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.register.vendors.length).toBe(15);
    const tiers = new Set(r.register.vendors.map((v) => assessVendor(v, r.register.asOf).tier));
    expect(tiers).toEqual(new Set([1, 2, 3]));
    const q = buildQueue(r.register);
    const kinds = new Set(q.map((i) => i.kind));
    for (const k of ['missing-evidence', 'expired-evidence', 'expiring-evidence', 'future-dated-evidence', 'exception-expired', 'review-overdue', 'tier-drift', 'incomplete-questionnaire']) expect(kinds.has(k as never)).toBe(true);
    expect(r.register.vendors.some((v) => assessVendor(v, r.register.asOf).hardTriggers.length > 0)).toBe(true);
  });
});

describe('sixth review regressions — future-dated evidence and exception validity cap', () => {
  it('evidence issued after the assessment date gets no credit and is reported as future-dated', () => {
    const v = vendor({ evidence: [{ id: 'F1', type: 'questionnaire', title: 'Q', issuedOn: '2027-06-01', validMonths: 12 }] });
    const res = requirementResults(v, 3, AS_OF);
    expect(res[0].state).toBe('future-dated');
    expect(res[0].credit).toBe(0);
    expect(assessVendor(v, AS_OF).coverage).toBe(0);
    const q = buildQueue(register([v]));
    expect(q.some((i) => i.kind === 'future-dated-evidence' && /F1/.test(i.detail))).toBe(true);
  });
  it('future-dated evidence does not shadow an older valid item of the same type', () => {
    const v = vendor({ evidence: [
      { id: 'OK', type: 'questionnaire', title: 'Q', issuedOn: '2026-06-01', validMonths: 24 },
      { id: 'F1', type: 'questionnaire', title: 'Q', issuedOn: '2027-06-01', validMonths: 24 },
    ] });
    const r = requirementResults(v, 3, AS_OF)[0];
    expect(r.state).toBe('valid');
    expect(r.evidenceId).toBe('OK');
  });
  it('an exception that runs longer than the policy cap gets no credit and is reported as out of policy', () => {
    const v = vendor({ answers: answers({ q1: 4, q2: 4 }), exceptions: [{ id: 'X', evidenceType: 'pen-test', approvedBy: 'b', rationale: 'r', expiresOn: '2076-01-01' }] });
    const r = requirementResults(v, 1, AS_OF).find((x) => x.type === 'pen-test')!;
    expect(r.state).toBe('exception-out-of-policy');
    expect(r.credit).toBe(0);
    expect(buildQueue(register([v])).some((i) => i.kind === 'exception-out-of-policy')).toBe(true);
    // exactly at the cap is still acceptable
    const ok = vendor({ answers: answers({ q1: 4, q2: 4 }), exceptions: [{ id: 'X', evidenceType: 'pen-test', approvedBy: 'b', rationale: 'r', expiresOn: addDays(AS_OF, MAX_EXCEPTION_DAYS) }] });
    expect(requirementResults(ok, 1, AS_OF).find((x) => x.type === 'pen-test')!.state).toBe('exception');
  });
  it('the exception cap is a labelled heuristic in the scoring note', () => {
    expect(SCORING_NOTE).toMatch(/exception/i);
    expect(SCORING_NOTE).toMatch(new RegExp(String(MAX_EXCEPTION_DAYS)));
  });
});
