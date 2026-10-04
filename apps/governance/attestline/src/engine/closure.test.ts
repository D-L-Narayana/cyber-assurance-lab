import { describe, expect, it } from 'vitest';
import {
  applyDecision, buildCampaign, bulkDecision, canonicalJson, certificationDigest, closeCampaign, completion,
  exportCertification, exportCertificationWithDigest, routeItem,
} from './campaign';
import type { Campaign, CampaignClosure, Fixture } from './types';
import type { CertificationExport } from './campaign';

// Same small synthetic fixture as campaign.test.ts (duplicated on purpose: test files do not import each other).
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

const fresh = () => buildCampaign(base, { dormantAfterDays: 90, asOf: '2026-10-01' });
const idOf = (c: Campaign, eid: string) => c.items.find((i) => i.entitlement.id === eid)!.id;
/** Revoke every item (each by its assigned reviewer) so nothing is pending. */
const decideAll = (start: Campaign): Campaign => {
  let c = start;
  for (const item of start.items) {
    const r = applyDecision(c, { itemId: item.id, actor: item.reviewerId!, decision: 'revoke', reason: 'Closing test: revoke everything' });
    if (!r.ok) throw new Error(r.error);
    c = r.campaign;
  }
  return c;
};
const closure: CampaignClosure = { at: '2026-10-02', by: 'm1', note: 'Quarterly campaign closed after review', pendingAtClose: 0 };

describe('closeCampaign', () => {
  it('refuses to close while items are pending unless the closer acknowledges them, and then records the pending count', () => {
    const c = fresh();
    const refused = closeCampaign(c, { actor: 'm1', note: 'Closing the Q3 campaign now', at: '2026-10-02' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/4 items are still pending/);
    const ack = closeCampaign(c, { actor: 'm1', note: 'Closing the Q3 campaign now', at: '2026-10-02', acknowledgePending: true });
    expect(ack.ok).toBe(true);
    if (ack.ok) expect(ack.campaign.closed).toEqual({ at: '2026-10-02', by: 'm1', note: 'Closing the Q3 campaign now', pendingAtClose: 4 });
  });

  it('closes cleanly when everything is decided; the closing date defaults to the campaign as-of date and no item changes', () => {
    const c = decideAll(fresh());
    const r = closeCampaign(c, { actor: 'm1', note: 'All four items decided; closing.' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.campaign.closed).toEqual({ at: '2026-10-01', by: 'm1', note: 'All four items decided; closing.', pendingAtClose: 0 });
    expect(r.campaign.items).toEqual(c.items);
    expect(r.campaign.decisions).toEqual(c.decisions);
    expect(completion(r.campaign).decided).toBe(4);
  });

  it('requires an actor, a note of at least 10 characters and a valid closing date not before as-of, and refuses to close twice', () => {
    const c = decideAll(fresh());
    expect(closeCampaign(c, { actor: '  ', note: 'Closing after review' }).ok).toBe(false);
    const short = closeCampaign(c, { actor: 'm1', note: 'too short' });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/10 characters/);
    expect(closeCampaign(c, { actor: 'm1', note: 'Closing after review', at: '2026-02-30' }).ok).toBe(false);
    expect(closeCampaign(c, { actor: 'm1', note: 'Closing after review', at: '2025-12-31' }).ok).toBe(false);
    const once = closeCampaign(c, { actor: 'm1', note: 'Closing after review' });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = closeCampaign(once.campaign, { actor: 'm1', note: 'Closing again by mistake' });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toMatch(/already closed/i);
  });
});

describe('a closed campaign accepts no further changes', () => {
  // The closure is attached by hand here so these guards are tested independently of closeCampaign.
  const closed = (): Campaign => ({ ...fresh(), closed: closure });

  it('applyDecision, bulkDecision and routeItem refuse with a "Campaign is closed" error', () => {
    const c = closed();
    const a = applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'revoke', reason: 'Leaver' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toMatch(/^Campaign is closed/);
    const b = bulkDecision(c, [idOf(c, 'e3'), idOf(c, 'e4')], { actor: 'm2', decision: 'revoke', reason: 'Bulk cleanup' });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/^Campaign is closed/);
    const noOwner: Fixture = { ...base, resources: [{ id: 'pay', name: 'Payroll', owner: 'ghost', sensitivity: 'high' }, base.resources[1]!] };
    const u: Campaign = { ...buildCampaign(noOwner, { dormantAfterDays: 90, asOf: '2026-10-01' }), closed: closure };
    const unrouted = u.items.find((i) => i.reviewerId === null)!;
    const r = routeItem(u, { itemId: unrouted.id, toReviewer: 'm2', reason: 'IT owns the service account' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Campaign is closed/);
  });

  it('the same inputs succeed on the open campaign, so the refusal is caused by the closure alone', () => {
    const c = fresh();
    expect(applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'revoke', reason: 'Leaver' }).ok).toBe(true);
    expect(bulkDecision(c, [idOf(c, 'e3'), idOf(c, 'e4')], { actor: 'm2', decision: 'revoke', reason: 'Bulk cleanup' }).ok).toBe(true);
  });
});

