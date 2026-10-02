import { describe, expect, it } from 'vitest';
import {
  buildCampaign,
  applyDecision,
  completion,
  exportCertification,
  validateFixture,
  bulkDecision,
  routeItem,
  CAMPAIGN_OWNER,
} from './campaign';
import type { Fixture } from './types';

const base: Fixture = {
  schemaVersion: 1,
  label: 'unit',
  asOf: '2026-10-01',
  identities: [
    { id: 'u1', displayName: 'Ada Example', roleType: 'employee', department: 'Finance', managerId: 'm1', status: 'active', lastSignIn: '2026-09-30' },
    { id: 'u2', displayName: 'Ben Example', roleType: 'contractor', department: 'Finance', managerId: 'm1', status: 'leaver', lastSignIn: '2026-03-01' },
    { id: 'u3', displayName: 'Cy Example', roleType: 'service', department: 'IT', managerId: null, status: 'active', lastSignIn: null },
    { id: 'm1', displayName: 'Mia Manager', roleType: 'employee', department: 'Finance', managerId: null, status: 'active', lastSignIn: '2026-09-29' },
    { id: 'm2', displayName: 'Omar Owner', roleType: 'employee', department: 'IT', managerId: null, status: 'active', lastSignIn: '2026-09-29' },
  ],
  resources: [
    { id: 'pay', name: 'Payroll', owner: 'm2', sensitivity: 'high' },
    { id: 'wiki', name: 'Wiki', owner: 'm2', sensitivity: 'low' },
  ],
  entitlements: [
    { id: 'e1', identityId: 'u1', resourceId: 'pay', privilege: 'payroll.create', privileged: false, grantedOn: '2025-01-01', lastUsed: '2026-09-20' },
    { id: 'e2', identityId: 'u1', resourceId: 'pay', privilege: 'payroll.approve', privileged: true, grantedOn: '2025-01-01', lastUsed: '2026-01-01' },
    { id: 'e3', identityId: 'u2', resourceId: 'wiki', privilege: 'wiki.read', privileged: false, grantedOn: '2025-01-01', lastUsed: '2026-02-01' },
    { id: 'e4', identityId: 'u3', resourceId: 'pay', privilege: 'payroll.export', privileged: true, grantedOn: '2025-01-01', lastUsed: null },
  ],
  sodRules: [
    { id: 'sod1', name: 'Create vs approve payroll', conflict: ['payroll.create', 'payroll.approve'], rationale: 'One person must not both create and approve a payroll run.' },
  ],
};

