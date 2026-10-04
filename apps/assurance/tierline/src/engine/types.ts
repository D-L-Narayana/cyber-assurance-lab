// Tierline engine types. Pure data; no DOM.

export interface QuestionOption {
  id: string;
  label: string;
  points: 0 | 1 | 2 | 3 | 4;
}

export interface Question {
  id: string; // q1..q8
  dimension: string;
  prompt: string;
  weight: number; // sums to 100 across the questionnaire
  options: QuestionOption[];
}

export type Tier = 1 | 2 | 3;

export type EvidenceType = 'assurance-report' | 'pen-test' | 'bcp-dr-test' | 'questionnaire' | 'insurance' | 'dpa';
export const EVIDENCE_TYPES: readonly EvidenceType[] = ['assurance-report', 'pen-test', 'bcp-dr-test', 'questionnaire', 'insurance', 'dpa'];

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  issuedOn: string; // ISO date
  validMonths: number; // 1..60
  note?: string;
}

export interface Exception {
  id: string;
  evidenceType: EvidenceType;
  approvedBy: string;
  rationale: string;
  expiresOn: string; // ISO date
}

export interface Vendor {
  id: string;
  name: string; // synthetic, e.g. "Northwind Freight Analytics"
  service: string;
  owner: string; // internal relationship owner handle
  answers: Record<string, string>; // questionId -> optionId
  evidence: EvidenceItem[];
  exceptions: Exception[];
  lastReviewOn?: string; // ISO date
  recordedTier?: Tier; // tier as last recorded; drift vs computed is a queue item
}

export interface Register {
  schema: 'tierline.register/1';
  asOf: string;
  vendors: Vendor[];
}

export interface Requirement {
  type: EvidenceType;
  validMonths: number;
}

export type RequirementState = 'valid' | 'expiring' | 'expired' | 'missing' | 'future-dated' | 'exception' | 'exception-expired' | 'exception-out-of-policy';

export interface RequirementResult {
  type: EvidenceType;
  state: RequirementState;
  evidenceId?: string;
  exceptionId?: string;
  expiresOn?: string;
  daysLeft?: number;
  credit: number; // 1 valid/expiring, 0.5 exception, 0 otherwise
}

export interface Flip {
  questionId: string;
  fromOptionId: string;
  toOptionId: string;
  newTier: Tier;
  direction: 'up' | 'down';
  deltaScore: number;
}

export interface VendorAssessment {
  vendorId: string;
  inherent: number; // 0..100
  tier: Tier;
  tierReasons: string[];
  hardTriggers: string[];
  contributions: { questionId: string; dimension: string; points: number; weight: number; contribution: number }[];
  distanceToNextTierUp: number | null; // score points needed to go up a tier (null at tier 1)
  distanceToTierDown: number | null; // score points to drop a tier (null at tier 3 or when hard-triggered)
  flips: Flip[]; // single-answer changes that change the tier
  requirements: RequirementResult[];
  coverage: number; // 0..1
  residual: number; // 0..100
  reviewDueOn: string | null;
  reviewOverdue: boolean;
  unanswered: string[];
}

export type QueueKind =
  | 'missing-evidence'
  | 'expired-evidence'
  | 'expiring-evidence'
  | 'exception-expired'
  | 'exception-expiring'
  | 'exception-out-of-policy'
  | 'future-dated-evidence'
  | 'review-overdue'
  | 'review-due-soon'
  | 'tier-drift'
  | 'incomplete-questionnaire';

export interface QueueItem {
  vendorId: string;
  vendorName: string;
  tier: Tier;
  kind: QueueKind;
  detail: string;
  dueOn: string | null;
  daysOverdue: number; // negative when not yet due
  priority: number;
}

/** What will lapse within a forecast horizon if nothing new is filed (October 2026 round). */
export type ForecastKind = 'evidence-lapses' | 'exception-expires' | 'review-due';

export interface ForecastItem {
  vendorId: string;
  vendorName: string;
  tier: Tier;
  kind: ForecastKind;
  detail: string;
  lapsesOn: string; // ISO date: last day of credit (evidence/exception expiry) or the review due date
  daysUntil: number; // daysBetween(asOf, lapsesOn); 0 = lapses after today
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; register: Register } | { ok: false; issues: ValidationIssue[] };
