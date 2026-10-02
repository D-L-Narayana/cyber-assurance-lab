import { describe, expect, it } from 'vitest';
import { reach, hotspots, toxicCombinations, whatIfRemoveEdge, explainPath, validateGraph, exportReview, transitiveGroups, LIMITS } from './graph';
import type { Graph } from './types';

const g: Graph = {
  schemaVersion: 1, label: 'unit',
  nodes: [
    { id: 'u-ada', kind: 'identity', label: 'Ada Example', attrs: { department: 'finance', mfa: 'true', type: 'user' } },
    { id: 'u-bo', kind: 'identity', label: 'Bo Sample', attrs: { department: 'engineering', mfa: 'false', type: 'user' } },
    { id: 'u-cy', kind: 'identity', label: 'Cy Fixture', attrs: { department: 'finance', mfa: 'true', type: 'user' } },
    { id: 'svc-etl', kind: 'identity', label: 'svc-etl', attrs: { department: 'engineering', mfa: 'false', type: 'service' } },
    { id: 'g-finance', kind: 'group', label: 'Finance' },
    { id: 'g-finance-leads', kind: 'group', label: 'Finance leads' },
    { id: 'g-eng', kind: 'group', label: 'Engineering' },
    { id: 'g-all', kind: 'group', label: 'All staff' },
    { id: 'g-cycle-a', kind: 'group', label: 'Cycle A' },
    { id: 'g-cycle-b', kind: 'group', label: 'Cycle B' },
    { id: 'r-payroll-editor', kind: 'role', label: 'Payroll editor' },
    { id: 'r-payroll-approver', kind: 'role', label: 'Payroll approver' },
    { id: 'r-wh-admin', kind: 'role', label: 'Warehouse admin' },
    { id: 'r-reader', kind: 'role', label: 'Reader' },
    { id: 'p-payroll-write', kind: 'permission', label: 'payroll:write', action: 'write' },
    { id: 'p-payroll-admin', kind: 'permission', label: 'payroll:admin', action: 'admin' },
    { id: 'p-wh-admin', kind: 'permission', label: 'warehouse:admin', action: 'admin' },
    { id: 'p-wiki-read', kind: 'permission', label: 'wiki:read', action: 'read' },
    { id: 'a-payroll', kind: 'asset', label: 'Payroll DB', sensitivity: 'high' },
    { id: 'a-wh', kind: 'asset', label: 'Warehouse', sensitivity: 'high' },
    { id: 'a-wiki', kind: 'asset', label: 'Wiki', sensitivity: 'low' },
  ],
  edges: [
    { id: 'e1', from: 'u-ada', to: 'g-finance', kind: 'member_of' },
    { id: 'e2', from: 'u-cy', to: 'g-finance-leads', kind: 'member_of' },
    { id: 'e3', from: 'g-finance-leads', to: 'g-finance', kind: 'member_of' },     // nested group
    { id: 'e4', from: 'u-bo', to: 'g-eng', kind: 'member_of' },
    { id: 'e5', from: 'svc-etl', to: 'g-eng', kind: 'member_of' },
    { id: 'e6', from: 'g-finance', to: 'g-all', kind: 'member_of' },
    { id: 'e7', from: 'g-eng', to: 'g-all', kind: 'member_of' },
    { id: 'e8', from: 'g-finance', to: 'r-payroll-editor', kind: 'assigned' },
    { id: 'e9', from: 'g-finance-leads', to: 'r-payroll-approver', kind: 'assigned', condition: { attr: 'mfa', op: 'eq', value: 'true' } },
    { id: 'e10', from: 'g-eng', to: 'r-wh-admin', kind: 'assigned', condition: { attr: 'type', op: 'eq', value: 'user' } },
    { id: 'e11', from: 'g-all', to: 'r-reader', kind: 'assigned' },
    { id: 'e12', from: 'r-payroll-editor', to: 'p-payroll-write', kind: 'grants' },
    { id: 'e13', from: 'r-payroll-approver', to: 'p-payroll-admin', kind: 'grants' },
    { id: 'e14', from: 'r-wh-admin', to: 'p-wh-admin', kind: 'grants' },
    { id: 'e15', from: 'r-reader', to: 'p-wiki-read', kind: 'grants' },
    { id: 'e16', from: 'p-payroll-write', to: 'a-payroll', kind: 'applies_to' },
    { id: 'e17', from: 'p-payroll-admin', to: 'a-payroll', kind: 'applies_to' },
    { id: 'e18', from: 'p-wh-admin', to: 'a-wh', kind: 'applies_to' },
    { id: 'e19', from: 'p-wiki-read', to: 'a-wiki', kind: 'applies_to' },
    { id: 'e20', from: 'u-ada', to: 'g-eng', kind: 'member_of' },                  // Ada also in engineering (but mfa true, user) -> wh admin
    { id: 'e21', from: 'g-eng', to: 'a-payroll', kind: 'deny', note: 'Engineering must never reach payroll' },
    { id: 'e22', from: 'g-eng', to: 'g-finance', kind: 'member_of' },              // engineering nested inside finance (a modelling mistake worth surfacing)
    { id: 'e23', from: 'u-bo', to: 'g-cycle-a', kind: 'member_of' },
    { id: 'e24', from: 'g-cycle-a', to: 'g-cycle-b', kind: 'member_of' },
    { id: 'e25', from: 'g-cycle-b', to: 'g-cycle-a', kind: 'member_of' },         // membership cycle: traversal must terminate
  ],
  toxicRules: [
    { id: 'tx-payroll', name: 'Edit and approve payroll', a: { assetId: 'a-payroll', action: 'write' }, b: { assetId: 'a-payroll', action: 'admin' }, rationale: 'Separation of duties.' },
    { id: 'tx-wh-payroll', name: 'Warehouse admin with payroll write', a: { assetId: 'a-wh', action: 'admin' }, b: { assetId: 'a-payroll', action: 'write' }, rationale: 'Exfil path.' },
  ],
};

