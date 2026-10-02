import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/brewline-scenario.json';
import { parseScenario, validateScenario, LIMITS } from '../scenario';
import { applyTamper } from '../tamper';
import { runScenario } from '../simulate';
import { buildReport, reportToMarkdown } from '../report';
import type { Scenario } from '../types';

const scenario = (): Scenario => {
  const r = validateScenario(fixture);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.scenario;
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const step = (s: ReturnType<typeof runScenario>, id: string) => s.steps.find((x) => x.stepId === id)!;

describe('scenario validation', () => {
  it('accepts the synthetic Brewline scenario', () => {
    expect(validateScenario(fixture).ok).toBe(true);
  });
  it('rejects unknown tamper kinds, unknown users/skus, duplicate step ids and replay of a later step', () => {
    const a = clone(fixture); a.steps[1].tamper = { kind: 'teleport' };
    expect(validateScenario(a).ok).toBe(false);
    const b = clone(fixture); b.steps[0].client.user = 'u-ghost';
    expect(validateScenario(b).ok).toBe(false);
    const c = clone(fixture); c.steps[1].id = 's1';
    expect(validateScenario(c).ok).toBe(false);
    const d = clone(fixture); d.steps[5].tamper = { kind: 'replay', of: 's11' };
    const r = validateScenario(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/earlier step/);
  });
  it('bounds size, step count, nesting and numeric sanity', () => {
    expect(parseScenario('{').ok).toBe(false);
    expect(parseScenario(JSON.stringify(fixture) + ' '.repeat(LIMITS.maxBytes)).ok).toBe(false);
    const many: Record<string, unknown> = clone(fixture);
    many.steps = Array.from({ length: LIMITS.maxSteps + 1 }, (_, i) => ({ ...fixture.steps[0], id: `x${i}`, client: { ...fixture.steps[0].client, nonce: `n${i}` } }));
    expect(validateScenario(many).ok).toBe(false);
    const neg = clone(fixture); neg.catalog[0].price = -1;
    expect(validateScenario(neg).ok).toBe(false);
    const infText = JSON.stringify(fixture).replace('"price":4.5', '"price":1e999');
    expect(infText).toMatch(/1e999/);
    expect(parseScenario(infText).ok).toBe(false);
  });
});

describe('tamper layer', () => {
  it('price-rewrite lowers unit prices and total but keeps items and skus', () => {
    const s = scenario();
    const msg = { user: 'u-maya', event: 'place-order' as const, nonce: 'n', ts: s.baseTime, payload: { items: [{ sku: 'flat-white', qty: 1, unitPrice: 4.5 }], total: 4.5 } };
    const t = applyTamper(msg, { kind: 'price-rewrite' }, s, []);
    expect(t.message.payload).toMatchObject({ items: [{ sku: 'flat-white', qty: 1, unitPrice: 0.01 }], total: 0.01 });
    expect(t.changedFields).toEqual(expect.arrayContaining(['items[0].unitPrice', 'total']));
    expect(msg.payload.total).toBe(4.5);
  });
  it('replay copies the nonce and payload of the referenced earlier message', () => {
    const s = scenario();
    const earlier = { stepId: 's5', message: { user: 'u-maya', event: 'redeem-reward' as const, nonce: 'n-1005', ts: s.baseTime, payload: { rewardId: 'rw-free-coffee', points: 120 } } };
    const msg = { ...earlier.message, nonce: 'fresh', ts: '2026-10-01T08:01:15Z' };
    const t = applyTamper(msg, { kind: 'replay', of: 's5' }, s, [earlier]);
    expect(t.message.nonce).toBe('n-1005');
    expect(t.changedFields).toContain('nonce');
  });
});

describe('trusting server (client-authoritative)', () => {
  const run = runScenario(scenario(), 'trusting');
  it('accepts every step and charges the client-supplied total', () => {
    expect(run.steps.every((x) => x.decision === 'accepted')).toBe(true);
    expect(step(run, 's2').serverView.total).toBe(0.02);
  });
  it('raises one finding per tampered step with CWE mapping', () => {
    const byStep = Object.fromEntries(run.steps.filter((x) => x.finding).map((x) => [x.stepId, x.finding!.cwe]));
    expect(byStep).toEqual({ s2: 'CWE-602', s4: 'CWE-602', s6: 'CWE-294', s8: 'CWE-269', s9: 'CWE-639', s10: 'CWE-294' });
    expect(run.summary.findings).toBe(6);
  });
  it('labels price and role as client-controlled', () => {
    expect(step(run, 's2').fieldOrigins['items[0].unitPrice']).toBe('client-controlled');
    expect(step(run, 's8').fieldOrigins['role']).toBe('client-controlled');
  });
});

describe('enforcing server (server-authoritative)', () => {
  const run = runScenario(scenario(), 'enforcing');
  it('neutralizes price, coupon and role tampering by recomputing from server state', () => {
    expect(step(run, 's2').decision).toBe('neutralized');
    expect(step(run, 's2').serverView.total).toBe(7.75);
    expect(step(run, 's4').decision).toBe('neutralized');
    expect(step(run, 's4').serverView.discountPercent).toBe(10);
    expect(step(run, 's8').decision).toBe('neutralized');
    expect(step(run, 's8').serverView.role).toBe('customer');
  });
  it('rejects replay, backdated and cross-user requests with named checks', () => {
    expect(step(run, 's6').decision).toBe('rejected');
    expect(step(run, 's6').checks.find((c) => c.name === 'nonce-single-use')?.passed).toBe(false);
    expect(step(run, 's10').decision).toBe('rejected');
    expect(step(run, 's10').checks.find((c) => c.name === 'timestamp-window')?.passed).toBe(false);
    expect(step(run, 's9').decision).toBe('rejected');
    expect(step(run, 's9').checks.find((c) => c.name === 'object-ownership')?.passed).toBe(false);
  });
  it('accepts every untampered step and produces no findings', () => {
    for (const id of ['s1', 's3', 's5', 's7', 's11']) expect(step(run, id).decision).toBe('accepted');
    expect(run.summary.findings).toBe(0);
    expect(step(run, 's2').fieldOrigins['items[0].unitPrice']).toBe('server-derived');
  });
  it('keeps the reward balance consistent: one redemption, not two', () => {
    expect(step(run, 's5').serverView.balanceAfter).toBe(30);
    expect(step(run, 's6').serverView.balanceAfter).toBe(30);
    const trusting = runScenario(scenario(), 'trusting');
    expect(step(trusting, 's6').serverView.balanceAfter).toBe(-90);
  });
});

describe('determinism and export', () => {
  it('is deterministic', () => {
    expect(runScenario(scenario(), 'enforcing')).toEqual(runScenario(scenario(), 'enforcing'));
  });
  it('exports a stable schema without raw session tokens', () => {
    const s = scenario();
    const report = buildReport(s, { trusting: runScenario(s, 'trusting'), enforcing: runScenario(s, 'enforcing') }, '2026-10-01T00:00:00.000Z');
    expect(report.schema).toBe('seamline.report/1');
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/tok-maya-7f21/);
    expect(text).toMatch(/\[token:u-maya\]/);
    expect(report.comparison.find((c) => c.stepId === 's6')).toMatchObject({ trusting: 'accepted', enforcing: 'rejected' });
    expect(reportToMarkdown(report)).toContain('CWE-294');
  });
});

