/**
 * Pathcaster core engine: reachability over a synthetic RBAC/ABAC graph with deny-overrides,
 * ABAC condition evaluation, privilege hotspots, toxic-combination detection and what-if edge removal.
 * Pure functions, bounded traversal, no network, no live directory.
 */
import type {
  AccessPath, Action, Condition, DenyHit, Graph, GraphEdge, GraphNode, Hotspot, IdentityAccess, ReachOptions, ReachResult, ToxicHit, WhatIf,
} from './types';
import { toCsv } from './safe';

export const LIMITS = { nodes: 400, edges: 1200, toxicRules: 50, maxDepth: 12, maxPathsPerIdentity: 50, maxExpansionsPerIdentity: 4000 };

interface Index {
  node: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
}

function index(g: Graph): Index {
  const node = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  for (const e of g.edges) { const l = out.get(e.from) ?? []; l.push(e); out.set(e.from, l); }
  return { node, out };
}

function holds(c: Condition | undefined, attrs: Record<string, string>): boolean {
  if (!c) return true;
  const v = attrs[c.attr];
  return c.op === 'eq' ? v === c.value : v !== c.value;
}

/** All groups an identity belongs to, directly or through nested membership. Cycle-safe; conditional memberships must hold. */
export function transitiveGroups(g: Graph, identityId: string, idx = index(g)): Set<string> {
  const attrs = idx.node.get(identityId)?.attrs ?? {};
  const seen = new Set<string>();
  const stack = [identityId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of idx.out.get(cur) ?? []) {
      if (e.kind === 'member_of' && !seen.has(e.to) && holds(e.condition, attrs)) { seen.add(e.to); stack.push(e.to); }
    }
  }
  return seen;
}

function denyHits(identityId: string, groups: Set<string>, assetId: string, permissionIds: Set<string>, idx: Index): DenyHit[] {
  const sources = [identityId, ...groups];
  const hits: DenyHit[] = [];
  for (const s of sources) {
    for (const e of idx.out.get(s) ?? []) {
      if (e.kind !== 'deny') continue;
      if (e.to === assetId || permissionIds.has(e.to)) {
        hits.push({ edgeId: e.id, from: s, target: e.to, reason: e.note ?? `Explicit deny from ${idx.node.get(s)?.label ?? s} on ${idx.node.get(e.to)?.label ?? e.to}` });
      }
    }
  }
  return hits;
}

const ACTION_RANK: Record<Action, number> = { read: 0, write: 1, admin: 2 };

/**
 * Does a permission whose action is `have` satisfy a query for `want`? Exact match always; with the optional
 * hierarchy (admin ⊃ write ⊃ read) a stronger action also satisfies a weaker query. Nothing is ever implied upwards.
 */
function actionSatisfies(have: Action | undefined, want: Action | 'any', hierarchy: boolean): boolean {
  if (want === 'any') return true;
  if (!have) return false;
  return have === want || (hierarchy && ACTION_RANK[have] > ACTION_RANK[want]);
}

/**
 * Who can reach an asset (optionally with a specific action), with every path and the deny-override verdict.
 * `opts.hierarchy` (default false, semantics unchanged) lets an `admin` permission satisfy `write`/`read` queries and a
 * `write` permission satisfy `read`; the path then names the permission actually used, and a deny on that permission
 * still applies because deny hits are computed over the permissions the found paths used.
 */