describe('buildCampaign risk hints', () => {
  const c = buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
  const item = (eid: string) => c.items.find((i) => i.entitlement.id === eid)!;

  it('flags both sides of a separation-of-duties conflict', () => {
    const e1 = item('e1').hints.find((h) => h.kind === 'sod_conflict');
    const e2 = item('e2').hints.find((h) => h.kind === 'sod_conflict');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    expect(e1 && e1.kind === 'sod_conflict' && e1.counterpartEntitlementId).toBe('e2');
  });

  it('flags dormant entitlements using the configured threshold', () => {
    const d = item('e2').hints.find((h) => h.kind === 'dormant');
    expect(d && d.kind === 'dormant' && d.idleDays).toBe(273);
    expect(item('e1').hints.some((h) => h.kind === 'dormant')).toBe(false);
  });

  it('flags never-used entitlements separately from dormant', () => {
    expect(item('e4').hints.some((h) => h.kind === 'never_used')).toBe(true);
    expect(item('e4').hints.some((h) => h.kind === 'dormant')).toBe(false);
  });

  it('routes leaver access to the resource owner as orphan', () => {
    const it3 = item('e3');
    expect(it3.hints.some((h) => h.kind === 'orphan')).toBe(true);
    expect(it3.reviewerId).toBe('m2');
  });

  it('routes identities without a manager to the resource owner and marks no_reviewer only when no owner exists', () => {
    expect(item('e4').reviewerId).toBe('m2');
    const noOwner: Fixture = { ...base, resources: [{ id: 'pay', name: 'Payroll', owner: 'ghost', sensitivity: 'high' }, base.resources[1]!] };
    const c2 = buildCampaign(noOwner, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const i = c2.items.find((x) => x.entitlement.id === 'e4')!;
    expect(i.reviewerId).toBeNull();
    expect(i.hints.some((h) => h.kind === 'no_reviewer')).toBe(true);
  });

  it('scores risk deterministically and higher for more hints', () => {
    expect(item('e2').riskScore).toBeGreaterThan(item('e1').riskScore);
    const again = buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
    expect(again.items.map((i) => i.riskScore)).toEqual(c.items.map((i) => i.riskScore));
  });
});

describe('applyDecision state machine', () => {
  const fresh = () => buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
  const idOf = (c: ReturnType<typeof fresh>, eid: string) => c.items.find((i) => i.entitlement.id === eid)!.id;

  it('approves a clean entitlement without a reason', () => {
    const c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'revoke', reason: 'Leaver' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.campaign.items.find((i) => i.entitlement.id === 'e3')!.state).toBe('revoked');
  });

  it('requires a reason when approving a flagged entitlement', () => {
    const c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e2'), actor: 'm1', decision: 'approve', reason: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reason/i);
  });

  it('requires an explicit SoD override when approving the second side of a conflict', () => {
    let c = fresh();
    const first = applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'approve', reason: 'Needed for role' });
    expect(first.ok).toBe(true);
    if (first.ok) c = first.campaign;
    const second = applyDecision(c, { itemId: idOf(c, 'e2'), actor: 'm1', decision: 'approve', reason: 'Needed too' });
    expect(second.ok).toBe(false);
    const withOverride = applyDecision(c, {
      itemId: idOf(c, 'e2'), actor: 'm1', decision: 'approve', reason: 'Needed too',
      sodOverride: { ruleId: 'sod1', rationale: 'Compensating control: dual review of approvals by CFO' },
    });
    expect(withOverride.ok).toBe(true);
    if (withOverride.ok) expect(withOverride.campaign.decisions.at(-1)?.sodOverride?.ruleId).toBe('sod1');
  });

  it('rejects delegation to self and to unknown reviewers', () => {
    const c = fresh();
    expect(applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'delegate', reason: 'x', delegateTo: 'm1' }).ok).toBe(false);
    expect(applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'delegate', reason: 'x', delegateTo: 'nobody' }).ok).toBe(false);
    const ok = applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'delegate', reason: 'Resource owner knows better', delegateTo: 'm2' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const it = ok.campaign.items.find((i) => i.entitlement.id === 'e1')!;
      expect(it.reviewerId).toBe('m2');
      expect(it.state).toBe('pending');
    }
  });

  it('rejects decisions by someone other than the assigned reviewer', () => {
    const c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm2', decision: 'approve', reason: 'ok' });
    expect(r.ok).toBe(false);
  });

  it('allows reversing a decision while campaign is open and records every decision', () => {
    let c = fresh();
    const a = applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'approve', reason: 'keep' });
    if (a.ok) c = a.campaign;
    const b = applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'revoke', reason: 'changed mind: leaver' });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.campaign.decisions).toHaveLength(2);
      expect(b.campaign.decisions.map((d) => d.seq)).toEqual([1, 2]);
    }
  });

  it('bulk decisions stop at the first invalid item and apply none', () => {
    const c = fresh();
    const r = bulkDecision(c, [idOf(c, 'e3'), idOf(c, 'e4')], { actor: 'm2', decision: 'approve', reason: '' });
    expect(r.ok).toBe(false);
    const ok = bulkDecision(c, [idOf(c, 'e3'), idOf(c, 'e4')], { actor: 'm2', decision: 'revoke', reason: 'Bulk cleanup of unowned access' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.campaign.items.filter((i) => i.state === 'revoked')).toHaveLength(2);
  });
});

