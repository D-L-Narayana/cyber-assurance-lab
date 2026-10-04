import { describe, expect, it } from 'vitest';
import demo from '../fixtures/demo.json';
import { explainPath, exportReview, hotspots, reach, toxicCombinations, validateGraph, whatIfRemoveEdge } from './graph';
import type { Graph, ReachResult } from './types';

/** Four identities on one vault: admin-only, write-only, read-only, and admin-via-group with a deny on the admin permission. */
const g: Graph = {
  schemaVersion: 1, label: 'hierarchy',
  nodes: [
    { id: 'u-admin', kind: 'identity', label: 'Avery Admin' },
    { id: 'u-writer', kind: 'identity', label: 'Wren Writer' },
    { id: 'u-reader', kind: 'identity', label: 'Rae Reader' },
    { id: 'u-denied', kind: 'identity', label: 'Dax Denied' },
    { id: 'g-ops', kind: 'group', label: 'Ops' },
    { id: 'r-admin', kind: 'role', label: 'Vault admin' },
    { id: 'r-writer', kind: 'role', label: 'Vault writer' },
    { id: 'r-reader', kind: 'role', label: 'Vault reader' },
    { id: 'p-admin', kind: 'permission', label: 'vault:admin', action: 'admin' },
    { id: 'p-write', kind: 'permission', label: 'vault:write', action: 'write' },
    { id: 'p-read', kind: 'permission', label: 'vault:read', action: 'read' },
    { id: 'a-vault', kind: 'asset', label: 'Vault', sensitivity: 'high' },
  ],
  edges: [
    { id: 'e-admin', from: 'u-admin', to: 'r-admin', kind: 'assigned' },
    { id: 'e-writer', from: 'u-writer', to: 'r-writer', kind: 'assigned' },
    { id: 'e-reader', from: 'u-reader', to: 'r-reader', kind: 'assigned' },
    { id: 'e-denied-m', from: 'u-denied', to: 'g-ops', kind: 'member_of' },
    { id: 'e-ops-admin', from: 'g-ops', to: 'r-admin', kind: 'assigned' },
    { id: 'e-deny', from: 'g-ops', to: 'p-admin', kind: 'deny', note: 'Ops may not use vault:admin' },
    { id: 'e-g-admin', from: 'r-admin', to: 'p-admin', kind: 'grants' },
    { id: 'e-g-write', from: 'r-writer', to: 'p-write', kind: 'grants' },
    { id: 'e-g-read', from: 'r-reader', to: 'p-read', kind: 'grants' },
    { id: 'e-a-admin', from: 'p-admin', to: 'a-vault', kind: 'applies_to' },
    { id: 'e-a-write', from: 'p-write', to: 'a-vault', kind: 'applies_to' },
    { id: 'e-a-read', from: 'p-read', to: 'a-vault', kind: 'applies_to' },
  ],
  toxicRules: [{ id: 'tx', name: 'Write and admin on the vault', a: { assetId: 'a-vault', action: 'write' }, b: { assetId: 'a-vault', action: 'admin' }, rationale: 'Separation of duties.' }],
};
const decision = (r: ReachResult, id: string) => r.identities.find((i) => i.identityId === id)!.decision;
const demoGraph = (() => { const v = validateGraph(demo); if (!v.ok) throw new Error(v.errors.join('; ')); return v.graph; })();