export function reach(g: Graph, assetId: string, action: Action | 'any', opts: ReachOptions = {}): ReachResult {
  const hierarchy = opts.hierarchy === true;
  const idx = index(g);
  const identities = g.nodes.filter((n) => n.kind === 'identity');
  const results: IdentityAccess[] = [];
  for (const ident of identities) {
    const attrs = ident.attrs ?? {};
    const paths: AccessPath[] = [];
    const blocked: AccessPath[] = [];
    const permsUsed = new Set<string>();
    let truncated = false;
    let truncReason: string | null = null;
    let expansions = 0;
    // DFS: identity -(member_of)*-> [group] -(assigned)-> role -(grants)-> permission -(applies_to)-> asset
    // Work is bounded three ways: depth, paths collected (allowed AND blocked), and node expansions.
    const visit = (nodeId: string, steps: AccessPath['steps'], conds: AccessPath['conditions'], visited: Set<string>, depth: number) => {
      if (truncated || depth > LIMITS.maxDepth) return;
      if (++expansions > LIMITS.maxExpansionsPerIdentity) { truncated = true; truncReason = `Traversal budget of ${LIMITS.maxExpansionsPerIdentity} node expansions exhausted.`; return; }
      const node = idx.node.get(nodeId);
      if (!node) return;
      for (const e of idx.out.get(nodeId) ?? []) {
        if (truncated) return;
        if (e.kind === 'deny') continue;
        if (visited.has(e.to)) continue;
        const to = idx.node.get(e.to);
        if (!to) continue;
        const nextConds = e.condition ? [...conds, { edgeId: e.id, condition: e.condition, satisfied: holds(e.condition, attrs) }] : conds;
        const nextSteps = [...steps, { nodeId: e.to, via: e.id }];
        if (to.kind === 'asset') {
          if (e.to !== assetId) continue;
          const perm = idx.node.get(nodeId);
          if (!actionSatisfies(perm?.action, action, hierarchy)) continue;
          const path: AccessPath = { steps: nextSteps, conditions: nextConds };
          if (nextConds.every((c) => c.satisfied)) { paths.push(path); permsUsed.add(nodeId); }
          else blocked.push(path);
          if (paths.length + blocked.length >= LIMITS.maxPathsPerIdentity) { truncated = true; truncReason = `Path cap of ${LIMITS.maxPathsPerIdentity} reached (allowed + condition-blocked).`; return; }
          continue;
        }
        // kind compatibility is enforced by validateGraph; traverse
        visit(e.to, nextSteps, nextConds, new Set([...visited, e.to]), depth + 1);
      }
    };
    visit(ident.id, [{ nodeId: ident.id, via: null }], [], new Set([ident.id]), 0);
    const groups = transitiveGroups(g, ident.id, idx);
    const assetPerms = new Set(g.edges.filter((e) => e.kind === 'applies_to' && e.to === assetId).map((e) => e.from));
    const deniesUsed = denyHits(ident.id, groups, assetId, permsUsed, idx);
    let decision: IdentityAccess['decision'];
    let indeterminateReason: string | null = null;
    if (!truncated) {
      decision = paths.length === 0 ? 'none' : deniesUsed.length > 0 ? 'deny' : 'allow';
    } else if (paths.length > 0 && deniesUsed.length > 0) {
      decision = 'deny'; // a deny on a found path is definitive regardless of what was not explored
    } else if (paths.length > 0 && denyHits(ident.id, groups, assetId, assetPerms, idx).length === 0) {
      decision = 'allow'; // a path exists and no deny anywhere could apply to this asset
    } else {
      decision = 'indeterminate';
      indeterminateReason = `${truncReason} ${paths.length === 0 ? 'Unexplored paths may grant access.' : 'A deny exists on a permission for this asset that unexplored paths might use.'} Simplify the graph or narrow the query.`;
    }
    results.push({ identityId: ident.id, decision, indeterminateReason, paths, blockedByCondition: blocked, denies: paths.length ? deniesUsed : [], truncated });
  }
  const ORDER: Record<IdentityAccess['decision'], number> = { indeterminate: 0, deny: 1, allow: 2, none: 3 };
  results.sort((a, b) => ORDER[a.decision] - ORDER[b.decision] || a.identityId.localeCompare(b.identityId));
  const count = (d: IdentityAccess['decision']) => results.filter((r) => r.decision === d).length;
  return { assetId, action, hierarchy, identities: results, summary: { allow: count('allow'), deny: count('deny'), none: count('none'), indeterminate: count('indeterminate') } };
}

/** Group/role nodes ranked by how many identities they carry to high-sensitivity assets. Queries use `any`, so the hierarchy option cannot change the ranking; it is accepted for a uniform call signature. */
export function hotspots(g: Graph, opts: ReachOptions = {}): Hotspot[] {
  const idx = index(g);
  const assets = g.nodes.filter((n) => n.kind === 'asset');
  const acc = new Map<string, { identities: Set<string>; highAssets: Set<string>; pathCount: number }>();
  for (const n of g.nodes) if (n.kind === 'group' || n.kind === 'role') acc.set(n.id, { identities: new Set(), highAssets: new Set(), pathCount: 0 });
  for (const a of assets) {
    const r = reach(g, a.id, 'any', opts);
    for (const ia of r.identities) {
      if (ia.decision !== 'allow') continue;
      for (const p of ia.paths) {
        for (const s of p.steps) {
          const entry = acc.get(s.nodeId);
          if (!entry) continue;
          entry.pathCount++;
          if (a.sensitivity === 'high') { entry.identities.add(ia.identityId); entry.highAssets.add(a.id); }
        }
      }
    }
  }
  return [...acc.entries()].map(([nodeId, v]) => ({ nodeId, kind: idx.node.get(nodeId)!.kind, label: idx.node.get(nodeId)!.label, identities: v.identities.size, highAssets: v.highAssets.size, pathCount: v.pathCount }))
    .sort((a, b) => b.identities - a.identities || b.highAssets - a.highAssets || b.pathCount - a.pathCount || a.nodeId.localeCompare(b.nodeId));
}

