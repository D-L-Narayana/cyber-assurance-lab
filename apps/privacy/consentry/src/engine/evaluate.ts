import type { AgeBand, ConsentRecord, Decision, DecisionOutcome, LegalBasis, Policy, ProcessingEvent, Purpose, ReasonCode, Regime, RuleTrace, Subject } from './types';

export interface EvaluationContext {
  subject: Subject;
  purposes: Purpose[];
  records: ConsentRecord[];
  policy: Policy;
}

/** Everything a rule may need; computed once per evaluation. */
interface Facts {
  event: ProcessingEvent;
  subject: Subject;
  purpose: Purpose | undefined;
  regime: Regime;
  configuredBasis: LegalBasis | undefined;
  /** Basis after regime-specific adjustments (e.g. Californian minors need opt-in for sale/share). */
  effectiveBasis: LegalBasis | undefined;
  latest: ConsentRecord | undefined;
  policy: Policy;
  isChild: boolean;
}

type RuleResult =
  | { outcome: 'pass'; note: string }
  | { outcome: 'match'; decision: DecisionOutcome; reasonCode: ReasonCode; note: string; basis?: LegalBasis; recordId?: string };

export interface Rule {
  id: string;
  title: string;
  /** Plain-language statement of the rule, shown in the UI. */
  statement: string;
  apply: (f: Facts) => RuleResult;
}

const AGE_ORDER: Record<AgeBand, number> = { 'under-13': 0, '13-15': 13, '16-17': 16, adult: 18, unknown: -1 };

/** True when the band is definitely below the threshold. 'unknown' never counts as a child; the engine does not guess. */
function belowThreshold(band: AgeBand, threshold: 13 | 16): boolean {
  if (band === 'unknown') return false;
  return AGE_ORDER[band] < threshold;
}

const DAY_MS = 86_400_000;

export function latestRecordAsOf(records: ConsentRecord[], subjectId: string, purposeId: string, instant: string): ConsentRecord | undefined {
  const t = Date.parse(instant);
  let best: ConsentRecord | undefined;
  for (const r of records) {
    if (r.subjectId !== subjectId || r.purposeId !== purposeId) continue;
    const rt = Date.parse(r.at);
    if (Number.isNaN(rt) || rt > t) continue;
    if (!best || rt > Date.parse(best.at) || (rt === Date.parse(best.at) && r.id > best.id)) best = r;
  }
  return best;
}

