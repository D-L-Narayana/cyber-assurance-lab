/**
 * Attestline core engine: builds an access-review campaign from a synthetic fixture,
 * computes explainable risk hints (orphan, dormant, never used, SoD, privileged, no reviewer),
 * enforces a decision state machine and exports a stable certification record.
 *
 * Everything is deterministic and side-effect free. Nothing here changes a real permission.
 */
import type {
  Campaign, CampaignConfig, Decision, DecisionRecord, Entitlement, Fixture, Identity,
  Resource, ReviewItem, RiskHint,
} from './types';
import { daysBetween, isIsoDate, toCsv } from './safe';

export const LIMITS = { identities: 1000, resources: 200, entitlements: 3000, sodRules: 100 };

const HINT_WEIGHT: Record<RiskHint['kind'], number> = {
  sod_conflict: 40,
  orphan: 30,
  privileged: 15,
  never_used: 12,
  dormant: 10,
  no_reviewer: 8,
  self_review: 20,
};
const SENSITIVITY_WEIGHT = { low: 0, moderate: 5, high: 10 } as const;

export type ValidationResult = { ok: true; fixture: Fixture } | { ok: false; errors: string[] };

/** Structural validation of an untrusted fixture object. Collects bounded errors; never throws on malformed rows. */
export function validateFixture(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Fixture must be a JSON object.'] };
  const f = input as Record<string, unknown>;
  if (f.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!isIsoDate(f.asOf)) errors.push('asOf must be a valid ISO date (YYYY-MM-DD).');
  if (typeof f.label !== 'string') errors.push('label must be a string.');
  const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
  const rows = (name: keyof typeof LIMITS): Record<string, unknown>[] => {
    const v = f[name];
    if (!Array.isArray(v)) { errors.push(`${name} must be an array.`); return []; }
    if (v.length > LIMITS[name]) { errors.push(`${name} has ${v.length} rows; limit is ${LIMITS[name]}.`); return []; }
    const good: Record<string, unknown>[] = [];
    v.forEach((row, idx) => { if (isRow(row)) good.push(row); else errors.push(`${name}[${idx}] is not an object.`); });
    return good;
  };
  const identities = rows('identities');
  const resources = rows('resources');
  const entitlements = rows('entitlements');
  const sodRules = rows('sodRules');
  const ids = new Set<string>();
  for (const i of identities) {
    if (!str(i.id)) { errors.push('identity without a string id'); continue; }
    if (ids.has(i.id)) errors.push(`duplicate identity id ${i.id}`); else ids.add(i.id);
    if (!str(i.displayName)) errors.push(`identity ${i.id}: displayName required`);
    if (!['employee', 'contractor', 'service'].includes(i.roleType as string)) errors.push(`identity ${i.id}: bad roleType`);
    if (!['active', 'leaver', 'suspended'].includes(i.status as string)) errors.push(`identity ${i.id}: bad status`);
    if (i.managerId !== null && !str(i.managerId)) errors.push(`identity ${i.id}: managerId must be a string or null`);
    if (i.managerId === i.id) errors.push(`identity ${i.id}: cannot be its own manager`);
    if (i.lastSignIn !== null && !isIsoDate(i.lastSignIn)) errors.push(`identity ${i.id}: lastSignIn must be ISO date or null`);
  }
  const rids = new Set<string>();
  for (const r of resources) {
    if (!str(r.id)) { errors.push('resource without a string id'); continue; }
    if (rids.has(r.id)) errors.push(`duplicate resource id ${r.id}`); else rids.add(r.id);
    if (!str(r.name)) errors.push(`resource ${r.id}: name required`);
    if (!str(r.owner)) errors.push(`resource ${r.id}: owner required`);
    if (!['low', 'moderate', 'high'].includes(r.sensitivity as string)) errors.push(`resource ${r.id}: bad sensitivity`);
  }
  const eids = new Set<string>();
  for (const e of entitlements) {
    if (!str(e.id)) { errors.push('entitlement without a string id'); continue; }
    if (eids.has(e.id)) errors.push(`duplicate entitlement id ${e.id}`); else eids.add(e.id);
    if (!str(e.identityId) || !ids.has(e.identityId)) errors.push(`entitlement ${e.id}: identity ${String(e.identityId)} is missing`);
    if (!str(e.resourceId) || !rids.has(e.resourceId)) errors.push(`entitlement ${e.id}: resource ${String(e.resourceId)} is missing`);
    if (!str(e.privilege)) errors.push(`entitlement ${e.id}: privilege required`);
    if (typeof e.privileged !== 'boolean') errors.push(`entitlement ${e.id}: privileged must be boolean`);
    if (!isIsoDate(e.grantedOn)) errors.push(`entitlement ${e.id}: grantedOn must be ISO date`);
    if (e.lastUsed !== null && !isIsoDate(e.lastUsed)) errors.push(`entitlement ${e.id}: lastUsed must be ISO date or null`);
  }
  for (const s of sodRules) {
    if (!str(s.id)) { errors.push('sod rule without a string id'); continue; }
    if (!Array.isArray(s.conflict) || s.conflict.length !== 2 || !s.conflict.every(str)) errors.push(`sod rule ${s.id}: conflict must be two privilege strings`);
    if (!str(s.name) || !str(s.rationale)) errors.push(`sod rule ${s.id}: name and rationale required`);
  }
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  return errors.length ? { ok: false, errors } : { ok: true, fixture: f as unknown as Fixture };
}

