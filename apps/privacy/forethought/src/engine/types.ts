/** Forethought domain types. Educational PIA model; not legal advice. */

export type Theme =
  | 'lawfulness'
  | 'minimisation'
  | 'transparency'
  | 'rights'
  | 'security'
  | 'retention'
  | 'third-party'
  | 'cross-border'
  | 'vulnerable-subjects'
  | 'automated-decisions';

export const THEMES: Theme[] = ['lawfulness', 'minimisation', 'transparency', 'rights', 'security', 'retention', 'third-party', 'cross-border', 'vulnerable-subjects', 'automated-decisions'];

export const THEME_LABEL: Record<Theme, string> = {
  lawfulness: 'Lawful basis and purpose',
  minimisation: 'Data minimisation',
  transparency: 'Transparency',
  rights: 'Individual rights',
  security: 'Security of processing',
  retention: 'Retention',
  'third-party': 'Third-party sharing',
  'cross-border': 'Cross-border transfer',
  'vulnerable-subjects': 'Children and vulnerable people',
  'automated-decisions': 'Automated decisions and profiling',
};

export interface Effect {
  theme: Theme;
  likelihood?: number;
  impact?: number;
}

export interface Option {
  id: string;
  label: string;
  effects: Effect[];
}

export interface Question {
  id: string;
  prompt: string;
  help?: string;
  options: Option[];
  /** Progressive disclosure: only shown when the referenced question has one of these answers. */
  showIf?: { questionId: string; optionIds: string[] };
}

export interface Mitigation {
  id: string;
  name: string;
  description: string;
  themes: Theme[];
  reduces: 'likelihood' | 'impact';
  by: 1 | 2;
  /** When true the mitigation only counts once verified with an evidence reference. */
  requiresEvidence: boolean;
}

export type MitigationStatus = 'planned' | 'implemented' | 'verified';

export interface AppliedMitigation {
  mitigationId: string;
  status: MitigationStatus;
  evidenceRef?: string;
  owner?: string;
}

export type ApproverRole = 'product-owner' | 'data-protection-lead';

export interface RiskAcceptance {
  theme: Theme;
  acceptedBy: ApproverRole;
  acceptedByName: string;
  rationale: string;
  acceptedOn: string;
}

export interface DataFlow {
  id: string;
  from: string;
  to: string;
  dataCategories: string[];
  /** Whether the destination is outside the origin region of the data subjects. */
  outsideOriginRegion: boolean;
  mechanism: 'adequacy' | 'standard-contractual-clauses' | 'binding-corporate-rules' | 'none' | 'not-applicable';
}

export interface Signature {
  role: ApproverRole;
  name: string;
  signedAt: string;
  contentHash: string;
}

export interface Version {
  number: number;
  at: string;
  contentHash: string;
  changeSummary: string[];
  /**
   * Canonical content JSON (see `canonicalContent`) of the assessment at this version, so the next
   * snapshot can produce a field-level change summary after export/import. Optional: legacy files
   * omit it, and `snapshot` omits it when the canonical content exceeds 64 KiB.
   */
  content?: string;
}

export interface Assessment {
  schema: 'forethought.assessment';
  version: 1;
  id: string;
  title: string;
  owner: string;
  description: string;
  asOf: string;
  answers: Record<string, string>; // questionId -> optionId
  mitigations: AppliedMitigation[];
  flows: DataFlow[];
  acceptances: RiskAcceptance[];
  dpoConsulted: boolean;
  signatures: Signature[];
  versions: Version[];
}

export type Band = 'low' | 'medium' | 'high' | 'very-high';

export interface ThemeScore {
  theme: Theme;
  inherent: { likelihood: number; impact: number; score: number; band: Band };
  residual: { likelihood: number; impact: number; score: number; band: Band };
  /** Residual if every planned mitigation were implemented. */
  projected: { likelihood: number; impact: number; score: number; band: Band };
  contributingAnswers: Array<{ questionId: string; optionId: string; likelihood: number; impact: number }>;
  activeMitigations: string[];
  plannedMitigations: string[];
  acceptance?: RiskAcceptance;
}

export interface Scorecard {
  themes: ThemeScore[];
  overall: { inherent: Band; residual: Band; projected: Band };
  highThemes: Theme[];
  isDpiaScale: boolean;
}

export type BlockerCode =
  | 'UNANSWERED_QUESTIONS'
  | 'HIGH_RESIDUAL_WITHOUT_ACCEPTANCE'
  | 'VERY_HIGH_NEEDS_DP_LEAD'
  | 'UNRESOLVED_TRANSFER'
  | 'DPO_NOT_CONSULTED'
  | 'EVIDENCE_MISSING';

export interface Blocker {
  code: BlockerCode;
  message: string;
  subject?: string;
}