describe('completion and export', () => {
  it('reports pending blockers by reviewer', () => {
    const c = buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const s = completion(c);
    expect(s.total).toBe(4);
    expect(s.decided).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.byReviewer.find((r) => r.reviewerId === 'm1')?.pending).toBe(2);
    expect(s.byReviewer.find((r) => r.reviewerId === 'm2')?.pending).toBe(2);
  });

  it('exports a stable certification schema and escapes CSV formulas', () => {
    let c = buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const id = c.items.find((i) => i.entitlement.id === 'e3')!.id;
    const r = applyDecision(c, { itemId: id, actor: 'm2', decision: 'revoke', reason: '=HYPERLINK("x")' });
    if (r.ok) c = r.campaign;
    const out = exportCertification(c);
    expect(out.json.schema).toBe('attestline.certification/v1');
    expect(out.json.items).toHaveLength(4);
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.json.summary.decided).toBe(1);
  });
});

describe('validateFixture', () => {
  it('rejects dangling references and bad dates', () => {
    const bad = { ...base, entitlements: [{ ...base.entitlements[0]!, identityId: 'missing' }] };
    const r = validateFixture(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/missing/);
    const badDate = { ...base, asOf: 'yesterday' };
    expect(validateFixture(badDate).ok).toBe(false);
  });
  it('rejects oversized fixtures', () => {
    const many = { ...base, entitlements: Array.from({ length: 3001 }, (_, i) => ({ ...base.entitlements[0]!, id: `e${i}` })) };
    expect(validateFixture(many).ok).toBe(false);
  });
  it('accepts the base fixture', () => {
    expect(validateFixture(base).ok).toBe(true);
  });
});

describe('validateFixture malformed rows (parent review finding)', () => {
  it('returns bounded errors instead of throwing when rows are null or wrong types', () => {
    const cases: unknown[] = [
      { ...base, identities: [null] },
      { ...base, identities: [42] },
      { ...base, resources: [null] },
      { ...base, entitlements: ['string'] },
      { ...base, sodRules: [null] },
      { ...base, sodRules: [{ id: 's', conflict: 'not-an-array' }] },
      { ...base, identities: 'nope' },
      null,
      [],
    ];
    for (const c of cases) {
      let r: ReturnType<typeof validateFixture> | undefined;
      expect(() => { r = validateFixture(c); }).not.toThrow();
      expect(r!.ok).toBe(false);
      if (!r!.ok) expect(r!.errors.length).toBeLessThanOrEqual(26);
    }
  });
});