function hintsFor(e: Entitlement, identity: Identity, resource: Resource, byIdentity: Map<string, Entitlement[]>,
  fixture: Fixture, config: CampaignConfig, reviewerId: string | null): RiskHint[] {
  const hints: RiskHint[] = [];
  if (identity.status !== 'active') {
    hints.push({ kind: 'orphan', detail: `${identity.displayName} is marked ${identity.status}; access should normally be removed.` });
  }
  const held = byIdentity.get(identity.id) ?? [];
  for (const rule of fixture.sodRules) {
    const [a, b] = rule.conflict;
    const other = e.privilege === a ? b : e.privilege === b ? a : null;
    if (!other) continue;
    const counterpart = held.find((h) => h.id !== e.id && h.privilege === other);
    if (counterpart) {
      hints.push({
        kind: 'sod_conflict', ruleId: rule.id, counterpartEntitlementId: counterpart.id,
        detail: `${rule.name}: also holds ${other} (${counterpart.id}). ${rule.rationale}`,
      });
    }
  }
  if (e.lastUsed === null) {
    hints.push({ kind: 'never_used', detail: `Granted ${e.grantedOn}, never exercised.` });
  } else {
    const idle = daysBetween(e.lastUsed, config.asOf);
    if (idle > config.dormantAfterDays) {
      hints.push({ kind: 'dormant', idleDays: idle, detail: `Last used ${e.lastUsed}, ${idle} days ago (threshold ${config.dormantAfterDays}).` });
    }
  }
  if (e.privileged) hints.push({ kind: 'privileged', detail: `${e.privilege} is a privileged entitlement on ${resource.name}.` });
  if (reviewerId === null) hints.push({ kind: 'no_reviewer', detail: 'No manager and no known resource owner; needs manual routing.' });
  return hints;
}

function scoreOf(hints: RiskHint[], resource: Resource): number {
  const base = hints.reduce((n, h) => n + HINT_WEIGHT[h.kind], 0);
  return hints.length === 0 ? 0 : base + SENSITIVITY_WEIGHT[resource.sensitivity];
}