/** Reverse the key order of every plain object (arrays keep their order) to prove canonicalisation. */
function reversed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reversed);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reversed(x)]));
  return v;
}

describe('certification digest', () => {
  it('canonicalJson sorts object keys at every depth and leaves arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson(reversed({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }))).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('is a 64-hex SHA-256 that is stable run-to-run and across key order', async () => {
    const out = exportCertification(fresh()).json;
    const d1 = await certificationDigest(out);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
    expect(await certificationDigest(out)).toBe(d1);
    expect(await certificationDigest(reversed(out) as CertificationExport)).toBe(d1);
  });

  it('changes when covered content changes (a decision, the closure) and ignores the digest field itself', async () => {
    let c = fresh();
    const r = applyDecision(c, { itemId: idOf(c, 'e3'), actor: 'm2', decision: 'revoke', reason: 'Leaver' });
    if (r.ok) c = r.campaign;
    const d0 = await certificationDigest(exportCertification(fresh()).json);
    const d1 = await certificationDigest(exportCertification(c).json);
    expect(d1).not.toBe(d0);
    const closedExport = exportCertification({ ...c, closed: closure }).json;
    const d2 = await certificationDigest(closedExport);
    expect(d2).not.toBe(d1);
    expect(await certificationDigest({ ...closedExport, digest: 'ignored' })).toBe(d2);
    expect(await certificationDigest({ ...closedExport, closed: { ...closure, note: 'A different closing note' } })).not.toBe(d2);
  });

  it('exportCertificationWithDigest keeps the v1 schema and the CSV unchanged, adding digest and closed as additive fields', async () => {
    const open = fresh();
    const plain = exportCertification(open);
    expect(plain.json.closed).toBeUndefined();
    expect(Object.keys(plain.json)).toEqual(expect.arrayContaining(['schema', 'generatedFrom', 'asOf', 'config', 'summary', 'items', 'decisions', 'disclaimer']));
    const withDigest = await exportCertificationWithDigest(open);
    expect(withDigest.json.schema).toBe('attestline.certification/v1');
    expect(withDigest.json.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(withDigest.json.digest).toBe(await certificationDigest(plain.json));
    expect(withDigest.csv).toBe(plain.csv);
    expect(withDigest.json.items).toHaveLength(4);
    const closedCampaign: Campaign = { ...decideAll(open), closed: closure };
    const closedOut = await exportCertificationWithDigest(closedCampaign);
    expect(closedOut.json.closed).toEqual(closure);
    expect(closedOut.json.summary.decided).toBe(4);
    expect(exportCertification(closedCampaign).json.closed).toEqual(closure);
  });
});