describe('permission hierarchy option (admin ⊃ write ⊃ read), October 2026 round', () => {
  it('is off by default and the explicit false form is identical, on the unit graph and on the shipped fixture', () => {
    expect(validateGraph(g).ok).toBe(true);
    const plain = reach(g, 'a-vault', 'read');
    expect(plain.hierarchy).toBe(false);
    expect(reach(g, 'a-vault', 'read', { hierarchy: false })).toEqual(plain);
    expect(reach(g, 'a-vault', 'read', {})).toEqual(plain);
    expect(decision(plain, 'u-admin')).toBe('none');
    expect(decision(plain, 'u-writer')).toBe('none');
    expect(decision(plain, 'u-reader')).toBe('allow');
    expect(decision(plain, 'u-denied')).toBe('none');
    const demoPlain = reach(demoGraph, 'a-prod', 'read');
    expect(demoPlain.hierarchy).toBe(false);
    expect(reach(demoGraph, 'a-prod', 'read', { hierarchy: false })).toEqual(demoPlain);
  });

  it('with hierarchy, admin satisfies write and read and write satisfies read; nothing is implied upwards', () => {
    const read = reach(g, 'a-vault', 'read', { hierarchy: true });
    expect(read.hierarchy).toBe(true);
    expect(decision(read, 'u-admin')).toBe('allow');
    expect(decision(read, 'u-writer')).toBe('allow');
    expect(decision(read, 'u-reader')).toBe('allow');
    const write = reach(g, 'a-vault', 'write', { hierarchy: true });
    expect(decision(write, 'u-admin')).toBe('allow');
    expect(decision(write, 'u-writer')).toBe('allow');
    expect(decision(write, 'u-reader')).toBe('none');
    const admin = reach(g, 'a-vault', 'admin', { hierarchy: true });
    expect(decision(admin, 'u-admin')).toBe('allow');
    expect(decision(admin, 'u-writer')).toBe('none');
    expect(decision(admin, 'u-reader')).toBe('none');
    expect(read.summary).toEqual({ allow: 3, deny: 1, none: 0, indeterminate: 0 });
  });

  it('a deny on the admin permission still blocks the read that the admin permission would have satisfied, and the path names that permission', () => {
    expect(decision(reach(g, 'a-vault', 'read'), 'u-denied')).toBe('none');
    const read = reach(g, 'a-vault', 'read', { hierarchy: true });
    const dax = read.identities.find((i) => i.identityId === 'u-denied')!;
    expect(dax.decision).toBe('deny');
    expect(dax.denies.map((d) => d.edgeId)).toEqual(['e-deny']);
    expect(dax.paths[0]!.steps.map((s) => s.nodeId)).toContain('p-admin');
    expect(explainPath(g, dax.paths[0]!)).toMatch(/vault:admin/);
    const avery = read.identities.find((i) => i.identityId === 'u-admin')!;
    expect(explainPath(g, avery.paths[0]!)).toMatch(/vault:admin/);
  });

  it('"any" queries are unaffected by the option', () => {
    const plain = reach(g, 'a-vault', 'any');
    const withH = reach(g, 'a-vault', 'any', { hierarchy: true });
    expect(withH.summary).toEqual(plain.summary);
    expect(withH.identities.map((i) => [i.identityId, i.decision, i.paths.length])).toEqual(plain.identities.map((i) => [i.identityId, i.decision, i.paths.length]));
  });

  it('what-if counts respect the option and record it', () => {
    const plain = whatIfRemoveEdge(g, 'e-admin', 'a-vault', 'read');
    expect(plain).toMatchObject({ hierarchy: false, before: 1, after: 1, lostAccess: [], gainedAccess: [] });
    const withH = whatIfRemoveEdge(g, 'e-admin', 'a-vault', 'read', { hierarchy: true });
    expect(withH).toMatchObject({ hierarchy: true, before: 3, after: 2, lostAccess: ['u-admin'], gainedAccess: [] });
  });

  it('toxic combinations: an admin-only identity holds both sides only under the hierarchy; a denied admin never does', () => {
    expect(toxicCombinations(g).some((t) => t.identityId === 'u-admin')).toBe(false);
    const withH = toxicCombinations(g, { hierarchy: true });
    expect(withH.some((t) => t.ruleId === 'tx' && t.identityId === 'u-admin')).toBe(true);
    expect(withH.some((t) => t.identityId === 'u-denied')).toBe(false);
    expect(withH.some((t) => t.identityId === 'u-writer')).toBe(false);
  });

  it('hotspots accept the option but are unchanged by it (they query every asset with "any")', () => {
    expect(hotspots(g, { hierarchy: true })).toEqual(hotspots(g));
  });

  it('the export records query.hierarchy (additive; schema id unchanged) and the summary says so when it was applied', () => {
    const off = exportReview(g, reach(g, 'a-vault', 'read'), [], []).json;
    expect(off.schema).toBe('pathcaster.review/v1');
    expect(off.query.hierarchy).toBe(false);
    expect(off.summary).not.toMatch(/hierarchy/);
    const on = exportReview(g, reach(g, 'a-vault', 'read', { hierarchy: true }), hotspots(g, { hierarchy: true }), toxicCombinations(g, { hierarchy: true })).json;
    expect(on.query).toEqual({ assetId: 'a-vault', asset: 'Vault', action: 'read', hierarchy: true });
    expect(on.summary).toMatch(/3 identities can reach Vault \(read\)/);
    expect(on.summary).toMatch(/hierarchy/);
    expect(on.toxic.some((t) => t.identityId === 'u-admin')).toBe(true);
  });

  it('is deterministic with the option on, and widens but never narrows the allowed set on the shipped fixture', () => {
    const a = reach(demoGraph, 'a-prod', 'read', { hierarchy: true });
    expect(reach(demoGraph, 'a-prod', 'read', { hierarchy: true })).toEqual(a);
    const plain = reach(demoGraph, 'a-prod', 'read');
    const allowed = (r: ReachResult) => r.identities.filter((i) => i.decision === 'allow').map((i) => i.identityId);
    for (const id of allowed(plain)) expect(allowed(a)).toContain(id);
    expect(a.summary.allow).toBeGreaterThanOrEqual(plain.summary.allow);
    const anyPlain = reach(demoGraph, 'a-prod', 'any');
    expect(reach(demoGraph, 'a-prod', 'any', { hierarchy: true }).summary).toEqual(anyPlain.summary);
  });
});
