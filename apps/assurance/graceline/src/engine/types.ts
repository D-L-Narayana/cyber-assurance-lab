// Graceline engine types. Pure data; no DOM.

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'moderate', 'high', 'critical'];

export type State = 'draft' | 'submitted' | 'under-review' | 'active' | 'expired' | 'escalated' | 'closed' | 'rejected' | 'withdrawn';
export const STATES: readonly State[] = ['draft', 'submitted', 'under-review', 'active', 'expired', 'escalated', 'closed', 'rejected', 'withdrawn'];

export type Role = 'manager' | 'risk-owner' | 'ciso' | 'control-owner';
export const ROLES: readonly Role[] = ['manager', 'risk-owner', 'ciso', 'control-owner'];

export interface Approval {
  approver: string;
  role: Role;
  decidedOn: string; // ISO date
  note: string;
}

export interface Remediation {
  plan: string;
  dueOn: string; // ISO date
  status: 'planned' | 'in-progress' | 'done';
}

export interface HistoryEntry {
  at: string; // ISO date
  event: string;
  actor: string;
  from: State;
  to: State;
  note: string;
}

export interface Exception {
  id: string;
  title: string;
  policyRef: string; // e.g. "SEC-POL-07 §4.2 Patch timelines"
  riskLevel: RiskLevel;
  requester: string;
  owner: string; // accountable for the accepted risk
  compensatingControls: string[];
  justification: string;
  requestedOn: string;
  startOn: string;
  expiresOn: string;
  renewals: number;
  state: State;
  approvals: Approval[];
  remediation: Remediation;
  closure?: { evidence: string; closedBy: string; closedOn: string };
  /** A renewal awaiting approval. The current term keeps running (expiry, escalation) until the quorum approves. */
  pendingRenewal?: { newExpiresOn: string; requestedBy: string; requestedOn: string; note: string };
  history: HistoryEntry[];
}

export interface Board {
  schema: 'graceline.board/1';
  asOf: string;
  exceptions: Exception[];
}

export type Event =
  | { type: 'submit'; actor: string }
  | { type: 'start-review'; actor: string }
  | { type: 'approve'; actor: string; role: Role; note: string }
  | { type: 'reject'; actor: string; note: string }
  | { type: 'withdraw'; actor: string; note: string }
  | { type: 'renew'; actor: string; newExpiresOn: string; note: string }
  | { type: 'update-remediation'; actor: string; status: Remediation['status']; note: string }
  | { type: 'close'; actor: string; evidence: string };

export interface Derived {
  id: string;
  state: State;
  daysToExpiry: number; // negative when past
  expiring: boolean; // active and within the warning window
  overdueDays: number; // days past expiry (0 if not past)
  quorum: { required: string; have: number; need: number; met: boolean; missingRoles: Role[] };
  guardrails: string[]; // policy violations present on the record right now
  priority: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; board: Board } | { ok: false; issues: ValidationIssue[] };