export function buildCampaign(fixture: Fixture, config: CampaignConfig): Campaign {
  const identities = new Map(fixture.identities.map((i) => [i.id, i]));
  const resources = new Map(fixture.resources.map((r) => [r.id, r]));
  const byIdentity = new Map<string, Entitlement[]>();
  for (const e of fixture.entitlements) {
    const list = byIdentity.get(e.identityId) ?? [];
    list.push(e);
    byIdentity.set(e.identityId, list);
  }
  const items: ReviewItem[] = [];
  const reviewerIds = new Set<string>();
  for (const e of fixture.entitlements) {
    const identity = identities.get(e.identityId);
    const resource = resources.get(e.resourceId);
    if (!identity || !resource) continue; // validateFixture rejects these; skip defensively
    // Routing: active identity with a known manager -> manager; otherwise -> resource owner if that owner exists.
    // Nobody may review their own access. Candidates are tried in order: manager (active identities only), then the
    // resource owner; a candidate is skipped when it is the holder of the entitlement. If nothing is left the item is unrouted.
    const activeOther = (id: string | null | undefined): string | null =>
      id && id !== identity.id && identities.get(id)?.status === 'active' ? id : null;
    const manager = identity.status === 'active' ? activeOther(identity.managerId) : null;
    const owner = activeOther(resource.owner);
    const reviewerId = manager ?? owner;
    const selfRouted = reviewerId === null && (identity.managerId === identity.id || resource.owner === identity.id);
    const hints = hintsFor(e, identity, resource, byIdentity, fixture, config, reviewerId);
    if (selfRouted) hints.unshift({ kind: 'self_review', detail: `${identity.displayName} would be reviewing their own access (manager or resource owner is the holder); routed to the campaign owner instead.` });
    if (reviewerId) reviewerIds.add(reviewerId);
    items.push({ id: `ri-${e.id}`, entitlement: e, identity, resource, reviewerId, hints, riskScore: scoreOf(hints, resource), state: 'pending' });
  }
  items.sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id));
  const reviewers = [...reviewerIds].sort().map((id) => ({ id, name: identities.get(id)?.displayName ?? id }));
  const identitySnapshot = fixture.identities.map((i) => ({ id: i.id, name: i.displayName, status: i.status }));
  return { config, fixtureLabel: fixture.label, items, decisions: [], reviewers, identities: identitySnapshot };
}

export interface DecisionInput {
  itemId: string;
  actor: string;
  decision: Decision;
  reason: string;
  sodOverride?: { ruleId: string; rationale: string };
  delegateTo?: string;
  at?: string;
}

export type DecisionResult = { ok: true; campaign: Campaign } | { ok: false; error: string };

const STATE_FOR: Record<Decision, ReviewItem['state']> = { approve: 'approved', revoke: 'revoked', delegate: 'pending' };

