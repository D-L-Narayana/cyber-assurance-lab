// Packetsmith engine types. Pure data; no DOM.

export type Method = 'examine' | 'interview' | 'test';

export interface Determination {
  id: string; // e.g. "AC-2.a"
  text: string; // paraphrased determination statement
}

export interface Control {
  id: string;
  title: string;
  family: string;
  summary: string;
  determinations: Determination[];
  objects: Record<Method, string[]>; // example assessment objects per method
}

export type StepStatus = 'planned' | 'performed' | 'skipped';

export interface Step {
  id: string;
  controlId: string;
  method: Method;
  object: string; // what was examined / who was interviewed / what was tested
  status: StepStatus;
  skipReason?: string;
  evidenceIds: string[]; // artifact ids
  notes: string;
}

export type ArtifactKind = 'screenshot-description' | 'config-snippet' | 'log-excerpt' | 'document-excerpt' | 'interview-note';
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['screenshot-description', 'config-snippet', 'log-excerpt', 'document-excerpt', 'interview-note'];

export interface Artifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  content: string; // synthetic textual content; hashed
  capturedOn: string; // ISO date
  sha256: string; // hex, lower-case; recomputed on load and compared
}

export type DeterminationOutcome = 'satisfied' | 'other-than-satisfied' | 'not-assessed';

export interface DeterminationResult {
  controlId: string;
  determinationId: string;
  result: DeterminationOutcome;
  stepIds: string[]; // steps that support the result
  rationale: string;
}

export type Severity = 'low' | 'moderate' | 'high';

export interface Finding {
  id: string;
  controlId: string;
  determinationId: string;
  description: string;
  severity: Severity;
  action: {
    description: string;
    owner: string;
    dueOn: string; // ISO date
    status: 'open' | 'in-progress' | 'completed';
  };
}

export type PacketState = 'drafting' | 'ready-for-review' | 'approved' | 'returned';

export interface HistoryEntry {
  at: string; // ISO date
  from: PacketState;
  to: PacketState;
  actor: string;
  note: string;
  /** Hash of the previous entry; 64 zeros for the first entry. Absent on legacy packets exported before history hashing existed. */
  prevHash?: string;
  /** SHA-256 (hex, lower-case) of canonical({ at, from, to, actor, note, prevHash }). Present together with prevHash or not at all. */
  hash?: string;
}

export interface Packet {
  schema: 'packetsmith.packet/1';
  meta: {
    systemName: string;
    assessor: string;
    approver: string;
    asOf: string;
  };
  selectedControls: string[];
  steps: Step[];
  artifacts: Artifact[];
  determinations: DeterminationResult[];
  findings: Finding[];
  state: PacketState;
  history: HistoryEntry[];
}

export type ControlStatus = 'satisfied' | 'other-than-satisfied' | 'in-progress' | 'not-assessed';

export interface Blocker {
  controlId?: string;
  ref?: string; // step/artifact/determination/finding id
  message: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/** `warnings` are non-blocking notes about an accepted packet (e.g. a legacy history without hashes). */
export type ValidationResult = { ok: true; packet: Packet; warnings: string[] } | { ok: false; issues: ValidationIssue[] };
