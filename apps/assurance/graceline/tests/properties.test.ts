import { describe, expect, it } from 'vitest';
import { POLICY } from '../src/engine/policy';
import { addDays, applyEvent, daysBetween, newException, tick } from '../src/engine/lifecycle';
import type { Exception, State } from '../src/engine/types';

// Property-style checks for `tick` over random (expiresOn, at) pairs (October 2026 round). No property-testing library:
// a seeded linear congruential generator (Numerical Recipes constants) makes every run reproduce the same 200 cases.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = lcg(20261004);
const pick = (n: number) => Math.floor(rand() * n);
const randomDate = (from: string, spanDays: number) => addDays(from, pick(spanDays));

const AS_OF = '2026-10-01';
function exc(p: Partial<Exception> = {}): Exception {
  return newException({
    id: 'EX-P',
    title: 'Legacy report server cannot receive October patches',
    policyRef: 'SEC-POL-07 §4.2 Patch timelines',
    riskLevel: 'high',
    requester: 'app.owner',
    owner: 'infra.lead',
    compensatingControls: ['Network isolation to reporting VLAN'],
    justification: 'Vendor patch breaks the reporting module; replacement platform is in procurement with go-live in December.',
    requestedOn: '2026-09-20',
    startOn: AS_OF,
    expiresOn: '2026-12-15',
    remediation: { plan: 'Migrate reports to the new platform and decommission the server.', dueOn: '2026-12-10', status: 'planned' },
    ...p,
  });
}
/** One genuinely activated record (replayed through applyEvent); each case clones it with a random expiry. */
const ACTIVE: Exception = (() => {
  let e = applyEvent(applyEvent(exc(), { type: 'submit', actor: 'app.owner' }, AS_OF), { type: 'start-review', actor: 'grc.analyst' }, AS_OF);
  e = applyEvent(e, { type: 'approve', actor: 'risk.owner', role: 'risk-owner', note: 'Accepted with isolation.' }, AS_OF);
  return applyEvent(e, { type: 'approve', actor: 'line.manager', role: 'manager', note: 'ok' }, AS_OF);
})();
const withExpiry = (i: number, expiresOn: string): Exception => ({ ...ACTIVE, id: `EX-${i}`, expiresOn });

const RANK: Partial<Record<State, number>> = { active: 0, expired: 1, escalated: 2 };
const rank = (e: Exception) => RANK[e.state] ?? -1;

// 200 cases. Two thirds draw `at`/`at2` anywhere in 2024-07-01 … 2028-06-30; one third of each lands within ±30 days of
// the expiry so the grace-window boundary (14 days) is exercised densely whatever the seed produces elsewhere.
const CASES = Array.from({ length: 200 }, (_, i) => {
  const expiresOn = randomDate('2025-01-01', 1095); // 2025-01-01 … 2027-12-31
  const at = i % 3 === 0 ? addDays(expiresOn, pick(61) - 30) : randomDate('2024-07-01', 1461);
  const at2 = i % 3 === 1 ? addDays(expiresOn, pick(61) - 30) : randomDate('2024-07-01', 1461);
  return { i, expiresOn, at, at2 };
});

describe('tick properties over 200 seeded random (expiresOn, at) pairs', () => {
  it('covers all three outcomes in the sample (sanity check on the generator)', () => {
    const outcomes = new Set(CASES.map((c) => tick(withExpiry(c.i, c.expiresOn), c.at).state));
    expect(outcomes).toEqual(new Set(['active', 'expired', 'escalated']));
  });
  it('matches the policy oracle: active until expiry, expired within the grace window, escalated after it', () => {
    for (const c of CASES) {
      const e = withExpiry(c.i, c.expiresOn);
      const expected: State = c.at > c.expiresOn ? (daysBetween(c.expiresOn, c.at) > POLICY.escalationGraceDays ? 'escalated' : 'expired') : 'active';
      expect(tick(e, c.at).state, `case ${c.i}: expiresOn ${c.expiresOn} at ${c.at}`).toBe(expected);
    }
  });
  it('is idempotent: tick(tick(e, at), at) deep-equals tick(e, at) and returns the very same object', () => {
    for (const c of CASES) {
      const once = tick(withExpiry(c.i, c.expiresOn), c.at);
      const twice = tick(once, c.at);
      expect(twice, `case ${c.i}`).toEqual(once);
      expect(twice, `case ${c.i}`).toBe(once);
    }
  });
  it('is monotone: ticking at a later date never moves a record backwards or shortens its history', () => {
    for (const c of CASES) {
      const e = withExpiry(c.i, c.expiresOn);
      const [a, b] = c.at <= c.at2 ? [c.at, c.at2] : [c.at2, c.at];
      const early = tick(e, a);
      const direct = tick(e, b);
      const chained = tick(early, b);
      expect(rank(direct), `case ${c.i}: direct ${a} → ${b}`).toBeGreaterThanOrEqual(rank(early));
      expect(rank(chained), `case ${c.i}: chained ${a} → ${b}`).toBeGreaterThanOrEqual(rank(early));
      expect(chained.history.length, `case ${c.i}`).toBeGreaterThanOrEqual(early.history.length);
    }
  });
  it('is order-independent in its final state: ticking at two dates in either order ends where a single tick at the later date ends', () => {
    for (const c of CASES) {
      const e = withExpiry(c.i, c.expiresOn);
      const ab = tick(tick(e, c.at), c.at2).state;
      const ba = tick(tick(e, c.at2), c.at).state;
      const latest = tick(e, c.at > c.at2 ? c.at : c.at2).state;
      expect(ab, `case ${c.i}: ${c.at} then ${c.at2}`).toBe(ba);
      expect(ab, `case ${c.i}`).toBe(latest);
    }
  });
  it('changes nothing but state and history, appends only system ticks dated at `at`, and returns the input untouched when nothing moves', () => {
    for (const c of CASES) {
      const e = withExpiry(c.i, c.expiresOn);
      const snapshot = JSON.stringify(e);
      const t = tick(e, c.at);
      expect(JSON.stringify(e), `case ${c.i}: input mutated`).toBe(snapshot);
      expect({ ...t, state: e.state, history: e.history }, `case ${c.i}`).toEqual(e);
      const added = t.history.slice(e.history.length);
      expect(added.length, `case ${c.i}`).toBe(rank(t) - rank(e));
      for (const h of added) expect(h, `case ${c.i}`).toMatchObject({ event: 'tick', actor: 'system', at: c.at });
      if (t.state === e.state) expect(t, `case ${c.i}`).toBe(e);
    }
  });
  it('leaves pre-approval and terminal states alone at every random date', () => {
    for (const c of CASES) {
      for (const state of ['draft', 'submitted', 'under-review', 'closed', 'rejected', 'withdrawn'] as const) {
        const e: Exception = { ...withExpiry(c.i, c.expiresOn), state };
        expect(tick(e, c.at), `case ${c.i}: ${state}`).toBe(e);
      }
    }
  });
});