export function applyDecision(campaign: Campaign, input: DecisionInput): DecisionResult {
  const item = campaign.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, error: `Unknown review item ${input.itemId}.` };
  if (item.reviewerId === null) return { ok: false, error: 'This item has no reviewer. Use “Route unrouted items” (campaign owner) to assign one first.' };
  if (item.reviewerId !== input.actor) return { ok: false, error: `Only the assigned reviewer (${item.reviewerId}) can decide this item.` };
  if (input.actor === item.identity.id) return { ok: false, error: 'Nobody may certify their own access; route this item to another reviewer.' };
  const reason = input.reason.trim();
  if (item.hints.length > 0 && reason.length === 0) {
    return { ok: false, error: 'A reason is required because this entitlement carries risk hints.' };
  }
  if (input.decision === 'delegate') {
    if (!input.delegateTo) return { ok: false, error: 'Choose who to delegate to.' };
    if (input.delegateTo === input.actor) return { ok: false, error: 'You cannot delegate an item to yourself.' };
    if (input.delegateTo === item.identity.id) return { ok: false, error: `${item.identity.displayName} holds this access and cannot review their own access (self-review is not allowed).` };
    const target = campaign.identities.find((i) => i.id === input.delegateTo);
    if (!target) return { ok: false, error: `Unknown reviewer ${input.delegateTo}.` };
    if (target.status !== 'active') return { ok: false, error: `${target.name} is ${target.status} and not active; delegate to an active identity.` };
    if (reason.length === 0) return { ok: false, error: 'A reason is required when delegating.' };
  }
  let sodOverride: DecisionRecord['sodOverride'];
  if (input.decision === 'approve') {
    const conflicts = item.hints.filter((h): h is Extract<RiskHint, { kind: 'sod_conflict' }> => h.kind === 'sod_conflict');
    for (const c of conflicts) {
      const other = campaign.items.find((i) => i.entitlement.id === c.counterpartEntitlementId);
      if (other && other.state === 'approved') {
        if (!input.sodOverride || input.sodOverride.ruleId !== c.ruleId || input.sodOverride.rationale.trim().length < 10) {
          return { ok: false, error: `Approving this would leave both sides of "${c.ruleId}" approved. Record an SoD override rationale (10+ characters) or revoke one side.` };
        }
        sodOverride = { ruleId: c.ruleId, rationale: input.sodOverride.rationale.trim() };
      }
    }
  }
  const record: DecisionRecord = {
    seq: campaign.decisions.length + 1,
    itemId: item.id,
    actor: input.actor,
    decision: input.decision,
    reason,
    at: input.at ?? campaign.config.asOf,
    ...(sodOverride ? { sodOverride } : {}),
    ...(input.delegateTo ? { delegateTo: input.delegateTo } : {}),
  };
  const items = campaign.items.map((i) => i.id !== item.id ? i : {
    ...i,
    state: STATE_FOR[input.decision],
    reviewerId: input.decision === 'delegate' ? input.delegateTo! : i.reviewerId,
  });
  const reviewers = campaign.reviewers.some((r) => r.id === input.delegateTo) || !input.delegateTo
    ? campaign.reviewers
    : [...campaign.reviewers, { id: input.delegateTo, name: campaign.identities.find((i) => i.id === input.delegateTo)?.name ?? input.delegateTo }];
  return { ok: true, campaign: { ...campaign, items, reviewers, decisions: [...campaign.decisions, record] } };
}

export const CAMPAIGN_OWNER = 'campaign-owner';

export interface RouteInput { itemId: string; toReviewer: string; reason: string; at?: string }

/**
 * Campaign-owner routing: the only way an unrouted item (no manager, no known resource owner) gets a reviewer.
 * Recorded as a `delegate` decision by the synthetic CAMPAIGN_OWNER actor so the audit trail shows who routed it.
 */
export function routeItem(campaign: Campaign, input: RouteInput): DecisionResult {
  const item = campaign.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, error: `Unknown review item ${input.itemId}.` };
  if (item.reviewerId !== null) return { ok: false, error: 'Only unrouted items can be routed by the campaign owner; the assigned reviewer can delegate instead.' };
  if (input.toReviewer === item.identity.id) return { ok: false, error: `${item.identity.displayName} holds this access and cannot review it (self-review is not allowed).` };
  const target = campaign.identities.find((i) => i.id === input.toReviewer);
  if (!target || target.status !== 'active') return { ok: false, error: `Unknown or inactive identity ${input.toReviewer}.` };
  if (input.reason.trim().length === 0) return { ok: false, error: 'A reason is required when routing an item.' };
  const record: DecisionRecord = { seq: campaign.decisions.length + 1, itemId: item.id, actor: CAMPAIGN_OWNER, decision: 'delegate', reason: input.reason.trim(), at: input.at ?? campaign.config.asOf, delegateTo: input.toReviewer };
  const keep = (h: RiskHint) => h.kind !== 'no_reviewer';
  const items = campaign.items.map((i) => i.id !== item.id ? i : { ...i, reviewerId: input.toReviewer, hints: i.hints.filter(keep), riskScore: scoreOf(i.hints.filter(keep), i.resource) });
  const reviewers = campaign.reviewers.some((r) => r.id === input.toReviewer) ? campaign.reviewers
    : [...campaign.reviewers, { id: input.toReviewer, name: target.name }].sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, campaign: { ...campaign, items, reviewers, decisions: [...campaign.decisions, record] } };
}