describe('reach', () => {
  it('finds access through nested groups and terminates on cycles', () => {
    const r = reach(g, 'a-wiki', 'read');
    const cy = r.identities.find((i) => i.identityId === 'u-cy')!;
    expect(cy.decision).toBe('allow');
    expect(cy.paths[0]!.steps.map((s) => s.nodeId)).toContain('g-all');
    expect(r.summary.allow).toBe(4);
  });
  it('applies deny-overrides: a group deny on the asset beats any allow path', () => {
    const r = reach(g, 'a-payroll', 'any');
    const ada = r.identities.find((i) => i.identityId === 'u-ada')!;
    expect(ada.paths.length).toBeGreaterThan(0);
    expect(ada.decision).toBe('deny');
    expect(ada.denies[0]!.edgeId).toBe('e21');
    // Cy is in finance via finance-leads; g-eng is nested inside g-finance (not the other way), so Cy is not in g-eng and is not denied
    const cy = r.identities.find((i) => i.identityId === 'u-cy')!;
    expect(cy.decision).toBe('allow');
  });
  it('evaluates ABAC conditions against identity attributes and reports blocked paths', () => {
    const r = reach(g, 'a-wh', 'admin');
    const svc = r.identities.find((i) => i.identityId === 'svc-etl')!;
    expect(svc.decision).toBe('none');
    expect(svc.blockedByCondition.length).toBe(1);
    expect(svc.blockedByCondition[0]!.conditions.some((c) => !c.satisfied && c.condition.attr === 'type')).toBe(true);
    const bo = r.identities.find((i) => i.identityId === 'u-bo')!;
    expect(bo.decision).toBe('allow');
  });
  it('filters by action', () => {
    const write = reach(g, 'a-payroll', 'write');
    const admin = reach(g, 'a-payroll', 'admin');
    const cyW = write.identities.find((i) => i.identityId === 'u-cy')!;
    const cyA = admin.identities.find((i) => i.identityId === 'u-cy')!;
    expect(cyW.decision).toBe('allow');   // via finance -> payroll editor
    expect(cyA.decision).toBe('allow');   // via finance-leads -> approver (mfa true)
    const g2: Graph = { ...g, nodes: g.nodes.map((n) => n.id === 'u-cy' ? { ...n, attrs: { ...n.attrs, mfa: 'false' } } : n) };
    expect(reach(g2, 'a-payroll', 'admin').identities.find((i) => i.identityId === 'u-cy')!.decision).toBe('none');
  });
  it('computes transitive groups with cycle protection', () => {
    const groups = transitiveGroups(g, 'u-bo');
    expect([...groups].sort()).toEqual(['g-all', 'g-cycle-a', 'g-cycle-b', 'g-eng', 'g-finance']);
  });
  it('explains a path in a sentence a screen reader can speak', () => {
    const r = reach(g, 'a-wiki', 'read');
    const cy = r.identities.find((i) => i.identityId === 'u-cy')!;
    const s = explainPath(g, cy.paths[0]!);
    expect(s).toMatch(/Cy Fixture/);
    expect(s).toMatch(/member of/);
    expect(s).toMatch(/Wiki/);
  });
});

