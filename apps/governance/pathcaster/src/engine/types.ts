/** Pathcaster domain types: a synthetic RBAC/ABAC access graph. No live directory is read. */

export type NodeKind = 'identity' | 'group' | 'role' | 'permission' | 'asset';
export type Action = 'read' | 'write' | 'admin';
export type Sensitivity = 'low' | 'moderate' | 'high';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** identities: department, location, mfa ("true"/"false"), type ("user"/"service") … compared as strings */
  attrs?: Record<string, string>;
  /** permission nodes */
  action?: Action;
  /** asset nodes */
  sensitivity?: Sensitivity;
}

export type EdgeKind = 'member_of' | 'assigned' | 'grants' | 'applies_to' | 'deny';

export interface Condition { attr: string; op: 'eq' | 'neq'; value: string }

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** ABAC condition evaluated against the identity's attrs (only meaningful on assigned/grants edges) */
  condition?: Condition;
  note?: string;
}

export interface ToxicRule {
  id: string;
  name: string;
  a: { assetId: string; action: Action };
  b: { assetId: string; action: Action };
  rationale: string;
}

export interface Graph {
  schemaVersion: 1;
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  toxicRules: ToxicRule[];
}

export interface PathStep { nodeId: string; via: string | null } // via = edge id used to arrive

export interface AccessPath {
  steps: PathStep[];
  /** conditions that had to hold (all satisfied) */
  conditions: { edgeId: string; condition: Condition; satisfied: boolean }[];
}

export interface DenyHit { edgeId: string; from: string; target: string; reason: string }

export type Decision = 'allow' | 'deny' | 'none' | 'indeterminate';

export interface IdentityAccess {
  identityId: string;
  /** indeterminate = the traversal budget was exhausted and neither allow nor deny can be stated honestly */
  decision: Decision;
  indeterminateReason: string | null;
  paths: AccessPath[];
  /** paths that would have allowed but a condition failed */
  blockedByCondition: AccessPath[];
  denies: DenyHit[];
  truncated: boolean;
}

export interface ReachResult {
  assetId: string;
  action: Action | 'any';
  identities: IdentityAccess[];
  summary: { allow: number; deny: number; none: number; indeterminate: number };
}

export interface Hotspot { nodeId: string; kind: NodeKind; label: string; identities: number; highAssets: number; pathCount: number }

export interface ToxicHit { ruleId: string; identityId: string; aPaths: number; bPaths: number }

export interface WhatIf { removedEdgeId: string; assetId: string; action: Action | 'any'; before: number; after: number; lostAccess: string[]; gainedAccess: string[] }
