/** Attestline domain types. All fixture data is synthetic (.example domains, fictional people). */

export type RoleType = 'employee' | 'contractor' | 'service';
export type IdentityStatus = 'active' | 'leaver' | 'suspended';

export interface Identity {
  id: string;
  displayName: string;
  roleType: RoleType;
  department: string;
  managerId: string | null;
  status: IdentityStatus;
  /** ISO date the account was last seen signing in; null = never */
  lastSignIn: string | null;
}

export interface Resource {
  id: string;
  name: string;
  owner: string;
  sensitivity: 'low' | 'moderate' | 'high';
}

export interface Entitlement {
  id: string;
  identityId: string;
  resourceId: string;
  /** Short entitlement name, e.g. "payroll.approve" */
  privilege: string;
  privileged: boolean;
  grantedOn: string;
  /** ISO date this entitlement was last exercised; null = never */
  lastUsed: string | null;
}

export interface SodRule {
  id: string;
  name: string;
  /** Two privileges that must not be held by the same identity */
  conflict: [string, string];
  rationale: string;
}

export interface Fixture {
  schemaVersion: 1;
  label: string;
  asOf: string;
  identities: Identity[];
  resources: Resource[];
  entitlements: Entitlement[];
  sodRules: SodRule[];
}

export type RiskHint =
  | { kind: 'orphan'; detail: string }
  | { kind: 'dormant'; detail: string; idleDays: number }
  | { kind: 'never_used'; detail: string }
  | { kind: 'sod_conflict'; detail: string; ruleId: string; counterpartEntitlementId: string }
  | { kind: 'privileged'; detail: string }
  | { kind: 'no_reviewer'; detail: string }
  | { kind: 'self_review'; detail: string };

export type Decision = 'approve' | 'revoke' | 'delegate';
export type ItemState = 'pending' | 'approved' | 'revoked' | 'delegated';

export interface DecisionRecord {
  seq: number;
  itemId: string;
  actor: string;
  decision: Decision;
  reason: string;
  at: string;
  /** Set when approving an entitlement that has an active SoD conflict */
  sodOverride?: { ruleId: string; rationale: string };
  delegateTo?: string;
}

export interface ReviewItem {
  id: string;
  entitlement: Entitlement;
  identity: Identity;
  resource: Resource;
  /** Reviewer currently responsible (manager id, resource owner for orphans, or null) */
  reviewerId: string | null;
  hints: RiskHint[];
  riskScore: number;
  state: ItemState;
}

export interface CampaignConfig {
  dormantAfterDays: number;
  asOf: string;
}

export interface Campaign {
  config: CampaignConfig;
  fixtureLabel: string;
  items: ReviewItem[];
  decisions: DecisionRecord[];
  reviewers: { id: string; name: string }[];
  /** Snapshot of identities so decision guards can check status without the fixture */
  identities: { id: string; name: string; status: IdentityStatus }[];
}