describe('hotspots and toxic combinations', () => {
  it('ranks the group/role nodes that carry the most identities to high-sensitivity assets', () => {
    const h = hotspots(g);
    expect(h[0]!.kind === 'group' || h[0]!.kind === 'role').toBe(true);
    expect(h.find((x) => x.nodeId === 'g-all')!.highAssets).toBe(0); // all-staff only reaches wiki
    expect(h.find((x) => x.nodeId === 'g-finance')!.highAssets).toBeGreaterThan(0);
    const low = h.find((x) => x.nodeId === 'g-eng')!;
    expect(low.highAssets).toBe(1); // warehouse (payroll is denied)
  });
  it('detects identities that hold both sides of a toxic rule, respecting denies', () => {
    const t = toxicCombinations(g);
    expect(t.some((x) => x.ruleId === 'tx-payroll' && x.identityId === 'u-cy')).toBe(true);
    expect(t.some((x) => x.ruleId === 'tx-wh-payroll' && x.identityId === 'u-ada')).toBe(false); // Ada denied payroll
  });
});

describe('what-if remediation', () => {
  it('reports who loses access when an edge is removed', () => {
    const w = whatIfRemoveEdge(g, 'e8', 'a-payroll', 'write');
    expect(w.before).toBe(1); // only Cy: Ada, Bo and svc-etl are denied through g-eng
    expect(w.after).toBe(0);
    expect(w.lostAccess).toContain('u-cy');
  });
  it('removing a deny edge can grant access (reported as gainedAccess)', () => {
    const w = whatIfRemoveEdge(g, 'e21', 'a-payroll', 'any');
    expect(w.gainedAccess).toContain('u-ada');
  });
  it('rejects unknown edges', () => {
    expect(() => whatIfRemoveEdge(g, 'nope', 'a-payroll', 'any')).toThrow(/unknown edge/i);
  });
});

describe('validateGraph and export', () => {
  it('rejects dangling references, self loops, kind-incompatible edges, duplicates, and oversize graphs', () => {
    const bad = (patch: Partial<Graph>) => validateGraph({ ...g, ...patch });
    expect(bad({ edges: [...g.edges, { id: 'x', from: 'u-ada', to: 'ghost', kind: 'member_of' }] }).ok).toBe(false);
    expect(bad({ edges: [...g.edges, { id: 'x', from: 'g-all', to: 'g-all', kind: 'member_of' }] }).ok).toBe(false);
    expect(bad({ edges: [...g.edges, { id: 'x', from: 'a-wiki', to: 'u-ada', kind: 'grants' }] }).ok).toBe(false);
    expect(bad({ edges: [...g.edges, { ...g.edges[0]! }] }).ok).toBe(false);
    expect(bad({ nodes: Array.from({ length: 401 }, (_, i) => ({ id: `n${i}`, kind: 'group' as const, label: 'g' })) }).ok).toBe(false);
    for (const junk of [null, [], { schemaVersion: 1, nodes: [null], edges: [], toxicRules: [] }, { schemaVersion: 1, label: 'x', nodes: [{ id: 'a' }], edges: [], toxicRules: [] }]) {
      let r: ReturnType<typeof validateGraph> | undefined;
      expect(() => { r = validateGraph(junk); }).not.toThrow();
      expect(r!.ok).toBe(false);
    }
    expect(validateGraph(g).ok).toBe(true);
  });
  it('exports a stable review schema with a screen-reader summary and formula-safe CSV', () => {
    const r = reach(g, 'a-payroll', 'any');
    const out = exportReview(g, r, hotspots(g), toxicCombinations(g));
    expect(out.json.schema).toBe('pathcaster.review/v1');
    expect(out.json.summary).toMatch(/Payroll DB/);
    expect(out.json.identities.find((i) => i.identityId === 'u-ada')!.decision).toBe('deny');
    const evil: Graph = { ...g, nodes: g.nodes.map((n) => n.id === 'u-ada' ? { ...n, label: '=HYPERLINK()' } : n) };
    expect(exportReview(evil, reach(evil, 'a-payroll', 'any'), [], []).csv).toContain("'=HYPERLINK");
  });
});

