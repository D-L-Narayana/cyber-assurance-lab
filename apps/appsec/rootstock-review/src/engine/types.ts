export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface PackageRecord { name: string; version: string; license: string; dependencies: Record<string, string>; deprecated?: boolean; hasInstallScript?: boolean }
export interface Advisory { id: string; package: string; vulnerable: string; patched: string; severity: Severity; title: string; cwe?: string }
export interface Policy { licenses: { allow: string[]; review: string[]; deny: string[] }; blockSeverity: Severity; flagInstallScripts: boolean; flagDeprecated: boolean }
/** A declared dependency whose range the semver subset cannot parse (npm: alias, file:, link:, git, tag…); kept as an unresolved edge, never matched. */
export interface UnparsableEdge { from: string; name: string; range: string }
/** Provenance of a snapshot produced by the offline package-lock.json converter. */
export interface LockSource { kind: 'package-lock.json'; lockfileVersion: 2 | 3; includeDev: boolean; notes: string[] }
export interface Lockgraph {
  schema: 'rootstock.lockgraph/1';
  name: string;
  root: { name: string; version: string };
  direct: Record<string, string>;
  imports: string[];
  packages: PackageRecord[];
  registry: Record<string, string[]>;
  advisories: Advisory[];
  policy: Policy;
  unparsable?: UnparsableEdge[];
  source?: LockSource;
}

export interface Edge { from: string; name: string; range: string; reason?: string }
export interface GraphNode { id: string; pkg: PackageRecord; parents: Edge[]; children: { to: string; range: string }[]; paths: string[][]; roots: string[]; depth: number; isDirect: boolean }
export interface Graph { nodes: Map<string, GraphNode>; unresolved: Edge[]; directIds: string[]; truncated: boolean; expansions: number }

/** Splits `name@version` (scoped names included: `@scope/name@1.2.3`). */
export function splitId(id: string): { name: string; version: string } {
  const at = id.lastIndexOf('@');
  return at <= 0 ? { name: id, version: '' } : { name: id.slice(0, at), version: id.slice(at + 1) };
}

export type Reachability = 'known' | 'inferred' | 'unknown';
export type LicenseVerdict = 'allow' | 'review' | 'deny' | 'unknown';
export type PlanKind = 'bump-in-range' | 'parent-conflict' | 'no-fix-available';
export interface Plan { kind: PlanKind; target?: string; blockedBy?: { parent: string; range: string }[]; detail: string }
export type Flag = 'install-script' | 'deprecated' | 'multiple-versions';

export interface ReviewRow {
  id: string; name: string; version: string; depth: number; isDirect: boolean;
  parents: string[]; paths: string[][];
  license: { expression: string; verdict: LicenseVerdict; detail: string };
  advisories: (Advisory & { blocking: boolean })[];
  plan?: Plan;
  reachability: Reachability;
  reachabilityDetail: string;
  flags: Flag[];
  attention: boolean;
}
export interface Review {
  rows: ReviewRow[];
  unresolved: Edge[];
  summary: { packages: number; vulnerable: number; blocking: number; licenseDeny: number; licenseReview: number; unknownLicense: number; unresolvedEdges: number; reachabilityUnknown: number; flagged: number };
  notes: { reachability: string; severity: string; data: string; traversal: string };
  truncated: boolean;
}
