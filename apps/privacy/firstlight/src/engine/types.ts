/** Firstlight domain types. Synthetic incidents only; not notification advice. */

export type Jurisdiction = 'EU-GDPR' | 'UK-GDPR' | 'US-CA';

export type EventKind = 'occurred' | 'detected' | 'aware' | 'contained' | 'evidence' | 'escalated' | 'note';

export interface IncidentEvent {
  id: string;
  at: string; // ISO timestamp
  kind: EventKind;
  source: string;
  summary: string;
  /** Marks free text that may contain personal data and must be masked in the packet preview. */
  personal?: boolean;
}

export type DataClass = 'simple' | 'behavioural' | 'financial' | 'sensitive';

export interface DataScopeItem {
  id: string;
  category: string; // e.g. "email address"
  dataClass: DataClass;
  subjects: number;
  records: number;
  encrypted: boolean;
  /** Which security property was lost for this item. */
  exposure: Array<'confidentiality' | 'integrity' | 'availability'>;
  /** Approximate count (true) vs confirmed from logs (false). */
  estimate: boolean;
}

export type EaseOfIdentification = 'negligible' | 'limited' | 'significant' | 'maximum';

export interface Circumstances {
  confidentialityLoss: 'none' | 'known-recipients' | 'unknown-recipients';
  integrityLoss: 'none' | 'recoverable' | 'unrecoverable';
  availabilityLoss: 'none' | 'temporary' | 'permanent';
  maliciousIntent: boolean;
  /** Adjustment applied to the data-processing-context score (-3..+3) with a required justification. */
  dpcAdjustment: number;
  dpcJustification: string;
  easeOfIdentification: EaseOfIdentification;
}

export type TaskStatus = 'open' | 'in-progress' | 'done' | 'not-applicable';

export interface ContainmentTask {
  id: string;
  title: string;
  status: TaskStatus;
  evidenceRef?: string;
  owner?: string;
}

export type FactKey =
  | 'nature'
  | 'categoriesOfSubjects'
  | 'approxSubjects'
  | 'categoriesOfRecords'
  | 'approxRecords'
  | 'contactPoint'
  | 'likelyConsequences'
  | 'measuresTaken'
  | 'measuresProposed'
  | 'awarenessBasis'
  | 'crossBorderElements';

export interface IncidentBundle {
  schema: 'firstlight.incident';
  version: 1;
  id: string;
  title: string;
  incidentType: 'misdirected-email' | 'lost-device' | 'unauthorised-access' | 'misconfiguration' | 'ransomware' | 'insider';
  jurisdictions: Jurisdiction[];
  controllerRole: 'controller' | 'processor';
  events: IncidentEvent[];
  dataScope: DataScopeItem[];
  circumstances: Circumstances;
  containment: ContainmentTask[];
  facts: Partial<Record<FactKey, string>>;
  /** Tokens (names, emails) that the redaction preview must mask wherever they appear. */
  personalTokens: string[];
}

export interface SequenceIssue {
  code: 'DUPLICATE_EVENT' | 'OUT_OF_ORDER' | 'MISSING_AWARENESS' | 'MISSING_DETECTION' | 'AWARE_BEFORE_DETECTED' | 'CONTAINED_BEFORE_DETECTED' | 'LARGE_GAP';
  message: string;
  eventIds: string[];
}

export interface Timeline {
  events: IncidentEvent[]; // deduplicated, sorted
  duplicatesRemoved: IncidentEvent[];
  issues: SequenceIssue[];
  occurredAt?: string;
  detectedAt?: string;
  awareAt?: string;
  containedAt?: string;
}

export interface ClockState {
  jurisdiction: Jurisdiction;
  rule: 'fixed-72h' | 'fixed-30d';
  /** Human label for the window, e.g. "72 hours" or "30 calendar days". */
  windowLabel: string;
  windowHours: number;
  awareAt?: string;
  deadlineAt?: string;
  elapsedHours?: number;
  remainingHours?: number;
  phase: 'clock-not-started' | 'within-window' | 'window-exceeded';
  note: string;
}

export interface SeverityBreakdown {
  dpcBase: number;
  dpcAdjusted: number;
  dpcClass: DataClass;
  ei: number;
  cb: { confidentiality: number; integrity: number; availability: number; malicious: number; total: number };
  se: number;
  band: 'low' | 'medium' | 'high' | 'very-high';
  rationale: string[];
}

export interface ScopeSummary {
  byClass: Record<DataClass, { items: number; subjects: number; records: number }>;
  /** Largest single-item subject count. A LOWER BOUND on affected people: overlap between items is unknown, so counts are not summed. */
  subjectsLowerBound: number;
  totalRecords: number;
  encryptedShare: number; // 0..1 of records encrypted
  anyEstimate: boolean;
  highestClass: DataClass;
}

export interface ReadinessItem {
  key: FactKey | 'timelineEstablished' | 'containmentComplete' | 'severityAssessed' | 'highRiskAssessed';
  label: string;
  required: boolean;
  present: boolean;
  source: 'facts' | 'derived';
  note?: string;
}

export interface Readiness {
  items: ReadinessItem[];
  requiredTotal: number;
  requiredPresent: number;
  completeness: number; // 0..1
  missing: string[];
}
