/** Tenure domain types: a synthetic data inventory with retention schedules and flows. */

export type Region = 'EU' | 'UK' | 'US' | 'IN' | 'SG' | 'BR';

export type DataCategory =
  | 'identifier'
  | 'contact'
  | 'financial'
  | 'behavioural'
  | 'special-category'
  | 'credentials'
  | 'technical'
  | 'employment';

export type TransferMechanism = 'adequacy' | 'standard-contractual-clauses' | 'binding-corporate-rules' | 'none' | 'not-applicable';

export interface Owner {
  id: string;
  name: string; // fictional
  team: string;
  active: boolean;
  leftOn?: string; // YYYY-MM-DD
}

export interface System {
  id: string;
  name: string;
  ownerId?: string;
  region: Region;
  hosting: 'internal' | 'vendor';
  vendor?: string;
  purposes: string[];
}

export interface RetentionSchedule {
  id: string;
  name: string;
  days: number;
  trigger: 'collection' | 'last-activity' | 'contract-end' | 'employment-end';
  reviewEveryDays: number;
  reference?: string;
}

export interface DataElement {
  id: string;
  name: string;
  category: DataCategory;
  systemId: string;
  purposes: string[];
  scheduleId?: string;
  /** Overrides the schedule's period for this element in this system. */
  retentionDaysOverride?: number;
  sensitivity: 1 | 2 | 3 | 4;
  lastReviewedOn?: string;
  subjectCount?: number;
}

export interface Flow {
  id: string;
  fromSystemId: string;
  toSystemId: string;
  elementIds: string[];
  mechanism: TransferMechanism;
  description?: string;
}

export type ExceptionStatus = 'proposed' | 'approved' | 'expired' | 'rejected';

export type ExceptionSubjectKind = 'element' | 'flow';

/**
 * What an exception accepts: an element (`element-id`), a whole flow (`flow-id`, for UNMAPPED_TRANSFER /
 * DANGLING_FLOW) or one element carried by a flow (`flow-id/element-id`, for PURPOSE_DRIFT). Matching is exact.
 */
export interface ExceptionSubject { kind: ExceptionSubjectKind; id: string }

export interface RetentionException {
  id: string;
  /** Legacy subject (element id). Honoured when `subject` is absent; kept populated for element exceptions so older exports stay readable. */
  elementId?: string;
  /** October 2026 (additive, optional): explicit subject; when present it takes precedence over `elementId`. */
  subject?: ExceptionSubject;
  /** Finding code this exception accepts, e.g. RETENTION_INFLATION. */
  acceptsFinding: FindingCode;
  rationale: string;
  approvedBy?: string; // owner id
  approvedOn?: string;
  expiresOn: string;
  status: ExceptionStatus;
}

export interface Catalog {
  schema: 'tenure.catalog';
  version: 1;
  asOf: string;
  owners: Owner[];
  systems: System[];
  schedules: RetentionSchedule[];
  elements: DataElement[];
  flows: Flow[];
  exceptions: RetentionException[];
}

export type FindingCode =
  | 'ORPHAN_ELEMENT'
  | 'MISSING_OWNER'
  | 'INACTIVE_OWNER'
  | 'MISSING_SCHEDULE'
  | 'SPECIAL_CATEGORY_UNSCHEDULED'
  | 'RETENTION_INFLATION'
  | 'PURPOSE_DRIFT'
  | 'UNMAPPED_TRANSFER'
  | 'FLOW_CYCLE'
  | 'DANGLING_FLOW'
  | 'EXCEPTION_EXPIRED'
  | 'EXCEPTION_APPROVER_INACTIVE'
  | 'EXCEPTION_OUT_OF_POLICY'
  | 'REVIEW_OVERDUE';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  id: string;
  code: FindingCode;
  severity: Severity;
  /** Node the finding is attached to (system id, element id or flow id). */
  subject: { kind: 'system' | 'element' | 'flow' | 'exception'; id: string };
  systemId?: string;
  message: string;
  /** Plain-language explanation of why this matters. */
  why: string;
  /** Whether an approved, unexpired exception covers this finding. */
  accepted: boolean;
  exceptionId?: string;
}

export interface NormalisationNote {
  path: string;
  from: string;
  to: string;
  rule: string;
}

export interface GraphNode {
  id: string;
  system: System;
  /** Longest-path layer from source systems (0 = no inbound flows). */
  layer: number;
  elementCount: number;
  maxRetentionDays: number;
  inbound: number;
  outbound: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  elementIds: string[];
  mechanism: TransferMechanism;
  crossRegion: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
}

export interface ReviewItem {
  elementId: string;
  systemId: string;
  effectiveRetentionDays: number;
  reviewEveryDays: number;
  lastReviewedOn?: string;
  nextReviewOn?: string;
  status: 'never-reviewed' | 'overdue' | 'due-soon' | 'current';
  daysUntilDue?: number;
}