export const RULES: Rule[] = [
  {
    id: 'R01-unknown-purpose',
    title: 'Purpose must be registered',
    statement: 'If the event names a purpose that is not in the purpose registry, the decision needs human review.',
    apply: (f) => (f.purpose ? { outcome: 'pass', note: `purpose "${f.purpose.name}" is registered` } : { outcome: 'match', decision: 'review', reasonCode: 'UNKNOWN_PURPOSE', note: `purpose id "${f.event.purposeId}" is not registered` }),
  },
  {
    id: 'R02-essential',
    title: 'Essential purposes are allowed',
    statement: 'Strictly necessary purposes (security, service delivery) proceed without consent.',
    apply: (f) => (f.purpose?.category === 'essential'
      ? { outcome: 'match', decision: 'allow', reasonCode: 'ESSENTIAL', note: 'category is essential', basis: f.configuredBasis ?? 'contract' }
      : { outcome: 'pass', note: `category is ${f.purpose?.category}` }),
  },
  {
    id: 'R03-unknown-regime',
    title: 'Regime must be known',
    statement: 'If the subject\u2019s regime is unknown, the engine does not guess which rules apply.',
    apply: (f) => (f.regime === 'unknown' ? { outcome: 'match', decision: 'review', reasonCode: 'UNKNOWN_REGIME', note: 'subject regime is unknown' } : { outcome: 'pass', note: `regime ${f.regime}` }),
  },
  {
    id: 'R04-basis-configured',
    title: 'A lawful basis must be configured for the regime',
    statement: 'The purpose registry must state which basis is relied on in the subject\u2019s regime.',
    apply: (f) => (f.configuredBasis ? { outcome: 'pass', note: `configured basis: ${f.configuredBasis}${f.effectiveBasis !== f.configuredBasis ? ` (effective: ${f.effectiveBasis})` : ''}` } : { outcome: 'match', decision: 'review', reasonCode: 'NO_BASIS_CONFIGURED', note: `no basis configured for ${f.regime}` }),
  },
  {
    id: 'R05-child-consent',
    title: 'Children below the regime threshold cannot consent alone; unknown age is not assumed adult',
    statement: 'For consent-based purposes in the EU/UK and for sale/sharing in California, a subject below the age threshold (EU 16, UK 13, CA 16 by default) cannot authorise the processing alone, so the decision is deny; parental authorisation is not modelled. When the age band is unknown for one of these purposes the engine routes to review instead of assuming an adult.',
    apply: (f) => {
      const ageSensitive = (f.regime !== 'US-CA-CCPA' && f.configuredBasis === 'consent') || (f.regime === 'US-CA-CCPA' && f.purpose?.category === 'sale-or-share');
      if (!ageSensitive) return { outcome: 'pass', note: 'purpose does not depend on the subject\u2019s age' };
      if (f.subject.ageBand === 'unknown') return { outcome: 'match', decision: 'review', reasonCode: 'AGE_UNKNOWN', note: 'age band unknown for an age-sensitive purpose; not assumed adult' };
      if (f.regime === 'US-CA-CCPA') return { outcome: 'pass', note: f.isChild ? 'Californian minor: sale/share requires opt-in (handled as consent below)' : 'adult in California' };
      return f.isChild
        ? { outcome: 'match', decision: 'deny', reasonCode: 'CHILD_CONSENT_NOT_VALID', note: `age band ${f.subject.ageBand} is below the ${f.regime} threshold of ${f.policy.childAgeThreshold[f.regime as Exclude<Regime, 'unknown'>]}` }
        : { outcome: 'pass', note: `age band ${f.subject.ageBand} meets the threshold` };
    },
  },
  {
    id: 'R06-gpc-signal',
    title: 'Opt-out preference signal blocks sale or sharing',
    statement: 'In California a Global Privacy Control signal is treated as a valid request to opt out of sale/sharing (CCPA regs \u00a7 7025).',
    apply: (f) => (f.regime === 'US-CA-CCPA' && f.purpose?.category === 'sale-or-share' && f.subject.gpcSignal
      ? { outcome: 'match', decision: 'deny', reasonCode: 'GPC_OPT_OUT', note: 'GPC signal present and purpose is sale-or-share' }
      : { outcome: 'pass', note: f.regime !== 'US-CA-CCPA' ? 'not a California subject' : f.purpose?.category !== 'sale-or-share' ? 'purpose is not sale-or-share' : 'no GPC signal' }),
  },
  {
    id: 'R07-opt-out-on-record',
    title: 'An opt-out on record is honoured',
    statement: 'If the latest record before the event is an opt-out for this purpose, the decision is deny.',
    apply: (f) => (f.latest?.status === 'opted-out'
      ? { outcome: 'match', decision: 'deny', reasonCode: 'OPT_OUT_ON_RECORD', note: `opt-out ${f.latest.id} at ${f.latest.at}`, recordId: f.latest.id }
      : { outcome: 'pass', note: 'no opt-out on record' }),
  },
  {
    id: 'R08-objection',
    title: 'An objection stops legitimate-interest processing',
    statement: 'If the subject has objected and the basis is legitimate interest, the decision is deny (compelling grounds are not modelled).',
    apply: (f) => (f.effectiveBasis === 'legitimate-interest' && f.latest?.status === 'objected'
      ? { outcome: 'match', decision: 'deny', reasonCode: 'OBJECTION_ON_RECORD', note: `objection ${f.latest.id} at ${f.latest.at}`, recordId: f.latest.id }
      : { outcome: 'pass', note: f.effectiveBasis !== 'legitimate-interest' ? 'basis is not legitimate interest' : 'no objection on record' }),
  },
  {
    id: 'R09-consent',
    title: 'Consent must be present, current and for the current notice',
    statement: 'For consent-based purposes: the latest record before the event must be a grant, not expired, and captured under the current policy version when the purpose requires re-consent.',
    apply: (f) => {
      if (f.effectiveBasis !== 'consent') return { outcome: 'pass', note: 'basis is not consent' };
      const r = f.latest;
      if (!r) return { outcome: 'match', decision: 'deny', reasonCode: 'NO_CONSENT', note: 'no consent record at or before the event' };
      if (r.status === 'withdrawn') return { outcome: 'match', decision: 'deny', reasonCode: 'CONSENT_WITHDRAWN', note: `withdrawn ${r.at}`, recordId: r.id };
      if (r.status !== 'granted') return { outcome: 'match', decision: 'deny', reasonCode: 'NO_CONSENT', note: `latest record is ${r.status}, not a grant`, recordId: r.id };
      const eventT = Date.parse(f.event.occurredAt);
      const expiry = r.expiresAt ? Date.parse(r.expiresAt) : Date.parse(r.at) + f.policy.consentMaxAgeDays * DAY_MS;
      if (eventT >= expiry) return { outcome: 'match', decision: 'deny', reasonCode: 'CONSENT_EXPIRED', note: r.expiresAt ? `record expired ${r.expiresAt}` : `consent older than ${f.policy.consentMaxAgeDays} days`, recordId: r.id };
      if (f.purpose!.reconsentOnVersionChange && r.policyVersion < f.purpose!.policyVersion) {
        return { outcome: 'match', decision: 'deny', reasonCode: 'RECONSENT_REQUIRED', note: `consent captured under policy v${r.policyVersion}; purpose now v${f.purpose!.policyVersion}`, recordId: r.id };
      }
      return { outcome: 'match', decision: 'allow', reasonCode: 'CONSENT_VALID', note: `granted ${r.at} via ${r.mechanism} (v${r.policyVersion})`, basis: 'consent', recordId: r.id };
    },
  },
  {
    id: 'R10-legitimate-interest',
    title: 'Legitimate interest needs a documented assessment',
    statement: 'A legitimate-interest purpose proceeds only if a legitimate-interest assessment is recorded; otherwise it goes to review.',
    apply: (f) => {
      if (f.effectiveBasis !== 'legitimate-interest') return { outcome: 'pass', note: 'basis is not legitimate interest' };
      return f.purpose?.liaDocumented
        ? { outcome: 'match', decision: 'allow', reasonCode: 'LEGITIMATE_INTEREST', note: 'assessment documented, no objection', basis: 'legitimate-interest' }
        : { outcome: 'match', decision: 'review', reasonCode: 'LIA_MISSING', note: 'no legitimate-interest assessment recorded for this purpose' };
    },
  },
  {
    id: 'R11-contract',
    title: 'Contractual necessity',
    statement: 'Purposes necessary to perform the contract with the subject are allowed.',
    apply: (f) => (f.effectiveBasis === 'contract' ? { outcome: 'match', decision: 'allow', reasonCode: 'CONTRACT_NECESSITY', note: 'basis is contract', basis: 'contract' } : { outcome: 'pass', note: 'basis is not contract' }),
  },
  {
    id: 'R12-notice-opt-out',
    title: 'Notice-and-opt-out regimes allow by default',
    statement: 'Where the regime relies on notice with a right to opt out and no opt-out or signal applies, the decision is allow.',
    apply: (f) => (f.effectiveBasis === 'notice-and-opt-out' ? { outcome: 'match', decision: 'allow', reasonCode: 'NOTICE_AND_OPT_OUT', note: 'no opt-out on record and no signal', basis: 'notice-and-opt-out' } : { outcome: 'pass', note: 'basis is not notice-and-opt-out' }),
  },
  {
    id: 'R99-fallback',
    title: 'Fallback',
    statement: 'Anything the table does not decide goes to review. This rule should never be exercised by the fixtures.',
    apply: () => ({ outcome: 'match', decision: 'review', reasonCode: 'NO_RULE_MATCHED', note: 'no earlier rule decided' }),
  },
];