/** Apply the same decision to many items atomically: all succeed or none are applied. */
export function bulkDecision(campaign: Campaign, itemIds: string[], input: Omit<DecisionInput, 'itemId'>): DecisionResult {
  let current = campaign;
  for (const itemId of itemIds) {
    const r = applyDecision(current, { ...input, itemId });
    if (!r.ok) return { ok: false, error: `${itemId}: ${r.error} No items were changed.` };
    current = r.campaign;
  }
  return { ok: true, campaign: current };
}

export interface CompletionSummary {
  total: number;
  decided: number;
  percent: number;
  approved: number;
  revoked: number;
  sodOverrides: number;
  unrouted: number;
  byReviewer: { reviewerId: string; name: string; pending: number; done: number }[];
}

export function completion(campaign: Campaign): CompletionSummary {
  const total = campaign.items.length;
  const decided = campaign.items.filter((i) => i.state !== 'pending').length;
  const byReviewer = campaign.reviewers.map((r) => {
    const mine = campaign.items.filter((i) => i.reviewerId === r.id);
    return { reviewerId: r.id, name: r.name, pending: mine.filter((i) => i.state === 'pending').length, done: mine.filter((i) => i.state !== 'pending').length };
  });
  return {
    total, decided,
    percent: total === 0 ? 0 : Math.round((decided / total) * 100),
    approved: campaign.items.filter((i) => i.state === 'approved').length,
    revoked: campaign.items.filter((i) => i.state === 'revoked').length,
    sodOverrides: campaign.decisions.filter((d) => d.sodOverride).length,
    unrouted: campaign.items.filter((i) => i.reviewerId === null).length,
    byReviewer,
  };
}

export interface CertificationExport {
  schema: 'attestline.certification/v1';
  generatedFrom: string;
  asOf: string;
  config: CampaignConfig;
  summary: CompletionSummary;
  items: {
    itemId: string; entitlementId: string; identity: string; identityStatus: string; resource: string; privilege: string;
    reviewer: string | null; state: string; riskScore: number; hints: string[]; lastDecision: DecisionRecord | null;
  }[];
  decisions: DecisionRecord[];
  disclaimer: string;
}

export function exportCertification(campaign: Campaign): { json: CertificationExport; csv: string } {
  const lastDecision = (id: string) => [...campaign.decisions].reverse().find((d) => d.itemId === id) ?? null;
  const items = campaign.items.map((i) => ({
    itemId: i.id, entitlementId: i.entitlement.id, identity: i.identity.displayName, identityStatus: i.identity.status,
    resource: i.resource.name, privilege: i.entitlement.privilege, reviewer: i.reviewerId, state: i.state,
    riskScore: i.riskScore, hints: i.hints.map((h) => h.kind), lastDecision: lastDecision(i.id),
  }));
  const json: CertificationExport = {
    schema: 'attestline.certification/v1',
    generatedFrom: campaign.fixtureLabel,
    asOf: campaign.config.asOf,
    config: campaign.config,
    summary: completion(campaign),
    items,
    decisions: campaign.decisions,
    disclaimer: 'Educational prototype output from synthetic data. Not an attestation of any real system.',
  };
  const csv = toCsv(
    ['item', 'entitlement', 'identity', 'status', 'resource', 'privilege', 'reviewer', 'state', 'risk', 'hints', 'decision_reason', 'sod_override'],
    items.map((i) => [i.itemId, i.entitlementId, i.identity, i.identityStatus, i.resource, i.privilege, i.reviewer ?? '', i.state, i.riskScore,
      i.hints.join('|'), i.lastDecision?.reason ?? '', i.lastDecision?.sodOverride?.rationale ?? '']),
  );
  return { json, csv };
}
