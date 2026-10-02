/** Outflow Register domain types. Synthetic agreements, vendors and flows; no real contracts. */

export type AgreementStatus = 'draft' | 'active' | 'renewing' | 'expired' | 'terminated';
export type ObligationKind = 'encryption' | 'subprocessor_notice' | 'deletion_on_termination' | 'breach_notification' | 'audit_right' | 'access_review';

export interface Vendor { id: string; name: string; country: string; role: 'processor' | 'controller' | 'joint' }
export interface Owner { id: string; name: string; status: 'active' | 'left' }
export interface InternalSystem { id: string; name: string }

export interface Obligation {
  id: string;
  kind: ObligationKind;
  /** e.g. "AES-256 at rest", "72h", "annual" */
  requirement: string;
  evidence: { ref: string; on: string } | null;
}

export interface Agreement {
  id: string;
  title: string;
  vendorId: string;
  ownerId: string | null;
  status: AgreementStatus;
  startOn: string;
  endOn: string;
  noticeDays: number;
  categories: string[];        // data categories the agreement permits
  purpose: string;
  transferMechanism: string;   // label only, e.g. "standard contractual clauses (synthetic label)"
  obligations: Obligation[];
}

export interface Flow {
  id: string;
  systemId: string;
  vendorId: string;
  agreementId: string | null;
  categories: string[];
  direction: 'outbound' | 'inbound' | 'bidirectional';
  active: boolean;
  lastTransferOn: string | null;
}

export interface HistoryEntry { seq: number; agreementId: string; from: AgreementStatus; to: AgreementStatus; on: string; reason: string; note?: string }

export interface Register {
  schemaVersion: 1;
  label: string;
  asOf: string;
  restrictedCategories: string[];
  systems: InternalSystem[];
  vendors: Vendor[];
  owners: Owner[];
  agreements: Agreement[];
  flows: Flow[];
  history: HistoryEntry[];
}

export type IssueKind =
  | 'missing_owner' | 'expired_but_active' | 'renewal_window_open' | 'flow_without_agreement' | 'flow_category_not_covered'
  | 'flow_after_end' | 'flow_under_draft' | 'deletion_obligation_unmet' | 'obligation_no_evidence' | 'contradictory_breach_window' | 'stale_flow' | 'vendor_mismatch';

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: 'high' | 'medium' | 'low';
  agreementId: string | null;
  flowId: string | null;
  vendorId: string;
  detail: string;
}

export interface PriorityBreakdown { factor: string; points: number; note: string }
export interface RenewalPriority { agreementId: string; score: number; breakdown: PriorityBreakdown[]; daysToEnd: number | null }
