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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (): any => clone(fixture);
const accept = (raw: unknown): Scenario => { const r = validateScenario(raw); if (!r.ok) throw new Error(r.errors.join('\n')); return r.scenario; };
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
    expect(byStep).toEqual({ s2: 'CWE-602', s4: 'CWE-602', s6: 'CWE-294', s8: 'CWE-269', s9: 'CWE-639', s10: 'CWE-294', s12: 'CWE-20' });
    expect(run.summary.findings).toBe(7);
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
    expect(step(run, 's12').decision).toBe('rejected');
    expect(step(run, 's12').checks.find((c) => c.name === 'quantity-valid')?.passed).toBe(false);
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
    expect(report.comparison.find((c) => c.stepId === 's12')).toMatchObject({ tamper: 'quantity-rewrite', trusting: 'accepted', enforcing: 'rejected', finding: 'CWE-20' });
    expect(reportToMarkdown(report)).toContain('CWE-294');
    expect(reportToMarkdown(report)).toContain('CWE-20');
  });
});

describe('sixth-review regression — findings must come from client/server divergence, not the tamper label', () => {
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
    for (const id of ['s2', 's4', 's6', 's8', 's9', 's10', 's12']) expect(step(run, id).divergences.length, id).toBeGreaterThan(0);
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

describe('eighth invariant — quantity-bounds (October 2026 round)', () => {
  it('accepts catalog maxQty as an integer 1–10 000 (optional, default 99) and rejects anything else', () => {
    expect(scenario().catalog.find((c) => c.sku === 'beans-1kg')?.maxQty).toBe(5);
    expect(scenario().catalog.find((c) => c.sku === 'flat-white')?.maxQty).toBeUndefined();
    for (const bad of [0, -1, 1.5, 10_001, 'x', null]) {
      const raw = loose(); raw.catalog[0].maxQty = bad;
      const r = validateScenario(raw);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.errors.join(' '), String(bad)).toMatch(/maxQty/);
    }
    const top = loose(); top.catalog[0].maxQty = 10_000;
    expect(validateScenario(top).ok).toBe(true);
  });

  it('validates the quantity-rewrite tamper: place-order only, with an optional finite value', () => {
    expect(scenario().steps[11].tamper).toEqual({ kind: 'quantity-rewrite', value: -1 });
    const onCoupon = loose(); onCoupon.steps[2].tamper = { kind: 'quantity-rewrite' };
    const r1 = validateScenario(onCoupon);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join(' ')).toMatch(/quantity-rewrite applies to place-order only/);
    const noValue = loose(); noValue.steps[11].tamper = { kind: 'quantity-rewrite' };
    expect(accept(noValue).steps[11].tamper).toEqual({ kind: 'quantity-rewrite' });
    for (const bad of ['3', Number.POSITIVE_INFINITY, Number.NaN, 1_000_001, true]) {
      const b = loose(); b.steps[11].tamper = { kind: 'quantity-rewrite', value: bad };
      expect(validateScenario(b).ok, String(bad)).toBe(false);
    }
    const frac = loose(); frac.steps[11].tamper = { kind: 'quantity-rewrite', value: 1.5 };
    expect(validateScenario(frac).ok).toBe(true);
  });

  it('accepts client quantities outside 1–maxQty at import time (the server, not the schema, judges them) while bounding their magnitude', () => {
    const zero = loose(); zero.steps[0].client.payload.items[0].qty = 0; zero.steps[0].client.payload.total = 3.25;
    expect(validateScenario(zero).ok).toBe(true);
    const neg = loose(); neg.steps[0].client.payload.items[0].qty = -2; neg.steps[0].client.payload.total = 0;
    expect(validateScenario(neg).ok).toBe(true);
    const huge = loose(); huge.steps[0].client.payload.items[0].qty = 1_000_001;
    expect(validateScenario(huge).ok).toBe(false);
    const word = loose(); word.steps[0].client.payload.items[0].qty = 'many';
    expect(validateScenario(word).ok).toBe(false);
  });

  it('quantity-rewrite sets items[0].qty to the scripted value (default -1), recomputes the total from the client’s own unit prices and leaves the original untouched', () => {
    const s = scenario();
    const msg = { user: 'u-omar', event: 'place-order' as const, nonce: 'n', ts: s.baseTime, payload: { items: [{ sku: 'beans-1kg', qty: 1, unitPrice: 28 }, { sku: 'croissant', qty: 2, unitPrice: 3.25 }], total: 34.5 } };
    const t = applyTamper(msg, { kind: 'quantity-rewrite', value: 0 }, s, []);
    expect(t.message.payload).toMatchObject({ items: [{ sku: 'beans-1kg', qty: 0, unitPrice: 28 }, { sku: 'croissant', qty: 2, unitPrice: 3.25 }], total: 6.5 });
    expect(t.changedFields).toEqual(['items[0].qty', 'total']);
    expect(t.note).toMatch(/quantity/i);
    expect(msg.payload.items[0].qty).toBe(1);
    expect(msg.payload.total).toBe(34.5);
    const d = applyTamper(msg, { kind: 'quantity-rewrite' }, s, []);
    expect(d.message.payload).toMatchObject({ items: [{ sku: 'beans-1kg', qty: -1, unitPrice: 28 }, { sku: 'croissant', qty: 2, unitPrice: 3.25 }], total: -21.5 });
    expect(d.changedFields).toEqual(['items[0].qty', 'total']);
    const over = applyTamper(msg, { kind: 'quantity-rewrite', value: 500 }, s, []);
    expect((over.message.payload.items as { qty: number }[])[0].qty).toBe(500);
    expect((over.message.payload.items as { qty: number }[])[1].qty).toBe(2);
  });

  it('trusting server accepts the rewritten quantity, bills a negative total and raises a CWE-20 finding keyed by the quantity-bounds invariant', () => {
    const run = runScenario(scenario(), 'trusting');
    const s12 = step(run, 's12');
    expect(s12.decision).toBe('accepted');
    expect(s12.serverView.total).toBe(-28);
    expect(s12.divergences).toEqual([{ invariant: 'quantity-bounds', claimed: 'beans-1kg × -1', truth: 'beans-1kg: integer 1–5' }]);
    expect(s12.checks.find((c) => c.name === 'quantity-valid')).toMatchObject({ ran: false, passed: true });
    expect(s12.finding).toMatchObject({ kind: 'quantity-unbounded', cwe: 'CWE-20', cweName: 'Improper Input Validation', severity: 'medium' });
    expect(s12.finding?.detail).toMatch(/quantity-bounds/);
    expect(s12.fieldOrigins['items[0].qty']).toBe('client-controlled');
    expect(run.summary).toEqual({ steps: 12, accepted: 12, neutralized: 0, rejected: 0, findings: 7 });
  });

  it('enforcing server runs quantity-valid, fails it and rejects the order without creating it; valid quantities pass the check', () => {
    const run = runScenario(scenario(), 'enforcing');
    const s12 = step(run, 's12');
    expect(s12.decision).toBe('rejected');
    expect(s12.checks.find((c) => c.name === 'quantity-valid')).toMatchObject({ ran: true, passed: false });
    expect(s12.checks.find((c) => c.name === 'quantity-valid')?.detail).toMatch(/1–5/);
    expect(s12.finding).toBeUndefined();
    expect(s12.serverView.orderCreated).toBe(false);
    expect(s12.serverView.total).toBeUndefined();
    expect(s12.narrative).toMatch(/quantity-valid/);
    expect(step(run, 's11').checks.find((c) => c.name === 'quantity-valid')).toMatchObject({ ran: true, passed: true });
    expect(run.summary).toEqual({ steps: 12, accepted: 5, neutralized: 3, rejected: 4, findings: 0 });
  });

  it('flags an untampered step whose client sends qty 0 exactly like the tampered one — divergence, not label', () => {
    const raw = loose();
    raw.steps[0].client.payload.items[0].qty = 0; raw.steps[0].client.payload.total = 3.25; // total consistent with the catalog, so only the quantity diverges
    const sc = accept(raw);
    const s1 = step(runScenario(sc, 'trusting'), 's1');
    expect(s1.tamper).toBeUndefined();
    expect(s1.decision).toBe('accepted');
    expect(s1.divergences).toEqual([{ invariant: 'quantity-bounds', claimed: 'flat-white × 0', truth: 'flat-white: integer 1–99' }]);
    expect(s1.finding).toMatchObject({ kind: 'quantity-unbounded', cwe: 'CWE-20', severity: 'medium' });
    expect(s1.finding?.detail).toMatch(/No tamper annotation/);
    const tampered = step(runScenario(scenario(), 'trusting'), 's12').finding!;
    const shape = (f: typeof tampered) => [f.kind, f.cwe, f.cweName, f.title, f.severity];
    expect(shape(s1.finding!)).toEqual(shape(tampered));
    const e1 = step(runScenario(sc, 'enforcing'), 's1');
    expect(e1.decision).toBe('rejected');
    expect(e1.checks.find((c) => c.name === 'quantity-valid')?.passed).toBe(false);
    expect(e1.finding).toBeUndefined();
  });

  it('applies the per-item maxQty (default 99), accepts in-range rewrites silently, flags fractions, and lets price outrank quantity in the finding', () => {
    const within = loose(); within.steps[11].tamper = { kind: 'quantity-rewrite', value: 5 };
    const w = accept(within);
    expect(step(runScenario(w, 'trusting'), 's12').divergences).toEqual([]);
    expect(step(runScenario(w, 'trusting'), 's12').finding).toBeUndefined();
    expect(step(runScenario(w, 'enforcing'), 's12').decision).toBe('accepted');
    const over = loose(); over.steps[11].tamper = { kind: 'quantity-rewrite', value: 6 };
    const o = accept(over);
    expect(step(runScenario(o, 'trusting'), 's12').finding?.cwe).toBe('CWE-20');
    expect(step(runScenario(o, 'enforcing'), 's12').decision).toBe('rejected');
    const d99 = loose(); d99.steps[1].tamper = { kind: 'quantity-rewrite', value: 99 };
    expect(step(runScenario(accept(d99), 'trusting'), 's2').divergences).toEqual([]);
    const d100 = loose(); d100.steps[1].tamper = { kind: 'quantity-rewrite', value: 100 };
    expect(step(runScenario(accept(d100), 'trusting'), 's2').divergences).toEqual([{ invariant: 'quantity-bounds', claimed: 'flat-white × 100', truth: 'flat-white: integer 1–99' }]);
    const frac = loose(); frac.steps[1].tamper = { kind: 'quantity-rewrite', value: 1.5 };
    const f2 = step(runScenario(accept(frac), 'trusting'), 's2');
    expect(f2.divergences.map((d) => d.invariant)).toEqual(['quantity-bounds']);
    expect(f2.finding?.cwe).toBe('CWE-20');
    const both = loose(); both.steps[0].client.payload.items[0].qty = 0; // total left at 7.75: price and quantity both diverge
    const b1 = step(runScenario(accept(both), 'trusting'), 's1');
    expect(b1.divergences.map((d) => d.invariant).sort()).toEqual(['price-from-catalog', 'quantity-bounds']);
    expect(b1.finding?.cwe).toBe('CWE-602');
  });
});
