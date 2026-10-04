import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluate, latestRecordAsOf, RULES } from './evaluate';
import type { ConsentRecord, Policy, ProcessingEvent, Purpose, Subject } from './types';

const policy: Policy = {
  id: 'policy-test',
  version: 3,
  childAgeThreshold: { 'EU-GDPR': 16, 'UK-GDPR': 13, 'US-CA-CCPA': 16 },
  consentMaxAgeDays: 395,
  disabledRules: [],
};

const marketing: Purpose = {
  id: 'marketing-email',
  name: 'Marketing email',
  category: 'marketing',
  description: 'Promotional email',
  dataCategories: ['email'],
  basisByRegime: { 'EU-GDPR': 'consent', 'UK-GDPR': 'consent', 'US-CA-CCPA': 'notice-and-opt-out' },
  policyVersion: 3,
  reconsentOnVersionChange: true,
};
const analytics: Purpose = {
  id: 'product-analytics',
  name: 'Product analytics',
  category: 'analytics',
  description: 'Aggregate usage analytics',
  dataCategories: ['device', 'usage'],
  basisByRegime: { 'EU-GDPR': 'legitimate-interest', 'UK-GDPR': 'legitimate-interest', 'US-CA-CCPA': 'notice-and-opt-out' },
  policyVersion: 1,
  reconsentOnVersionChange: false,
  liaDocumented: true,
};
const adSale: Purpose = {
  id: 'ad-partner-sharing',
  name: 'Share with ad partners',
  category: 'sale-or-share',
  description: 'Cross-context behavioural advertising',
  dataCategories: ['identifiers', 'browsing'],
  basisByRegime: { 'EU-GDPR': 'consent', 'UK-GDPR': 'consent', 'US-CA-CCPA': 'notice-and-opt-out' },
  policyVersion: 2,
  reconsentOnVersionChange: true,
};
const essential: Purpose = {
  id: 'fraud-checks',
  name: 'Fraud checks',
  category: 'essential',
  description: 'Security of the service',
  dataCategories: ['ip'],
  basisByRegime: { 'EU-GDPR': 'contract', 'UK-GDPR': 'contract', 'US-CA-CCPA': 'contract' },
  policyVersion: 1,
  reconsentOnVersionChange: false,
};
const purposes = [marketing, analytics, adSale, essential];

const eu: Subject = { id: 'eu-adult', label: 'EU adult', regime: 'EU-GDPR', ageBand: 'adult', gpcSignal: false };
const euChild: Subject = { id: 'eu-child', label: 'EU 13-15', regime: 'EU-GDPR', ageBand: '13-15', gpcSignal: false };
const ukTeen: Subject = { id: 'uk-teen', label: 'UK 13-15', regime: 'UK-GDPR', ageBand: '13-15', gpcSignal: false };
const ca: Subject = { id: 'ca-adult', label: 'CA adult', regime: 'US-CA-CCPA', ageBand: 'adult', gpcSignal: false };
const caGpc: Subject = { id: 'ca-gpc', label: 'CA adult with GPC', regime: 'US-CA-CCPA', ageBand: 'adult', gpcSignal: true };
const caTeen: Subject = { id: 'ca-teen', label: 'CA 13-15', regime: 'US-CA-CCPA', ageBand: '13-15', gpcSignal: false };
const nowhere: Subject = { id: 'nowhere', label: 'Unknown regime', regime: 'unknown', ageBand: 'adult', gpcSignal: false };

function ev(subjectId: string, purposeId: string, occurredAt = '2026-09-15T10:00:00Z'): ProcessingEvent {
  return { id: `ev-${subjectId}-${purposeId}-${occurredAt}`, subjectId, purposeId, occurredAt, channel: 'web' };
}

function rec(partial: Partial<ConsentRecord> & Pick<ConsentRecord, 'subjectId' | 'purposeId' | 'status' | 'at'>): ConsentRecord {
  return { id: `rec-${partial.subjectId}-${partial.status}-${partial.at}`, policyVersion: 3, mechanism: 'banner', regime: 'EU-GDPR', proofRef: 'proof', ...partial };
}