/** Identities holding both sides of a toxic rule. With `opts.hierarchy`, an admin-only identity holds a `write` side too (admin ⊃ write). */
export function toxicCombinations(g: Graph, opts: ReachOptions = {}): ToxicHit[] {
  const hits: ToxicHit[] = [];
  for (const rule of g.toxicRules) {
    const a = reach(g, rule.a.assetId, rule.a.action, opts);
    const b = reach(g, rule.b.assetId, rule.b.action, opts);
    for (const ia of a.identities) {
      if (ia.decision !== 'allow') continue;
      const ib = b.identities.find((x) => x.identityId === ia.identityId);
      if (ib && ib.decision === 'allow') hits.push({ ruleId: rule.id, identityId: ia.identityId, aPaths: ia.paths.length, bPaths: ib.paths.length });
    }
  }
  return hits;
}

export function whatIfRemoveEdge(g: Graph, edgeId: string, assetId: string, action: Action | 'any', opts: ReachOptions = {}): WhatIf {
  if (!g.edges.some((e) => e.id === edgeId)) throw new Error(`Unknown edge ${edgeId}`);
  const before = reach(g, assetId, action, opts);
  const after = reach({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) }, assetId, action, opts);
  const allowed = (r: ReachResult) => new Set(r.identities.filter((i) => i.decision === 'allow').map((i) => i.identityId));
  const b = allowed(before), a = allowed(after);
  return { removedEdgeId: edgeId, assetId, action, hierarchy: before.hierarchy, before: b.size, after: a.size, lostAccess: [...b].filter((x) => !a.has(x)).sort(), gainedAccess: [...a].filter((x) => !b.has(x)).sort() };
}

const VERB: Record<GraphEdge['kind'], string> = { member_of: 'is a member of', assigned: 'is assigned the role', grants: 'which grants', applies_to: 'on', deny: 'is denied' };

export function explainPath(g: Graph, path: AccessPath): string {
  const idx = index(g);
  const edgeById = new Map(g.edges.map((e) => [e.id, e]));
  const parts: string[] = [];
  for (let i = 0; i < path.steps.length; i++) {
    const s = path.steps[i]!;
    const label = idx.node.get(s.nodeId)?.label ?? s.nodeId;
    if (i === 0) { parts.push(label); continue; }
    const e = s.via ? edgeById.get(s.via) : undefined;
    const verb = e ? VERB[e.kind] : '→';
    const cond = e?.condition ? ` (only when ${e.condition.attr} ${e.condition.op === 'eq' ? 'is' : 'is not'} ${e.condition.value})` : '';
    parts.push(`${verb} ${label}${cond}`);
  }
  return parts.join(' ') + '.';
}

/* ----------------------------- validation ----------------------------- */

const ALLOWED: Record<GraphEdge['kind'], [GraphNode['kind'][], GraphNode['kind'][]]> = {
  member_of: [['identity', 'group'], ['group']],
  assigned: [['identity', 'group'], ['role']],
  grants: [['role'], ['permission']],
  applies_to: [['permission'], ['asset']],
  deny: [['identity', 'group'], ['permission', 'asset']],
};

export type GraphValidation = { ok: true; graph: Graph } | { ok: false; errors: string[] };