function buildFacts(event: ProcessingEvent, ctx: EvaluationContext): Facts {
  const purpose = ctx.purposes.find((p) => p.id === event.purposeId);
  const regime = ctx.subject.regime;
  const configuredBasis = purpose && regime !== 'unknown' ? purpose.basisByRegime[regime] : undefined;
  const threshold = regime === 'unknown' ? undefined : ctx.policy.childAgeThreshold[regime];
  const isChild = threshold !== undefined && belowThreshold(ctx.subject.ageBand, threshold);
  let effectiveBasis = configuredBasis;
  // CCPA: selling or sharing the personal information of a consumer under 16 requires affirmative authorisation (opt-in).
  // The guard depends on regime + purpose category + age only; whatever basis the purpose is configured with
  // (notice-and-opt-out, legitimate interest, contract, or none) cannot bypass it.
  if (regime === 'US-CA-CCPA' && purpose?.category === 'sale-or-share' && isChild) {
    effectiveBasis = 'consent';
  }
  return {
    event,
    subject: ctx.subject,
    purpose,
    regime,
    configuredBasis,
    effectiveBasis,
    latest: latestRecordAsOf(ctx.records, event.subjectId, event.purposeId, event.occurredAt),
    policy: ctx.policy,
    isChild,
  };
}

/**
 * Runs the ordered rule table. The first matching rule is terminal; disabled rules are recorded as
 * skipped. The trace always ends with exactly one matched entry (R99 guarantees termination).
 */
export function evaluate(event: ProcessingEvent, ctx: EvaluationContext): Decision {
  const facts = buildFacts(event, ctx);
  const disabled = new Set(ctx.policy.disabledRules);
  const trace: RuleTrace[] = [];
  for (const rule of RULES) {
    if (disabled.has(rule.id) && rule.id !== 'R99-fallback') {
      trace.push({ ruleId: rule.id, title: rule.title, outcome: 'skipped', note: 'disabled in policy' });
      continue;
    }
    const result = rule.apply(facts);
    if (result.outcome === 'pass') {
      trace.push({ ruleId: rule.id, title: rule.title, outcome: 'passed', note: result.note });
      continue;
    }
    trace.push({ ruleId: rule.id, title: rule.title, outcome: 'matched', note: result.note });
    return {
      eventId: event.id,
      subjectId: event.subjectId,
      purposeId: event.purposeId,
      decision: result.decision,
      reasonCode: result.reasonCode,
      ruleId: rule.id,
      ...(result.basis ? { basis: result.basis } : {}),
      ...(result.recordId ? { recordId: result.recordId } : {}),
      trace,
    };
  }
  /* istanbul ignore next -- R99 always matches */
  throw new Error('rule table did not terminate');
}
