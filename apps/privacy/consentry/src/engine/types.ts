/** Consentry domain types. Synthetic, educational; not a legal model. */

export type Regime = 'EU-GDPR' | 'UK-GDPR' | 'US-CA-CCPA' | 'unknown';

export type LegalBasis = 'consent' | 'legitimate-interest' | 'contract' | 'notice-and-opt-out';

export type PurposeCategory = 'essential' | 'operations' | 'analytics' | 'personalisation' | 'marketing' | 'sale-or-share' | 'research';

export type AgeBand = 'under-13' | '13-15' | '16-17' | 'adult' | 'unknown';

export interface Purpose {
  id: string;
  name: string;
  category: PurposeCategory;
  description: string;
  dataCategories: string[];
  /** Which lawful basis the organisation relies on for this purpose in each regime. */
  basisByRegime: Partial<Record<Regime, LegalBasis>>;
  /** Bumped when the notice for this purpose materially changes. */
  policyVersion: number;
  /** When true, consent captured under an older policyVersion is no longer sufficient. */
  reconsentOnVersionChange: boolean;
  /** Whether a legitimate-interest assessment exists for this purpose (needed for LI basis). */
  liaDocumented?: boolean;
}

export type ConsentStatus = 'granted' | 'withdrawn' | 'objected' | 'opted-out';

export type Mechanism = 'banner' | 'preference-centre' | 'account-settings' | 'imported' | 'opt-out-signal';

export interface ConsentRecord {
  id: string;
  subjectId: string;
  purposeId: string;
  status: ConsentStatus;
  at: string; // ISO timestamp when this status took effect
  policyVersion: number;
  mechanism: Mechanism;
  regime: Regime;
  /** Reference to the stored proof (synthetic). Inspired by consent-receipt practice; not a real receipt. */
  proofRef: string;
  expiresAt?: string;
}

export interface Subject {
  id: string;
  label: string;
  regime: Regime;
  ageBand: AgeBand;
  /** Global Privacy Control or similar opt-out preference signal observed on the subject's agent. */
  gpcSignal: boolean;
}

export interface ProcessingEvent {
  id: string;
  subjectId: string;
  purposeId: string;
  occurredAt: string;
  channel: string;
}

export interface Policy {
  id: string;
  version: number;
  /** Age below which consent is not valid without parental authorisation, per regime. */
  childAgeThreshold: Record<Exclude<Regime, 'unknown'>, 13 | 16>;
  /** Consent older than this (days) is treated as expired unless the record carries its own expiry. */
  consentMaxAgeDays: number;
  /** Rule ids that are switched off (used for coverage analysis and what-if). */
  disabledRules: string[];
}

export type DecisionOutcome = 'allow' | 'deny' | 'review';

export type ReasonCode =
  | 'UNKNOWN_PURPOSE'
  | 'ESSENTIAL'
  | 'UNKNOWN_REGIME'
  | 'NO_BASIS_CONFIGURED'
  | 'CHILD_CONSENT_NOT_VALID'
  | 'AGE_UNKNOWN'
  | 'GPC_OPT_OUT'
  | 'OPT_OUT_ON_RECORD'
  | 'OBJECTION_ON_RECORD'
  | 'RECORD_REGIME_MISMATCH'
  | 'NO_CONSENT'
  | 'CONSENT_WITHDRAWN'
  | 'CONSENT_EXPIRED'
  | 'RECONSENT_REQUIRED'
  | 'CONSENT_VALID'
  | 'LEGITIMATE_INTEREST'
  | 'LIA_MISSING'
  | 'CONTRACT_NECESSITY'
  | 'NOTICE_AND_OPT_OUT'
  | 'NO_RULE_MATCHED';

export interface RuleTrace {
  ruleId: string;
  title: string;
  outcome: 'matched' | 'passed' | 'skipped';
  note: string;
}

export interface Decision {
  eventId: string;
  subjectId: string;
  purposeId: string;
  decision: DecisionOutcome;
  reasonCode: ReasonCode;
  ruleId: string;
  basis?: LegalBasis;
  /** The consent record the decision rested on, if any. */
  recordId?: string;
  trace: RuleTrace[];
}

export interface Workspace {
  schema: 'consentry.workspace';
  version: 1;
  policy: Policy;
  purposes: Purpose[];
  subjects: Subject[];
  records: ConsentRecord[];
  events: ProcessingEvent[];
  /** Expected outcomes used as a regression suite for the policy table. */
  expectations: Array<{ eventId: string; expect: DecisionOutcome; reasonCode?: ReasonCode }>;
}