export function validateGraph(input: unknown): GraphValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Graph must be a JSON object.'] };
  const g = input as Record<string, unknown>;
  if (g.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof g.label !== 'string') errors.push('label must be a string.');
  const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown, max = 120): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const rows = (name: 'nodes' | 'edges' | 'toxicRules'): Record<string, unknown>[] => {
    const v = g[name];
    if (!Array.isArray(v)) { errors.push(`${name} must be an array.`); return []; }
    if (v.length > LIMITS[name]) { errors.push(`${name} has ${v.length} entries; limit is ${LIMITS[name]}.`); return []; }
    const good: Record<string, unknown>[] = [];
    v.forEach((row, i) => { if (isRow(row)) good.push(row); else errors.push(`${name}[${i}] is not an object.`); });
    return good;
  };
  const nodes = rows('nodes'); const edges = rows('edges'); const rules = rows('toxicRules');
  const kinds = new Map<string, GraphNode['kind']>();
  for (const n of nodes) {
    if (!str(n.id)) { errors.push('node without id'); continue; }
    if (kinds.has(n.id)) errors.push(`duplicate node ${n.id}`);
    if (!['identity', 'group', 'role', 'permission', 'asset'].includes(n.kind as string)) { errors.push(`node ${n.id}: bad kind`); continue; }
    kinds.set(n.id, n.kind as GraphNode['kind']);
    if (!str(n.label)) errors.push(`node ${n.id}: label required`);
    if (n.kind === 'permission' && !['read', 'write', 'admin'].includes(n.action as string)) errors.push(`permission ${n.id}: action must be read/write/admin`);
    if (n.kind === 'asset' && !['low', 'moderate', 'high'].includes(n.sensitivity as string)) errors.push(`asset ${n.id}: sensitivity required`);
    if (n.attrs !== undefined && (!isRow(n.attrs) || !Object.values(n.attrs).every((v) => typeof v === 'string'))) errors.push(`node ${n.id}: attrs must be string→string`);
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (!str(e.id)) { errors.push('edge without id'); continue; }
    if (edgeIds.has(e.id)) errors.push(`duplicate edge ${e.id}`); edgeIds.add(e.id);
    const kind = e.kind as GraphEdge['kind'];
    if (!(kind in ALLOWED)) { errors.push(`edge ${e.id}: bad kind`); continue; }
    const fk = kinds.get(e.from as string), tk = kinds.get(e.to as string);
    if (!fk) errors.push(`edge ${e.id}: from ${String(e.from)} is missing`);
    if (!tk) errors.push(`edge ${e.id}: to ${String(e.to)} is missing`);
    if (e.from === e.to) errors.push(`edge ${e.id}: self loop`);
    if (fk && tk) { const [fa, ta] = ALLOWED[kind]; if (!fa.includes(fk) || !ta.includes(tk)) errors.push(`edge ${e.id}: ${kind} cannot connect ${fk} → ${tk}`); }
    if (e.condition !== undefined) { const c = e.condition as Record<string, unknown>; if (!isRow(c) || !str(c.attr) || !['eq', 'neq'].includes(c.op as string) || typeof c.value !== 'string') errors.push(`edge ${e.id}: bad condition`); }
  }
  for (const r of rules) {
    if (!str(r.id)) { errors.push('toxic rule without id'); continue; }
    for (const side of ['a', 'b'] as const) { const s = r[side] as Record<string, unknown> | undefined; if (!isRow(s) || kinds.get(s.assetId as string) !== 'asset' || !['read', 'write', 'admin'].includes(s.action as string)) errors.push(`toxic rule ${r.id}: side ${side} must name an asset and action`); }
  }
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  return errors.length ? { ok: false, errors } : { ok: true, graph: g as unknown as Graph };
}

/* ----------------------------- export ----------------------------- */

export interface ReviewExport {
  schema: 'pathcaster.review/v1';
  label: string;
  /** `hierarchy` (additive, October 2026): whether admin ⊃ write ⊃ read was applied to the query. */
  query: { assetId: string; asset: string; action: Action | 'any'; hierarchy: boolean };
  summary: string;
  identities: { identityId: string; label: string; decision: IdentityAccess['decision']; indeterminateReason: string | null; truncated: boolean; pathCount: number; paths: string[]; denies: string[]; blockedByCondition: string[] }[];
  hotspots: Hotspot[];
  toxic: (ToxicHit & { rule: string })[];
  disclaimer: string;
}

export function exportReview(g: Graph, r: ReachResult, hs: Hotspot[], toxic: ToxicHit[]): { json: ReviewExport; csv: string } {
  const idx = index(g);
  const asset = idx.node.get(r.assetId)?.label ?? r.assetId;
  const identities = r.identities.map((ia) => ({
    identityId: ia.identityId, label: idx.node.get(ia.identityId)?.label ?? ia.identityId, decision: ia.decision, indeterminateReason: ia.indeterminateReason, truncated: ia.truncated, pathCount: ia.paths.length,
    paths: ia.paths.map((p) => explainPath(g, p)), denies: ia.denies.map((d) => d.reason), blockedByCondition: ia.blockedByCondition.map((p) => explainPath(g, p)),
  }));
  const json: ReviewExport = {
    schema: 'pathcaster.review/v1', label: g.label,
    query: { assetId: r.assetId, asset, action: r.action, hierarchy: r.hierarchy },
    summary: `${r.summary.allow} identit${r.summary.allow === 1 ? 'y' : 'ies'} can reach ${asset} (${r.action}); ${r.summary.deny} blocked by explicit deny despite having a path; ${r.summary.none} have no path${r.summary.indeterminate ? `; ${r.summary.indeterminate} indeterminate because the traversal budget was exhausted` : ''}${r.hierarchy ? '; permission hierarchy applied (admin ⊃ write ⊃ read)' : ''}.`,
    identities, hotspots: hs, toxic: toxic.map((t) => ({ ...t, rule: g.toxicRules.find((x) => x.id === t.ruleId)?.name ?? t.ruleId })),
    disclaimer: 'Synthetic access graph; educational prototype. No directory was enumerated and no permission was changed.',
  };
  const csv = toCsv(['identity_id', 'identity', 'decision', 'path_count', 'first_path', 'denies'], identities.map((i) => [i.identityId, i.label, i.decision, i.pathCount, i.paths[0] ?? '', i.denies.join(' | ')]));
  return { json, csv };
}
