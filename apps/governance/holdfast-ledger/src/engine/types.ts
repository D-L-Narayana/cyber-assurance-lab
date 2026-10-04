/** Holdfast Ledger domain types. All records are synthetic; nothing is ever really deleted. */

export type Trigger = 'created' | 'closed' | 'terminated' | 'last_contact';
export type DisposalAction = 'delete' | 'anonymise';

export interface System { id: string; name: string; steward: string }

export interface Schedule {
  id: string;
  name: string;
  category: string;          // record category this schedule governs
  trigger: Trigger;          // which record date starts the clock
  retainDays: number;        // retention period after the trigger
  action: DisposalAction;
  basis: string;             // plain-language reason (synthetic policy text, not legal advice)
}

export interface RecordRow {
  id: string;
  systemId: string;
  category: string;
  subjectRef: string;        // pseudonymous subject reference, e.g. "subj-0192"
  triggerDate: string;       // ISO date of the schedule trigger event
  status: 'active' | 'deleted' | 'anonymised';
}

export interface Hold {
  id: string;
  name: string;
  authority: string;         // who placed it (synthetic role)
  placedOn: string;
  releasedOn: string | null;
  scope: { systemId?: string; category?: string; subjectRef?: string; recordIds?: string[] };
}

export type HoldAction = 'release' | 'reinstate';

/** One guarded change to a hold's release state. `seq` is contiguous from 1; the trail is append-only. */
export interface HoldEvent {
  seq: number;
  holdId: string;
  action: HoldAction;
  on: string;                // ISO date the release/reinstatement takes effect
  actor: string;             // who asked for it (synthetic role or address, 1–120 chars)
  reason: string;            // why (≥ 10 chars)
}

export interface Fixture {
  schemaVersion: 1;
  label: string;
  asOf: string;
  systems: System[];
  schedules: Schedule[];
  records: RecordRow[];
  holds: Hold[];
  /** Optional (October 2026, additive): the release/reinstatement trail. Absent in legacy fixtures. */
  holdHistory?: HoldEvent[];
}

export type DueState = 'retained' | 'due' | 'overdue' | 'held' | 'disposed' | 'unscheduled';

export interface DueItem {
  recordId: string;
  scheduleId: string | null;
  dueOn: string | null;
  state: DueState;
  daysOverdue: number;
  holdIds: string[];
  action: DisposalAction | null;
}

export interface PlanItem {
  recordId: string;
  systemId: string;
  action: DisposalAction;
  decision: 'dispose' | 'skip';
  reason: string;
}

export interface Plan {
  id: string;                 // sha256 over asOf + candidate record ids + active hold ids (idempotent)
  asOf: string;
  items: PlanItem[];
  counts: { dispose: number; skip: number };
}

export interface Receipt {
  seq: number;
  planId: string;
  recordId: string;
  systemId: string;
  action: DisposalAction;
  executedOn: string;
  recordHash: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerification { ok: boolean; checked: number; brokenAt: number | null; reason: string | null }

export interface Reconciliation {
  planId: string;
  ok: boolean;
  missing: string[];      // record ids planned for disposal with no receipt
  unexpected: string[];   // receipts for records not planned
  skipped: number;
}