describe('sixth-Fable regression — findings must come from client/server divergence, not the tamper label', () => {
  it('flags an untampered step whose client total disagrees with the catalog when the trusting server bills it', () => {
    const raw = clone(fixture);
    raw.steps[0].client.payload.total = 0.5;
    const r = validateScenario(raw);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const trusting = runScenario(r.scenario, 'trusting');
    const s1 = step(trusting, 's1');
    expect(s1.decision).toBe('accepted');
    expect(s1.serverView.total).toBe(0.5);
    expect(s1.finding?.cwe).toBe('CWE-602');
    expect(s1.divergences.map((d) => d.invariant)).toContain('price-from-catalog');
    const enforcing = runScenario(r.scenario, 'enforcing');
    expect(step(enforcing, 's1').decision).toBe('neutralized');
    expect(step(enforcing, 's1').finding).toBeUndefined();
  });
  it('records divergences for every tampered step on the trusting server and none for consistent steps', () => {
    const run = runScenario(scenario(), 'trusting');
    for (const id of ['s2', 's4', 's6', 's8', 's9', 's10']) expect(step(run, id).divergences.length, id).toBeGreaterThan(0);
    for (const id of ['s1', 's3', 's5', 's7', 's11']) expect(step(run, id).divergences, id).toEqual([]);
  });
  it('a tamper label without actual divergence produces no finding', () => {
    const raw = clone(fixture);
    // Label s1 as "price-rewrite" but the tamper layer is bypassed by giving it no effect: use other-user-object on a view-order whose only order is the user's own.
    raw.orders = [{ id: 'ord-5002', user: 'u-maya', total: 7.75 }];
    raw.steps = [{ id: 'v1', label: 'view own order, labelled tampered', client: { user: 'u-maya', event: 'view-order', nonce: 'n-1', tOffset: 0, payload: { orderId: 'ord-5002' } }, tamper: { kind: 'other-user-object' } }];
    const r = validateScenario(raw);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const run = runScenario(r.scenario, 'trusting');
    expect(step(run, 'v1').decision).toBe('accepted');
    expect(step(run, 'v1').finding).toBeUndefined();
  });
});
