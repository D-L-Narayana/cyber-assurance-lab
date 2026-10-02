// Weft engine types. Pure data; no DOM.

export interface Assertion {
  id: string;
  controlRef: string; // free-text reference, e.g. "CSF 2.0 PR.DS-11" or "SP 800-53 CP-9"
  statement: string;
  owner: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
}

export type ArtifactKind = 'markdown' | 'csv' | 'log' | 'config' | 'note';
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['markdown', 'csv', 'log', 'config', 'note'];

export interface Artifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  capturedOn: string; // ISO date
  content: string; // synthetic text; hashed
  declaredSha256?: string; // what the collector recorded; compared with the computed hash
}

export interface Link {
  assertionId: string;
  artifactId: string;
  note?: string;
}

export interface Signoff {
  assertionId: string;
  reviewer: string;
  signedOn: string; // ISO date
  bindingHash: string; // hash over assertion + linked evidence hashes at signing time
}

export interface Bundle {
  schema: 'weft.bundle/1';
  name: string;
  asOf: string;
  assertions: Assertion[];
  artifacts: Artifact[];
  links: Link[];
  signoffs: Signoff[];
}

export type IssueKind =
  | 'hash-mismatch'
  | 'duplicate-content'
  | 'orphan-artifact'
  | 'unsupported-assertion'
  | 'weak-assertion'
  | 'broken-link'
  | 'duplicate-link'
  | 'out-of-period'
  | 'invalid-signoff';

export interface Issue {
  kind: IssueKind;
  severity: 'high' | 'medium' | 'low';
  refs: string[]; // ids involved
  message: string;
}

export interface ArtifactInfo {
  id: string;
  sha256: string;
  bytes: number;
  declaredMatches: boolean | null; // null when no declared hash
  duplicateOf: string[]; // other artifact ids with identical content
  linkedAssertions: string[];
}

export type AssertionStatus = 'supported' | 'weak' | 'unsupported';

export interface AssertionInfo {
  id: string;
  status: AssertionStatus;
  inPeriod: string[]; // artifact ids
  outOfPeriod: string[];
  tainted: string[]; // linked artifacts with hash mismatch
  bindingHash: string;
  signoff: { reviewer: string; signedOn: string; valid: boolean } | null;
}

export interface Analysis {
  artifacts: ArtifactInfo[];
  assertions: AssertionInfo[];
  issues: Issue[];
  cells: Record<string, 'in-period' | 'out-of-period' | 'tainted' | 'broken'>; // `${assertionId}|${artifactId}`
}

export interface ManifestEntry {
  id: string;
  name: string;
  sha256: string;
  bytes: number;
}

export interface Manifest {
  schema: 'weft.manifest/2';
  bundleName: string;
  generatedOn: string;
  entries: ManifestEntry[]; // sorted by id; name is bound
  bindings: { assertionId: string; bindingHash: string }[]; // sorted by assertionId
  signoffs: Signoff[]; // sorted by assertionId; who signed, when, and what they signed are bound
  root: string; // sha256 over canonical {bundleName, entries, bindings, signoffs}
}

export interface VerifyResult {
  rootMatches: boolean;
  intact: boolean;
  modified: string[];
  missing: string[];
  added: string[];
  bindingChanged: string[];
  missingAssertions: string[]; // bound in the manifest but absent from the bundle
  addedAssertions: string[]; // present in the bundle but not bound in the manifest
  renamed: string[]; // artifact ids whose display name differs from the manifest (content unchanged)
  signoffsChanged: string[]; // assertion ids whose sign-off was added, removed, re-attributed, re-dated or re-bound since the manifest
  bundleNameChanged: boolean;
}

export interface BundleDiff {
  addedArtifacts: string[];
  removedArtifacts: string[];
  changedArtifacts: string[];
  addedAssertions: string[];
  removedAssertions: string[];
  changedAssertions: string[];
  addedLinks: string[];
  removedLinks: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
