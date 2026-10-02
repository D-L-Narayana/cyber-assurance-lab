export const EVIDENCE_TYPES = ['threat-model', 'code-review', 'unit-tests', 'sast', 'dependency-review', 'secret-scan', 'security-retest'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const ROLES = ['developer', 'reviewer', 'security', 'release-manager'] as const;
export type RoleName = (typeof ROLES)[number];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Identity { id: string; label: string; roles: RoleName[] }
export interface Change { path: string; kind: 'added' | 'modified' | 'deleted' }
export interface FindingRecord { id: string; title: string; severity: Severity; status: 'open' | 'fixed' | 'accepted' }
export interface Evidence {
  id: string;
  type: EvidenceType;
  producedAt: string;
  commit: string;
  producedBy: string;
  result?: 'pass' | 'warn' | 'fail';
  reviewers?: string[];
  scope?: string[];
  artifact?: string;
  artifactHash?: string;
  findings?: FindingRecord[];
}
export interface Acceptance { id: string; findingRef: string; approvedBy: string; approvedAt: string; expiresAt: string; rationale: string }
export interface Manifest {
  schema: 'provgate.release/1';
  release: { id: string; name: string; version: string; commit: string; author: string; createdAt: string };
  identities: Identity[];
  changes: Change[];
  evidence: Evidence[];
  acceptances: Acceptance[];
}

export interface ChangeClass { id: string; label: string; match: string[]; requires: EvidenceType[]; minReviewers?: number }
export interface Policy {
  schema: 'provgate.policy/1';
  name: string;
  maxEvidenceAgeDays: number;
  requireSameCommit: EvidenceType[];
  baseline: EvidenceType[];
  minReviewers: number;
  reviewerRole: RoleName;
  changeClasses: ChangeClass[];
  blockOnOpenFindingsAtOrAbove: Severity;
  acceptance: { approverRole: RoleName; maxDays: number; approverMayBeAuthor: boolean };
}

export type ProblemCode =
  | 'missing' | 'stale' | 'future-dated' | 'wrong-commit' | 'hash-mismatch' | 'failed'
  | 'self-review' | 'insufficient-reviewers' | 'reviewer-role' | 'scope-gap' | 'scope-missing';
export type AcceptanceProblemCode = 'expired' | 'not-yet-effective' | 'too-long' | 'approver-role' | 'approver-is-author' | 'unknown-finding';
export interface Problem<C extends string = ProblemCode> { code: C; detail: string }

export type HashStatus = 'verified' | 'mismatch' | 'unverified';

export interface RequirementResult {
  type: EvidenceType;
  requiredBy: string[];
  evidenceId?: string;
  alternatives: string[];
  problems: Problem[];
  hashStatus: HashStatus;
  ageDays?: number;
  satisfied: boolean;
}

export interface FindingEvaluation {
  id: string;
  title: string;
  severity: Severity;
  status: FindingRecord['status'];
  source: string;
  blocking: boolean;
  reason: string;
  acceptance?: { id: string; approvedBy: string; expiresAt: string; problems: Problem<AcceptanceProblemCode>[] };
}

export type Verdict = 'release' | 'release-with-accepted-risk' | 'blocked';

export interface Evaluation {
  asOf: string;
  verdict: Verdict;
  classes: { id: string; label: string; paths: string[] }[];
  minReviewers: number;
  requirements: RequirementResult[];
  findings: FindingEvaluation[];
  blockers: string[];
  warnings: string[];
}
