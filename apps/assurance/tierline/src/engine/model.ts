// Tierline risk model — a custom educational heuristic. Weights, thresholds, evidence requirements and
// cadences are this project's own choices, documented in README.md; they are not a published standard.
import type { EvidenceType, Question, Requirement, Tier } from './types';

export const QUESTIONS: readonly Question[] = [
  {
    id: 'q1', dimension: 'Data sensitivity', weight: 25,
    prompt: 'What is the most sensitive data the vendor stores, processes or can view?',
    options: [
      { id: 'none', label: 'No organisational data', points: 0 },
      { id: 'internal', label: 'Internal business data only', points: 1 },
      { id: 'personal', label: 'Personal data of staff or customers', points: 2 },
      { id: 'confidential', label: 'Financial, contractual or customer-confidential data', points: 3 },
      { id: 'regulated', label: 'Special-category or regulated data (health, payment card, government id)', points: 4 },
    ],
  },
  {
    id: 'q2', dimension: 'Access type', weight: 20,
    prompt: 'How does the vendor reach our systems?',
    options: [
      { id: 'none', label: 'No access to our systems', points: 0 },
      { id: 'portal', label: 'Portal or view-only access', points: 1 },
      { id: 'api-read', label: 'API read access', points: 2 },
      { id: 'api-write', label: 'API read-write access', points: 3 },
      { id: 'privileged', label: 'Persistent privileged access or network connectivity', points: 4 },
    ],
  },
  {
    id: 'q3', dimension: 'Business criticality', weight: 20,
    prompt: 'What happens to operations if the service stops?',
    options: [
      { id: 'none', label: 'Nothing material', points: 0 },
      { id: 'convenience', label: 'Inconvenience only', points: 1 },
      { id: 'workaround', label: 'Important, but a manual workaround exists', points: 2 },
      { id: 'degraded', label: 'Critical: operations degrade within 24 hours', points: 3 },
      { id: 'immediate', label: 'Critical: operations stop immediately', points: 4 },
    ],
  },
  {
    id: 'q4', dimension: 'Data volume', weight: 10,
    prompt: 'How many records does the vendor hold?',
    options: [
      { id: 'lt1k', label: 'Fewer than 1,000', points: 0 },
      { id: 'lt10k', label: 'Up to 10,000', points: 1 },
      { id: 'lt100k', label: 'Up to 100,000', points: 2 },
      { id: 'lt1m', label: 'Up to 1 million', points: 3 },
      { id: 'ge1m', label: '1 million or more', points: 4 },
    ],
  },
  {
    id: 'q5', dimension: 'Fourth parties', weight: 10,
    prompt: 'Does the vendor use subprocessors for our data?',
    options: [
      { id: 'none', label: 'No subprocessors', points: 0 },
      { id: 'few', label: 'One or two, named and reviewed', points: 1 },
      { id: 'several', label: 'Several, named', points: 2 },
      { id: 'unknown', label: 'Unknown or not disclosed', points: 4 },
    ],
  },
  {
    id: 'q6', dimension: 'Hosting location', weight: 5,
    prompt: 'Where is our data hosted?',
    options: [
      { id: 'onprem', label: 'On our premises (vendor does not host)', points: 0 },
      { id: 'domestic', label: 'Vendor cloud, single domestic region', points: 1 },
      { id: 'multi', label: 'Vendor cloud, multiple regions', points: 2 },
      { id: 'restricted', label: 'Jurisdiction without a transfer mechanism in place', points: 4 },
    ],
  },
  {
    id: 'q7', dimension: 'Integration depth', weight: 5,
    prompt: 'How deeply is the vendor integrated?',
    options: [
      { id: 'manual', label: 'Manual file exchange', points: 0 },
      { id: 'batch', label: 'Scheduled batch transfer', points: 2 },
      { id: 'realtime', label: 'Real-time API integration', points: 3 },
      { id: 'embedded', label: 'Embedded SDK or agent on our systems', points: 4 },
    ],
  },
  {
    id: 'q8', dimension: 'Contract value', weight: 5,
    prompt: 'What is the annual spend band?',
    options: [
      { id: 'small', label: 'Small', points: 0 },
      { id: 'moderate', label: 'Moderate', points: 2 },
      { id: 'large', label: 'Large or strategic', points: 4 },
    ],
  },
];

export const QUESTION_IDS: ReadonlySet<string> = new Set(QUESTIONS.map((q) => q.id));

/** Inclusive lower bounds on the 0–100 inherent score. */
export const TIER_THRESHOLDS = { tier1: 60, tier2: 35 } as const;

/** Hard triggers that override the score (never downward). */
export const HARD_TRIGGERS: readonly { id: string; tier: Tier; when: (points: Record<string, number>) => boolean; text: string }[] = [
  {
    id: 'regulated-privileged', tier: 1,
    when: (p) => p.q1 >= 3 && p.q2 === 4,
    text: 'Confidential or regulated data combined with persistent privileged access is always tier 1.',
  },
  {
    id: 'unknown-fourth-parties', tier: 2,
    when: (p) => p.q5 === 4 && p.q1 >= 2,
    text: 'Undisclosed subprocessors handling personal or more sensitive data is at least tier 2.',
  },
];

export const EVIDENCE_LABELS: Record<EvidenceType, string> = {
  'assurance-report': 'Independent assurance report (e.g. SOC 2 Type II report or ISO/IEC 27001 certificate)',
  'pen-test': 'Penetration test summary',
  'bcp-dr-test': 'Business continuity / disaster recovery test result',
  questionnaire: 'Completed security questionnaire',
  insurance: 'Cyber insurance certificate',
  dpa: 'Data processing agreement',
};

export const REQUIREMENTS: Record<Tier, Requirement[]> = {
  1: [
    { type: 'assurance-report', validMonths: 12 },
    { type: 'pen-test', validMonths: 12 },
    { type: 'bcp-dr-test', validMonths: 12 },
    { type: 'questionnaire', validMonths: 12 },
    { type: 'insurance', validMonths: 12 },
    { type: 'dpa', validMonths: 36 },
  ],
  2: [
    { type: 'assurance-report', validMonths: 24 },
    { type: 'questionnaire', validMonths: 12 },
    { type: 'dpa', validMonths: 36 },
  ],
  3: [{ type: 'questionnaire', validMonths: 24 }],
};

/** Periodic review cadence in months by tier. */
export const REVIEW_MONTHS: Record<Tier, number> = { 1: 12, 2: 24, 3: 36 };

export const EXPIRING_WINDOW_DAYS = 60;
export const EXCEPTION_CREDIT = 0.5;
/** An exception may run at most this many days beyond the assessment date; longer ones get no credit. */
export const MAX_EXCEPTION_DAYS = 180;
export const COVERAGE_RELIEF = 0.6; // residual = inherent × (1 − relief × coverage)
export const TIER_WEIGHT: Record<Tier, number> = { 1: 3, 2: 2, 3: 1 };
