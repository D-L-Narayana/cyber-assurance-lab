import { describe, expect, it } from 'vitest';
import demo from './demo.json';
import { hotspots, reach, toxicCombinations, validateGraph } from '../engine/graph';

describe('demo graph', () => {
  it('validates and contains the seeded findings', () => {
    const v = validateGraph(demo);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const g = v.graph;
    expect(g.nodes.length).toBeGreaterThanOrEqual(90);
    const prod = reach(g, 'a-prod', 'admin');
    expect(prod.identities.find((i) => i.identityId === 'u-003')!.decision).toBe('allow');   // stale legacy admin group
    expect(prod.identities.find((i) => i.identityId === 'u-012')!.decision).toBe('deny');    // contractor deny override
    const payroll = reach(g, 'a-payroll', 'admin');
    const x = payroll.identities.find((i) => i.identityId === 'u-999')!;
    expect(x.decision).toBe('none');
    expect(x.blockedByCondition.length).toBeGreaterThan(0);                                   // MFA condition
    const tox = toxicCombinations(g);
    expect(tox.some((t) => t.ruleId === 'tx-prod-vault' && t.identityId === 'u-003')).toBe(true);
    expect(tox.some((t) => t.ruleId === 'tx-payroll-wh' && t.identityId === 'u-001')).toBe(true);
    expect(hotspots(g)[0]!.identities).toBeGreaterThan(0);
  });
});