function run(event: ProcessingEvent, subject: Subject, records: ConsentRecord[] = [], p: Policy = policy) {
  return evaluate(event, { subject, purposes, records, policy: p });
}

describe('evaluate: rule ladder', () => {
  it('sends an unknown purpose to review', () => {
    const d = run(ev('eu-adult', 'does-not-exist'), eu);
    expect(d.decision).toBe('review');
    expect(d.reasonCode).toBe('UNKNOWN_PURPOSE');
  });

  it('allows essential purposes without consent', () => {
    const d = run(ev('eu-adult', 'fraud-checks'), eu);
    expect(d).toMatchObject({ decision: 'allow', reasonCode: 'ESSENTIAL', basis: 'contract' });
  });

  it('sends an unknown regime to review rather than guessing', () => {
    expect(run(ev('nowhere', 'marketing-email'), nowhere).reasonCode).toBe('UNKNOWN_REGIME');
  });

  it('denies consent-based processing with no consent on record', () => {
    const d = run(ev('eu-adult', 'marketing-email'), eu);
    expect(d).toMatchObject({ decision: 'deny', reasonCode: 'NO_CONSENT' });
  });

  it('allows when a valid consent predates the event and names the record', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z' });
    const d = run(ev('eu-adult', 'marketing-email'), eu, [r]);
    expect(d).toMatchObject({ decision: 'allow', reasonCode: 'CONSENT_VALID', basis: 'consent', recordId: r.id });
  });

  it('ignores a consent granted after the event (temporal validity)', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-20T00:00:00Z' });
    const d = run(ev('eu-adult', 'marketing-email', '2026-09-15T10:00:00Z'), eu, [r]);
    expect(d.reasonCode).toBe('NO_CONSENT');
  });

  it('denies when the latest record before the event is a withdrawal', () => {
    const records = [
      rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-08-01T00:00:00Z' }),
      rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'withdrawn', at: '2026-09-01T00:00:00Z' }),
    ];
    expect(run(ev('eu-adult', 'marketing-email'), eu, records).reasonCode).toBe('CONSENT_WITHDRAWN');
  });

  it('re-grant after withdrawal is valid again', () => {
    const records = [
      rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-08-01T00:00:00Z' }),
      rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'withdrawn', at: '2026-08-15T00:00:00Z' }),
      rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z' }),
    ];
    expect(run(ev('eu-adult', 'marketing-email'), eu, records).reasonCode).toBe('CONSENT_VALID');
  });

  it('treats consent older than the policy maximum age as expired', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2025-01-01T00:00:00Z' });
    expect(run(ev('eu-adult', 'marketing-email', '2026-09-15T10:00:00Z'), eu, [r]).reasonCode).toBe('CONSENT_EXPIRED');
  });

  it('honours an explicit expiresAt on the record', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z' });
    expect(run(ev('eu-adult', 'marketing-email'), eu, [r]).reasonCode).toBe('CONSENT_EXPIRED');
  });

  it('requires fresh consent when the purpose policy version moved and the purpose demands it', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', policyVersion: 2 });
    expect(run(ev('eu-adult', 'marketing-email'), eu, [r]).reasonCode).toBe('RECONSENT_REQUIRED');
  });

  it('denies consent-based processing for a child below the regime threshold', () => {
    const r = rec({ subjectId: 'eu-child', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z' });
    expect(run(ev('eu-child', 'marketing-email'), euChild, [r])).toMatchObject({ decision: 'deny', reasonCode: 'CHILD_CONSENT_NOT_VALID' });
  });

  it('applies the lower UK threshold so a 13-15 year old can consent', () => {
    const r = rec({ subjectId: 'uk-teen', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'UK-GDPR' });
    expect(run(ev('uk-teen', 'marketing-email'), ukTeen, [r]).reasonCode).toBe('CONSENT_VALID');
  });

  it('denies sale/share when an opt-out preference signal is present in California', () => {
    const d = run(ev('ca-gpc', 'ad-partner-sharing'), caGpc);
    expect(d).toMatchObject({ decision: 'deny', reasonCode: 'GPC_OPT_OUT' });
  });

  it('GPC does not block non-sale purposes', () => {
    expect(run(ev('ca-gpc', 'marketing-email'), caGpc).reasonCode).toBe('NOTICE_AND_OPT_OUT');
  });

  it('denies when an opt-out is on record for a notice-and-opt-out purpose', () => {
    const r = rec({ subjectId: 'ca-adult', purposeId: 'marketing-email', status: 'opted-out', at: '2026-09-01T00:00:00Z', regime: 'US-CA-CCPA' });
    expect(run(ev('ca-adult', 'marketing-email'), ca, [r]).reasonCode).toBe('OPT_OUT_ON_RECORD');
  });

  it('requires affirmative opt-in to sell or share a Californian minor\u2019s data', () => {
    expect(run(ev('ca-teen', 'ad-partner-sharing'), caTeen).reasonCode).toBe('NO_CONSENT');
    const r = rec({ subjectId: 'ca-teen', purposeId: 'ad-partner-sharing', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'US-CA-CCPA', policyVersion: 2 });
    expect(run(ev('ca-teen', 'ad-partner-sharing'), caTeen, [r]).reasonCode).toBe('CONSENT_VALID');
  });

  it('allows legitimate-interest purposes only when an assessment is documented', () => {
    expect(run(ev('eu-adult', 'product-analytics'), eu)).toMatchObject({ decision: 'allow', reasonCode: 'LEGITIMATE_INTEREST' });
    const undocumented = { ...analytics, liaDocumented: false };
    const d = evaluate(ev('eu-adult', 'product-analytics'), { subject: eu, purposes: [undocumented], records: [], policy });
    expect(d).toMatchObject({ decision: 'review', reasonCode: 'LIA_MISSING' });
  });

  it('denies a legitimate-interest purpose when the subject has objected', () => {
    const r = rec({ subjectId: 'eu-adult', purposeId: 'product-analytics', status: 'objected', at: '2026-09-01T00:00:00Z' });
    expect(run(ev('eu-adult', 'product-analytics'), eu, [r]).reasonCode).toBe('OBJECTION_ON_RECORD');
  });

  it('sends a purpose with no configured basis for the regime to review', () => {
    const noBasis = { ...marketing, basisByRegime: { 'EU-GDPR': 'consent' as const } };
    const d = evaluate(ev('ca-adult', 'marketing-email'), { subject: ca, purposes: [noBasis], records: [], policy });
    expect(d.reasonCode).toBe('NO_BASIS_CONFIGURED');
  });
});

