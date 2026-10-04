/** Labelsmith domain types. Synthetic fixtures only. */

export type DataClass =
  | 'public' | 'internal' | 'confidential'
  | 'restricted-pii' | 'restricted-financial' | 'restricted-health'
  | 'secret-credential' | 'unknown';

export const CLASS_RANK: Record<DataClass, number> = {
  public: 0, internal: 1, confidential: 2,
  'restricted-pii': 3, 'restricted-financial': 3, 'restricted-health': 3,
  'secret-credential': 4, unknown: -1,
};

export type FieldType = 'string' | 'number' | 'date' | 'boolean';

export interface Field {
  id: string;
  system: string;
  table: string;
  name: string;
  type: FieldType;
  description?: string;
  declaredClass?: DataClass;
  /** Synthetic sample values (strings). Generated, never copied from a real dataset. */
  samples: string[];
}

export type ValueCheck =
  | 'luhn' | 'email' | 'iban' | 'phone' | 'dob' | 'apikey' | 'jwt' | 'ipv4'
  | 'national-id' | 'icd10' | 'password-hash' | 'geo' | 'money' | 'hex-digest';

/** How `nameTokens` are compared with the normalised field name (October 2026 round). */
export type NameMatchMode = 'token' | 'substring';

export interface Rule {
  id: string;
  name: string;
  /** Lower-case keywords matched against the normalised field name. Not regex: user-supplied rules stay safe. */
  nameTokens?: string[];
  /** `token` (default): a keyword must equal a whole underscore token or a contiguous token sequence of the field name. `substring`: legacy containment. */
  match?: NameMatchMode;
  /** Field-name tokens (or token sequences) whose presence vetoes this rule entirely, in either match mode. */
  exceptTokens?: string[];
  /** Built-in value shape check applied to samples. */
  valueCheck?: ValueCheck;
  /** Fraction of non-empty samples that must satisfy the value check (default 0.6). */
  minSampleRatio?: number;
  /** When both nameTokens and valueCheck exist: 'any' fires on either, 'all' requires both. */
  combine?: 'any' | 'all';
  class: DataClass;
  weight: number; // 0..1 confidence contribution
  explanation: string;
  builtIn?: boolean;
}

export interface RuleTrace {
  ruleId: string;
  name: string;
  class: DataClass;
  /** `suppressed`: the rule would have matched on the name but an exception token or an allow-list token discounted it. */
  outcome: 'matched' | 'not-matched' | 'skipped' | 'suppressed';
  reason: string;
  weight: number;
}

export interface Classification {
  fieldId: string;
  computedClass: DataClass;
  confidence: number;
  trace: RuleTrace[];
  needsReview: boolean;
  reviewReasons: string[];
  declaredMismatch: { declared: DataClass; computed: DataClass } | null;
}

export interface HandlingPolicy {
  class: DataClass;
  summary: string;
  encryptionAtRest: 'required' | 'recommended' | 'not-required';
  maskInLogs: boolean;
  maskInUi: boolean;
  externalSharing: 'allowed' | 'with-agreement' | 'prohibited';
  retentionMaxMonths: number | null;
  accessReviewDays: number | null;
  approvedStores: string[];
}

export interface Exception {
  id: string;
  fieldId: string;
  fromClass: DataClass;
  toClass: DataClass;
  justification: string;
  approvedBy: string;
  grantedOn: string;
  expiresOn: string;
}

export interface Fixture {
  schemaVersion: 1;
  label: string;
  asOf: string;
  fields: Field[];
  exceptions?: Exception[];
}

export interface EffectiveLabel {
  fieldId: string;
  computedClass: DataClass;
  effectiveClass: DataClass;
  exception: (Exception & { status: 'active' | 'expired' }) | null;
  policy: HandlingPolicy;
  classification: Classification;
}
