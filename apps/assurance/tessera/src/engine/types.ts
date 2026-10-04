// Tessera engine types. Pure data; no DOM.

export type CsfFunction = 'GV' | 'ID' | 'PR' | 'DE' | 'RS' | 'RC';

export interface Subcategory {
  id: string; // e.g. "PR.AA-05"
  fn: CsfFunction;
  functionName: string;
  category: string; // e.g. "PR.AA"
  categoryName: string;
  statement: string;
}

export type EvidenceType =
  | 'policy'
  | 'procedure'
  | 'configuration'
  | 'log-sample'
  | 'report'
  | 'attestation'
  | 'ticket';

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'policy',
  'procedure',
  'configuration',
  'log-sample',
  'report',
  'attestation',
  'ticket',
];

export interface Evidence {
  id: string;
  title: string;
  type: EvidenceType;
  subcategoryIds: string[];
  collectedOn: string; // ISO date YYYY-MM-DD
  validDays: number; // how long this artifact is considered current
  scope: 'full' | 'partial';
  assertion: 'supports' | 'refutes';
  source: string; // synthetic system name, e.g. "idp.example"
  note?: string;
}

export type Verdict = 'accepted' | 'gap' | 'needs-more' | 'not-applicable';

export interface Decision {
  subcategoryId: string;
  reviewer: string;
  verdict: Verdict;
  rationale: string;
  decidedOn: string; // ISO date
}

/** Target-profile priority: 3 = critical outcome for this organisation, 1 = low. */
export type Priority = 1 | 2 | 3;

export interface Profile {
  name: string;
  asOf: string; // evaluation date, ISO
  priorities: Record<string, Priority>; // subcategoryId -> priority; missing = 2
}

export interface EvidencePack {
  schema: 'tessera.pack/1';
  profile: Profile;
  evidence: Evidence[];
  decisions: Decision[];
}

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface EvidenceAssessment {
  evidenceId: string;
  freshness: Freshness;
  ageDays: number;
  weight: number; // contribution to coverage after freshness and scope
}

export type Status =
  | 'sufficient'
  | 'partial'
  | 'weak'
  | 'none'
  | 'contradicted'
  | 'refuted'
  | 'accepted-risk' // reviewer accepted an outcome with no current evidence: an explicit gap, never 'sufficient'
  | 'not-applicable';

export type RiskBand = 'low' | 'moderate' | 'high';
export type RollupBand = RiskBand | 'not-assessed';

export interface SubcategoryResult {
  subcategoryId: string;
  status: Status;
  computedStatus: Status; // before reviewer overlay
  coverage: number; // 0..n weighted
  distinctTypes: number;
  evidence: EvidenceAssessment[];
  contradictions: string[]; // evidence ids that refute while others support
  priority: Priority;
  residual: number; // 0..3
  band: RiskBand;
  override: boolean; // reviewer accepted despite weak computed status
  overrideValid: boolean; // rationale long enough
  decision?: Decision;
  decisionAgeDays?: number; // age of the decision at asOf; decisions older than DECISION_VALID_DAYS are ignored
  reasons: string[]; // human readable trace of how status was derived
  warnings: string[]; // reviewer actions that were refused or need attention
  remediation?: string;
}

export interface FunctionRollup {
  fn: CsfFunction;
  functionName: string;
  count: number;
  assessed: number; // outcomes that are not scoped out as not-applicable
  sufficient: number;
  meanResidual: number | null; // null when nothing in the function was assessed
  band: RollupBand;
}

/** One evidence item whose freshness differs between the evaluation date and the projected date. */
export interface ForecastDriver {
  evidenceId: string;
  from: Freshness;
  to: Freshness;
}

/** Projection of one outcome at `profile.asOf + horizonDays` with no new evidence and no new decisions. */
export interface ForecastRow {
  horizonDays: number;
  asOf: string; // projected evaluation date (profile.asOf + horizonDays), ISO
  subcategoryId: string;
  statusNow: Status;
  statusThen: Status;
  residualNow: number;
  residualThen: number;
  bandNow: RiskBand;
  bandThen: RiskBand;
  degrades: boolean; // residual (status exposure × priority) is higher at the horizon — status or band worsens
  drivers: ForecastDriver[]; // freshness transitions of the related evidence, sorted by evidence id
  decisionLapses: boolean; // the recorded decision is within DECISION_VALID_DAYS today but not at the horizon
}

export interface ForecastDriverCount extends ForecastDriver {
  outcomes: number; // degrading outcomes at that horizon that this transition contributes to
}

export interface ForecastSummaryEntry {
  horizonDays: number;
  asOf: string;
  outcomes: number;
  degrading: number;
  decisionLapses: number;
  topDrivers: ForecastDriverCount[];
}

export interface ForecastBlock {
  horizons: number[];
  rows: ForecastRow[];
  note: string;
}

export interface Report {
  schema: 'tessera.report/1';
  generatedFor: string; // profile name
  asOf: string;
  framework: string;
  subset: string;
  results: SubcategoryResult[];
  rollups: FunctionRollup[];
  gaps: SubcategoryResult[];
  scoringNote: string;
  decisionPolicy: string;
  disclaimer: string;
  forecast?: ForecastBlock; // additive (October 2026): present only when the report was built with a forecast
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; pack: EvidencePack }
  | { ok: false; issues: ValidationIssue[] };