describe('campaign-owner routing of unrouted items', () => {
  const noOwner: Fixture = { ...base, resources: [{ id: 'pay', name: 'Payroll', owner: 'ghost', sensitivity: 'high' }, base.resources[1]!] };
  it('lets the campaign owner assign a reviewer to an unrouted item, then that reviewer can decide', () => {
    let c = buildCampaign(noOwner, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const item = c.items.find((i) => i.entitlement.id === 'e4')!;
    expect(item.reviewerId).toBeNull();
    const bad = applyDecision(c, { itemId: item.id, actor: 'm2', decision: 'approve', reason: 'x' });
    expect(bad.ok).toBe(false);
    const routed = routeItem(c, { itemId: item.id, toReviewer: 'm2', reason: 'IT owns the service account' });
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    c = routed.campaign;
    expect(c.items.find((i) => i.id === item.id)!.reviewerId).toBe('m2');
    expect(c.decisions.at(-1)?.actor).toBe(CAMPAIGN_OWNER);
    expect(c.decisions.at(-1)?.decision).toBe('delegate');
    const ok = applyDecision(c, { itemId: item.id, actor: 'm2', decision: 'revoke', reason: 'unused privileged' });
    expect(ok.ok).toBe(true);
  });
  it('rejects routing to an identity that is not in the fixture and routing items that already have a reviewer', () => {
    const c = buildCampaign(noOwner, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const unrouted = c.items.find((i) => i.reviewerId === null)!;
    const routedItem = c.items.find((i) => i.reviewerId !== null)!;
    expect(routeItem(c, { itemId: unrouted.id, toReviewer: 'nobody', reason: 'x' }).ok).toBe(false);
    expect(routeItem(c, { itemId: routedItem.id, toReviewer: 'm2', reason: 'x' }).ok).toBe(false);
    expect(routeItem(c, { itemId: unrouted.id, toReviewer: 'm2', reason: '' }).ok).toBe(false);
  });
});

describe('self-review guards (sixth-Fable review)', () => {
  const fresh = () => buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
  const idOf = (c: ReturnType<typeof fresh>, eid: string) => c.items.find((i) => i.entitlement.id === eid)!.id;
  it('rejects delegation to the identity under review', () => {
    const c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'delegate', reason: 'you decide', delegateTo: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own access|under review/i);
  });
  it('rejects delegation to a leaver or suspended identity', () => {
    const c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e1'), actor: 'm1', decision: 'delegate', reason: 'please', delegateTo: 'u2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not active|leaver/i);
  });
  it('rejects any decision where the actor is the identity under review even if routed that way', () => {
    const forged = { ...fresh() };
    forged.items = forged.items.map((i) => i.entitlement.id === 'e1' ? { ...i, reviewerId: 'u1' } : i);
    const r = applyDecision(forged, { itemId: idOf(forged, 'e1'), actor: 'u1', decision: 'approve', reason: 'mine' });
    expect(r.ok).toBe(false);
  });
  it('routeItem refuses to route an item to the identity under review', () => {
    const noOwner: Fixture = { ...base, resources: [{ id: 'pay', name: 'Payroll', owner: 'ghost', sensitivity: 'high' }, base.resources[1]!] };
    const c = buildCampaign(noOwner, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const item = c.items.find((i) => i.entitlement.id === 'e4')!;
    expect(routeItem(c, { itemId: item.id, toReviewer: 'u3', reason: 'x' }).ok).toBe(false);
  });
  it('validateFixture rejects an identity that is its own manager', () => {
    const selfMgr = { ...base, identities: base.identities.map((i) => i.id === 'u1' ? { ...i, managerId: 'u1' } : i) };
    const r = validateFixture(selfMgr);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/own manager/);
  });
  it('never routes an entitlement to its own holder: resource owner holding access on own resource becomes unrouted with a self_review hint', () => {
    const fx: Fixture = { ...base, entitlements: [...base.entitlements, { id: 'e9', identityId: 'm2', resourceId: 'wiki', privilege: 'wiki.admin', privileged: false, grantedOn: '2025-01-01', lastUsed: '2026-09-01' }] };
    const c = buildCampaign(fx, { dormantAfterDays: 90, asOf: '2026-10-01' });
    const own = c.items.find((i) => i.entitlement.id === 'e9')!;
    expect(own.reviewerId).toBeNull();
    expect(own.hints.some((h) => h.kind === 'self_review')).toBe(true);
    expect(c.items.every((i) => i.reviewerId !== i.identity.id)).toBe(true);
  });
  it('falls back to another active resource owner when the manager would be reviewing their own access', () => {
    // m1 manages u1; give m1 an entitlement on wiki (owner m2, active) -> routed to m2, not m1
    const fx: Fixture = { ...base, entitlements: [...base.entitlements, { id: 'e10', identityId: 'm1', resourceId: 'wiki', privilege: 'wiki.read', privileged: false, grantedOn: '2025-01-01', lastUsed: '2026-09-01' }] };
    const c = buildCampaign(fx, { dormantAfterDays: 90, asOf: '2026-10-01' });
    expect(c.items.find((i) => i.entitlement.id === 'e10')!.reviewerId).toBe('m2');
  });
});