describe('evaluate: trace and determinism', () => {
  it('produces a trace with exactly one matched rule, which is the last entry, and all prior rules passed', () => {
    const d = run(ev('eu-adult', 'marketing-email'), eu);
    const matched = d.trace.filter((t) => t.outcome === 'matched');
    expect(matched).toHaveLength(1);
    expect(d.trace[d.trace.length - 1]?.outcome).toBe('matched');
    expect(d.trace[d.trace.length - 1]?.ruleId).toBe(d.ruleId);
    expect(d.trace.slice(0, -1).every((t) => t.outcome === 'passed' || t.outcome === 'skipped')).toBe(true);
  });

  it('marks disabled rules as skipped and lets the next rule decide', () => {
    const p = { ...policy, disabledRules: ['R06-gpc-signal'] };
    const d = run(ev('ca-gpc', 'ad-partner-sharing'), caGpc, [], p);
    expect(d.trace.find((t) => t.ruleId === 'R06-gpc-signal')?.outcome).toBe('skipped');
    expect(d.reasonCode).toBe('NOTICE_AND_OPT_OUT');
  });

  it('is deterministic and never throws for arbitrary combinations (property)', () => {
    const subjects = [eu, euChild, ukTeen, ca, caGpc, caTeen, nowhere];
    fc.assert(
      fc.property(
        fc.constantFrom(...subjects),
        fc.constantFrom(...purposes.map((p) => p.id), 'missing'),
        fc.array(fc.record({
          status: fc.constantFrom<ConsentRecord['status']>('granted', 'withdrawn', 'objected', 'opted-out'),
          day: fc.integer({ min: 1, max: 28 }),
          policyVersion: fc.integer({ min: 1, max: 3 }),
        }), { maxLength: 4 }),
        (subject, purposeId, recs) => {
          const records = recs.map((r, i) => rec({ id: `r${i}`, subjectId: subject.id, purposeId, status: r.status, at: `2026-09-${String(r.day).padStart(2, '0')}T00:00:00Z`, policyVersion: r.policyVersion }));
          const a = run(ev(subject.id, purposeId), subject, records);
          const b = run(ev(subject.id, purposeId), subject, records);
          expect(a).toEqual(b);
          expect(['allow', 'deny', 'review']).toContain(a.decision);
          expect(a.trace.filter((t) => t.outcome === 'matched')).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('exposes the rule table in evaluation order with unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('R01-unknown-purpose');
    expect(ids[ids.length - 1]).toBe('R99-fallback');
  });
});

describe('latestRecordAsOf', () => {
  it('returns the newest record at or before the instant, for the subject and purpose only', () => {
    const records = [
      rec({ subjectId: 's', purposeId: 'p', status: 'granted', at: '2026-01-01T00:00:00Z' }),
      rec({ subjectId: 's', purposeId: 'p', status: 'withdrawn', at: '2026-02-01T00:00:00Z' }),
      rec({ subjectId: 's', purposeId: 'other', status: 'granted', at: '2026-03-01T00:00:00Z' }),
      rec({ subjectId: 'someone-else', purposeId: 'p', status: 'granted', at: '2026-03-01T00:00:00Z' }),
    ];
    expect(latestRecordAsOf(records, 's', 'p', '2026-02-01T00:00:00Z')?.status).toBe('withdrawn');
    expect(latestRecordAsOf(records, 's', 'p', '2026-01-15T00:00:00Z')?.status).toBe('granted');
    expect(latestRecordAsOf(records, 's', 'p', '2025-12-31T00:00:00Z')).toBeUndefined();
  });
});

describe('unknown age (review finding)', () => {
  const unknownEu: Subject = { id: 'eu-unknown', label: 'EU unknown age', regime: 'EU-GDPR', ageBand: 'unknown', gpcSignal: false };
  const unknownCa: Subject = { id: 'ca-unknown', label: 'CA unknown age', regime: 'US-CA-CCPA', ageBand: 'unknown', gpcSignal: false };

  it('routes a consent-based EU purpose to review when the age band is unknown, even with a grant on record', () => {
    const r = rec({ subjectId: 'eu-unknown', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z' });
    expect(run(ev('eu-unknown', 'marketing-email'), unknownEu, [r])).toMatchObject({ decision: 'review', reasonCode: 'AGE_UNKNOWN' });
  });

  it('routes a Californian sale/share purpose to review when the age band is unknown', () => {
    expect(run(ev('ca-unknown', 'ad-partner-sharing'), unknownCa)).toMatchObject({ decision: 'review', reasonCode: 'AGE_UNKNOWN' });
  });

  it('does not require a known age for non-consent, non-sale purposes', () => {
    expect(run(ev('eu-unknown', 'product-analytics'), unknownEu).reasonCode).toBe('LEGITIMATE_INTEREST');
    expect(run(ev('ca-unknown', 'marketing-email'), unknownCa).reasonCode).toBe('NOTICE_AND_OPT_OUT');
  });
});

describe('R09a record regime (October 2026 upgrade round)', () => {
  const ukAdult: Subject = { id: 'uk-adult', label: 'UK adult', regime: 'UK-GDPR', ageBand: 'adult', gpcSignal: false };

  it('routes a consent grant captured under another regime to review with RECORD_REGIME_MISMATCH and names the record', () => {
    const r = rec({ subjectId: 'uk-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'EU-GDPR' });
    const d = run(ev('uk-adult', 'marketing-email'), ukAdult, [r]);
    expect(d).toMatchObject({ decision: 'review', reasonCode: 'RECORD_REGIME_MISMATCH', ruleId: 'R09a-record-regime', recordId: r.id });
    const rung = d.trace.find((t) => t.ruleId === 'R09a-record-regime');
    expect(rung?.outcome).toBe('matched');
    expect(rung?.note).toMatch(/EU-GDPR/);
    expect(rung?.note).toMatch(/UK-GDPR/);
  });

  it('leaves a grant captured under the subject’s own regime unaffected', () => {
    const r = rec({ subjectId: 'uk-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'UK-GDPR' });
    const d = run(ev('uk-adult', 'marketing-email'), ukAdult, [r]);
    expect(d.reasonCode).toBe('CONSENT_VALID');
    expect(d.trace.find((t) => t.ruleId === 'R09a-record-regime')?.outcome).toBe('passed');
  });

  it('does not apply to non-consent bases even when the record regime differs', () => {
    const li = rec({ subjectId: 'uk-adult', purposeId: 'product-analytics', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'EU-GDPR' });
    expect(run(ev('uk-adult', 'product-analytics'), ukAdult, [li]).reasonCode).toBe('LEGITIMATE_INTEREST');
    const notice = rec({ subjectId: 'ca-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-09-01T00:00:00Z', regime: 'EU-GDPR' });
    expect(run(ev('ca-adult', 'marketing-email'), ca, [notice]).reasonCode).toBe('NOTICE_AND_OPT_OUT');
  });

  it('keeps the protective effect of a withdrawal recorded under another regime (deny, not review)', () => {
    const records = [
      rec({ subjectId: 'uk-adult', purposeId: 'marketing-email', status: 'granted', at: '2026-08-01T00:00:00Z', regime: 'EU-GDPR' }),
      rec({ subjectId: 'uk-adult', purposeId: 'marketing-email', status: 'withdrawn', at: '2026-09-01T00:00:00Z', regime: 'EU-GDPR' }),
    ];
    expect(run(ev('uk-adult', 'marketing-email'), ukAdult, records).reasonCode).toBe('CONSENT_WITHDRAWN');
  });

  it('with no record on file the mismatch rule passes and R09 still denies NO_CONSENT', () => {
    const d = run(ev('uk-adult', 'marketing-email'), ukAdult, []);
    expect(d.reasonCode).toBe('NO_CONSENT');
    expect(d.trace.find((t) => t.ruleId === 'R09a-record-regime')?.outcome).toBe('passed');
  });

  it('sits immediately before R09-consent and after R08-objection in the rule table', () => {
    const ids = RULES.map((r) => r.id);
    expect(ids.indexOf('R09a-record-regime')).toBe(ids.indexOf('R09-consent') - 1);
    expect(ids.indexOf('R09a-record-regime')).toBeGreaterThan(ids.indexOf('R08-objection'));
  });
});

describe('California under-16 sale/share opt-in is category-based (sixth-review finding)', () => {
  const sale = adSale;
  const kid = { id: 'kid', label: 'kid', regime: 'US-CA-CCPA' as const, ageBand: 'under-13' as const, gpcSignal: false };
  const ev = (purposeId: string) => ({ id: 'e', subjectId: kid.id, purposeId, occurredAt: '2026-10-01T12:00:00Z', channel: 'web' as const });
  it('a legitimate-interest basis cannot bypass the opt-in requirement for a minor', () => {
    const li = { ...sale, id: 'sale-li', basisByRegime: { ...sale.basisByRegime, 'US-CA-CCPA': 'legitimate-interest' as const }, liaDocumented: true };
    const r = evaluate(ev(li.id), { subject: kid, purposes: [marketing, analytics, adSale, essential, li], records: [], policy });
    expect(r.decision).not.toBe('allow');
    expect(r.reasonCode).toBe('NO_CONSENT');
  });
  it('a contract basis cannot bypass it either', () => {
    const ct = { ...sale, id: 'sale-ct', basisByRegime: { ...sale.basisByRegime, 'US-CA-CCPA': 'contract' as const } };
    const r = evaluate(ev(ct.id), { subject: kid, purposes: [marketing, analytics, adSale, essential, ct], records: [], policy });
    expect(r.decision).not.toBe('allow');
  });
});