/** Layered fully-connected group graph: W^L paths from one identity, final assignment guarded by a condition that fails. */
function layered(L: number, W: number, opts: { condFails?: boolean; denyAsset?: boolean } = {}): Graph {
  const nodes: Graph['nodes'] = [{ id: 'u', kind: 'identity', label: 'U', attrs: { x: '1' } }, { id: 'r', kind: 'role', label: 'R' }, { id: 'p', kind: 'permission', label: 'P', action: 'read' }, { id: 'a', kind: 'asset', label: 'A', sensitivity: 'high' }];
  const edges: Graph['edges'] = [];
  for (let l = 0; l < L; l++) for (let w = 0; w < W; w++) nodes.push({ id: `g${l}_${w}`, kind: 'group', label: `G${l}${w}` });
  for (let w = 0; w < W; w++) edges.push({ id: `eu${w}`, from: 'u', to: `g0_${w}`, kind: 'member_of' });
  for (let l = 0; l < L - 1; l++) for (let w = 0; w < W; w++) for (let v = 0; v < W; v++) edges.push({ id: `e${l}_${w}_${v}`, from: `g${l}_${w}`, to: `g${l + 1}_${v}`, kind: 'member_of' });
  for (let w = 0; w < W; w++) edges.push({ id: `el${w}`, from: `g${L - 1}_${w}`, to: 'r', kind: 'assigned', ...(opts.condFails ? { condition: { attr: 'x', op: 'eq', value: '2' } } : {}) });
  edges.push({ id: 'gr', from: 'r', to: 'p', kind: 'grants' }, { id: 'ap', from: 'p', to: 'a', kind: 'applies_to' });
  if (opts.denyAsset) edges.push({ id: 'dn', from: 'g0_0', to: 'a', kind: 'deny', note: 'deny' });
  return { schemaVersion: 1, label: 'layered', nodes, edges, toxicRules: [] };
}

describe('traversal budget (sixth-Fable review: blocked paths were unbounded)', () => {
  it('caps condition-blocked paths and marks the result truncated/indeterminate instead of exhausting memory', () => {
    const g = layered(3, 5, { condFails: true }); // 125 blocked paths from 19 nodes
    expect(validateGraph(g).ok).toBe(true);
    const r = reach(g, 'a', 'read');
    const u = r.identities[0]!;
    expect(u.blockedByCondition.length).toBeLessThanOrEqual(LIMITS.maxPathsPerIdentity);
    expect(u.truncated).toBe(true);
    expect(u.decision).toBe('indeterminate');
    expect(u.indeterminateReason).toMatch(/budget|truncated|cap/i);
  });
  it('stops expanding after the node-expansion budget and finishes quickly on a path-explosion graph', () => {
    const g = layered(6, 4, { condFails: true }); // 4 096 paths; expansions would exceed the budget
    const t = Date.now();
    const r = reach(g, 'a', 'read');
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.identities[0]!.truncated).toBe(true);
    expect(r.identities[0]!.decision).toBe('indeterminate');
    expect(r.summary.indeterminate).toBe(1);
  });
  it('never returns a false allow or deny when truncated: deny is only definitive with a found path and an applicable deny; allow only when no deny could apply', () => {
    const denied = reach(layered(5, 4, { denyAsset: true }), 'a', 'read').identities[0]!; // 1 024 allow paths, truncated, deny on asset
    expect(denied.truncated).toBe(true);
    expect(denied.decision).toBe('deny');
    const clean = reach(layered(5, 4), 'a', 'read').identities[0]!; // truncated, paths found, no deny edges anywhere
    expect(clean.truncated).toBe(true);
    expect(clean.decision).toBe('allow');
  });
  it("completes the reviewer's 60-node / 359-edge explosion graph (8 layers × 7) in bounded time and memory", () => {
    const g = layered(8, 7, { condFails: true });
    expect(g.nodes.length).toBe(60); expect(g.edges.length).toBe(359); expect(validateGraph(g).ok).toBe(true);
    const t = Date.now();
    const r = reach(g, 'a', 'read');
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.identities[0]!.decision).toBe('indeterminate');
    expect(hotspots(g).length).toBeGreaterThan(0); // hotspots re-use reach per asset and must also terminate
  });
  it('does not report indeterminate for ordinary graphs', () => {
    const r = reach(g, 'a-payroll', 'any');
    expect(r.identities.every((i) => !i.truncated && i.decision !== 'indeterminate')).toBe(true);
  });
  it('transitive group membership honours conditions on member_of edges', () => {
    const g2: Graph = { schemaVersion: 1, label: 't', toxicRules: [], nodes: [
      { id: 'u', kind: 'identity', label: 'U', attrs: { dept: 'eng' } }, { id: 'gx', kind: 'group', label: 'G' }, { id: 'r1', kind: 'role', label: 'R1' }, { id: 'p1', kind: 'permission', label: 'P1', action: 'read' }, { id: 'a', kind: 'asset', label: 'A', sensitivity: 'high' }],
      edges: [{ id: 'm', from: 'u', to: 'gx', kind: 'member_of', condition: { attr: 'dept', op: 'eq', value: 'finance' } }, { id: 'e1', from: 'u', to: 'r1', kind: 'assigned' }, { id: 'e3', from: 'r1', to: 'p1', kind: 'grants' }, { id: 'e5', from: 'p1', to: 'a', kind: 'applies_to' }, { id: 'd1', from: 'gx', to: 'a', kind: 'deny' }] };
    expect(transitiveGroups(g2, 'u').has('gx')).toBe(false);
    expect(reach(g2, 'a', 'read').identities[0]!.decision).toBe('allow');
  });
});
