import { describe, expect, it } from 'vitest';
import demo from './demo.json';
import { buildCampaign, validateFixture } from '../engine/campaign';

describe('demo fixture', () => {
  it('validates and contains the seeded findings', () => {
    const v = validateFixture(demo);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const c = buildCampaign(v.fixture, { dormantAfterDays: 90, asOf: v.fixture.asOf });
    const kinds = c.items.flatMap((i) => i.hints.map((h) => h.kind));
    expect(kinds).toContain('sod_conflict');
    expect(kinds).toContain('orphan');
    expect(kinds).toContain('never_used');
    expect(kinds).toContain('dormant');
    // id-034 has no manager: contracts.sign routes to the contract owner, but share.admin on the legacy share (owner left) is unrouted.
    expect(c.items.find((i) => i.identity.id === 'id-034' && i.entitlement.privilege === 'contracts.sign')!.reviewerId).toBe('id-mgr-legal');
    const unrouted = c.items.filter((i) => i.reviewerId === null);
    expect(unrouted.map((i) => i.entitlement.privilege)).toEqual(expect.arrayContaining(['share.admin', 'share.read']));
    // Managers who own the resource they hold access on can no longer review themselves: those items are unrouted with a self_review hint.
    expect(unrouted.filter((i) => i.hints.some((h) => h.kind === 'self_review')).length).toBeGreaterThanOrEqual(6);
    expect(c.items.every((i) => i.reviewerId !== i.identity.id)).toBe(true);
    expect(unrouted.length).toBe(12);
    expect(c.items.filter((i) => i.hints.some((h) => h.kind === 'sod_conflict')).length).toBeGreaterThanOrEqual(4);
  });
});
