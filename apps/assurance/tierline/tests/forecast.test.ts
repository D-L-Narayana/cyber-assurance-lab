import { describe, expect, it } from 'vitest';
import { QUESTIONS } from '../src/engine/model';
import { addDays, addMonths, buildQueue, daysBetween, DEFAULT_FORECAST_DAYS, FORECAST_HORIZONS, forecastQueue, forecastToCsvRows, requirementResults, toCsv } from '../src/engine/assess';
import { validateRegister } from '../src/engine/validate';
import type { Register, Vendor } from '../src/engine/types';

// Evidence forecast (October 2026 round). forecastQueue(register, asOf, horizonDays) lists what WILL lapse within the
// horizon if nothing new is filed and no review is held: evidence credit expiring (valid → expiring → expired), active
// exceptions ending, periodic reviews falling due. Each row carries the date it lapses and the days until, sorted by
// lapse date then vendor. Items that have already lapsed belong to the live queue (buildQueue), never to the forecast.

const AS_OF = '2026-10-01';

function answers(points: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of QUESTIONS) {
    const p = points[q.id] ?? 0;
    const opt = q.options.find((o) => o.points === p);
    if (!opt) throw new Error(`no option with ${p} points on ${q.id}`);
    out[q.id] = opt.id;
  }
  return out;
}

function vendor(partial: Partial<Vendor> = {}): Vendor {
  return { id: 'V-1', name: 'Northwind Freight Analytics', service: 'Route optimisation SaaS', owner: 'ops.lead', answers: answers({}), evidence: [], exceptions: [], ...partial };
}

function register(vendors: Vendor[], asOf = AS_OF): Register {
  return { schema: 'tierline.register/1', asOf, vendors };
}

/** A tier-3 questionnaire (24-month cap) whose credit runs out exactly on `expiresOn`. */
const questionnaireExpiring = (id: string, expiresOn: string) => ({ id, type: 'questionnaire' as const, title: 'Questionnaire', issuedOn: addMonths(expiresOn, -24), validMonths: 24 });

describe('forecastQueue — evidence that will lapse', () => {
  it('lists valid and expiring evidence with the lapse date and days until, naming the item', () => {
    const calm = vendor({ evidence: [questionnaireExpiring('E1', addDays(AS_OF, 100))] });
    const soon = vendor({ id: 'V-2', name: 'Pier 9 Office Supplies', evidence: [questionnaireExpiring('E2', addDays(AS_OF, 45))] });
    expect(requirementResults(calm, 3, AS_OF)[0].state).toBe('valid');
    expect(requirementResults(soon, 3, AS_OF)[0].state).toBe('expiring');
    const f = forecastQueue(register([calm, soon]), AS_OF, 180);
    expect(f).toEqual([
      { vendorId: 'V-2', vendorName: 'Pier 9 Office Supplies', tier: 3, kind: 'evidence-lapses', detail: expect.stringContaining('questionnaire'), lapsesOn: addDays(AS_OF, 45), daysUntil: 45 },
      { vendorId: 'V-1', vendorName: 'Northwind Freight Analytics', tier: 3, kind: 'evidence-lapses', detail: expect.stringContaining('questionnaire'), lapsesOn: addDays(AS_OF, 100), daysUntil: 100 },
    ]);
    expect(f[0].detail).toContain('E2');
    expect(f[1].detail).toContain('E1');
  });
  it('includes an item lapsing exactly horizon days out and excludes one day later; today\'s expiry counts as 0 days', () => {
    const edge = vendor({ evidence: [questionnaireExpiring('E1', addDays(AS_OF, 90))] });
    expect(forecastQueue(register([edge]), AS_OF, 90).map((i) => i.daysUntil)).toEqual([90]);
    expect(forecastQueue(register([edge]), AS_OF, 89)).toEqual([]);
    const today = vendor({ evidence: [questionnaireExpiring('E0', AS_OF)] });
    expect(requirementResults(today, 3, AS_OF)[0]).toMatchObject({ state: 'expiring', daysLeft: 0, credit: 1 }); // credited through today
    expect(forecastQueue(register([today]), AS_OF, 0)).toMatchObject([{ kind: 'evidence-lapses', lapsesOn: AS_OF, daysUntil: 0 }]);
  });
  it('excludes everything that has already lapsed — those rows belong to the live queue', () => {
    const v = vendor({
      answers: answers({ q1: 4, q2: 4 }),
      lastReviewOn: '2024-01-01',
      evidence: [{ id: 'OLD', type: 'questionnaire', title: 'Q', issuedOn: '2024-01-01', validMonths: 12 }],
      exceptions: [
        { id: 'XOLD', evidenceType: 'pen-test', approvedBy: 'ciso', rationale: 'old', expiresOn: '2026-01-01' },
        { id: 'XLONG', evidenceType: 'dpa', approvedBy: 'ciso', rationale: 'runs past the policy cap', expiresOn: addDays(AS_OF, 300) },
      ],
    });
    const kinds = new Set(buildQueue(register([v])).map((i) => i.kind));
    for (const k of ['expired-evidence', 'exception-expired', 'exception-out-of-policy', 'review-overdue']) expect(kinds.has(k as never)).toBe(true);
    // the out-of-policy exception "expires" within 365 days but already earns nothing, so nothing lapses
    expect(forecastQueue(register([v]), AS_OF, 365)).toEqual([]);
  });
  it('does not forecast a lapse when a future-dated item of the same type becomes usable in time', () => {
    const v = vendor({ evidence: [questionnaireExpiring('OK', addDays(AS_OF, 45)), { id: 'NEXT', type: 'questionnaire', title: 'Q', issuedOn: addDays(AS_OF, 20), validMonths: 24 }] });
    expect(requirementResults(v, 3, AS_OF)[0]).toMatchObject({ state: 'expiring', evidenceId: 'OK' });
    expect(forecastQueue(register([v]), AS_OF, 180)).toEqual([]);
    expect(forecastQueue(register([vendor({ evidence: [questionnaireExpiring('OK', addDays(AS_OF, 45))] })]), AS_OF, 180).length).toBe(1);
  });
});

describe('forecastQueue — exceptions and reviews', () => {
  it('forecasts active exceptions that end and periodic reviews that fall due, sorted by lapse date', () => {
    const v = vendor({ answers: answers({ q1: 4, q2: 4 }), lastReviewOn: '2026-02-10', exceptions: [{ id: 'X1', evidenceType: 'dpa', approvedBy: 'legal', rationale: 'DPA in negotiation', expiresOn: '2026-12-15' }] });
    const f = forecastQueue(register([v]), AS_OF, 180);
    expect(f.map((i) => [i.kind, i.lapsesOn, i.daysUntil, i.tier])).toEqual([
      ['exception-expires', '2026-12-15', 75, 1],
      ['review-due', '2027-02-10', 132, 1],
    ]);
    expect(f[0].detail).toContain('X1');
    expect(f[1].detail).toMatch(/review/i);
    expect(forecastQueue(register([v]), AS_OF, 100).map((i) => i.kind)).toEqual(['exception-expires']);
    // neither is in the live queue yet: 75 days is outside the 60-day expiring window and the review is not due soon
    const kinds = new Set(buildQueue(register([v])).map((i) => i.kind));
    expect(kinds.has('exception-expiring')).toBe(false);
    expect(kinds.has('review-due-soon')).toBe(false);
  });
  it('moving the assessment date past a forecast lapse moves the item into the live queue and out of the forecast', () => {
    const v = vendor({ evidence: [questionnaireExpiring('E1', addDays(AS_OF, 30))] });
    const [item] = forecastQueue(register([v]), AS_OF, 90);
    expect(item.lapsesOn).toBe(addDays(AS_OF, 30));
    const later = addDays(item.lapsesOn, 1);
    expect(forecastQueue(register([v], later), later, 90)).toEqual([]);
    expect(buildQueue(register([v], later)).some((q) => q.kind === 'expired-evidence' && /E1/.test(q.detail))).toBe(true);
    // the forecast assesses at the asOf argument, not at the register's own asOf
    expect(forecastQueue(register([v], '2020-01-01'), AS_OF, 90)).toEqual(forecastQueue(register([v]), AS_OF, 90));
  });
});

describe('forecastQueue — ordering, defaults, determinism, CSV', () => {
  it('sorts by lapse date, then vendor name, and is deterministic regardless of input order', () => {
    const zeta = vendor({ id: 'Z', name: 'Zeta Logistics', evidence: [questionnaireExpiring('EZ', addDays(AS_OF, 30))] });
    const alpha = vendor({ id: 'A', name: 'Alpha Snacks', evidence: [questionnaireExpiring('EA', addDays(AS_OF, 30))], lastReviewOn: addMonths(addDays(AS_OF, 10), -36) });
    const f = forecastQueue(register([zeta, alpha]), AS_OF, 90);
    expect(f.map((i) => `${i.lapsesOn} ${i.vendorName} ${i.kind}`)).toEqual([
      `${addDays(AS_OF, 10)} Alpha Snacks review-due`,
      `${addDays(AS_OF, 30)} Alpha Snacks evidence-lapses`,
      `${addDays(AS_OF, 30)} Zeta Logistics evidence-lapses`,
    ]);
    expect(JSON.stringify(forecastQueue(register([alpha, zeta]), AS_OF, 90))).toBe(JSON.stringify(f));
    expect(JSON.stringify(forecastQueue(structuredClone(register([zeta, alpha])), AS_OF, 90))).toBe(JSON.stringify(f));
  });
  it('defaults to a 180-day horizon, offers 90/180/365, and tolerates a bad horizon value', () => {
    expect(DEFAULT_FORECAST_DAYS).toBe(180);
    expect([...FORECAST_HORIZONS]).toEqual([90, 180, 365]);
    const inside = vendor({ id: 'IN', name: 'Inside', evidence: [questionnaireExpiring('E1', addDays(AS_OF, 180))] });
    const outside = vendor({ id: 'OUT', name: 'Outside', evidence: [questionnaireExpiring('E2', addDays(AS_OF, 181))] });
    const r = register([inside, outside]);
    expect(forecastQueue(r, AS_OF).map((i) => i.vendorId)).toEqual(['IN']);
    expect(forecastQueue(r, AS_OF, 365).map((i) => i.vendorId)).toEqual(['IN', 'OUT']);
    expect(forecastQueue(r, AS_OF, Number.NaN)).toEqual(forecastQueue(r, AS_OF, 180));
    expect(forecastQueue(r, AS_OF, -1)).toEqual(forecastQueue(r, AS_OF, 180));
    expect(forecastQueue(r, AS_OF, 180.9).map((i) => i.vendorId)).toEqual(['IN']);
  });
  it('exports a formula-safe CSV through the shared writer', () => {
    const v = vendor({ name: '=HYPERLINK("x")', evidence: [questionnaireExpiring('E1', addDays(AS_OF, 30))] });
    const items = forecastQueue(register([v]), AS_OF, 90);
    const lines = toCsv(forecastToCsvRows(items)).split('\r\n');
    expect(lines[0]).toBe('"vendorId","vendor","tier","kind","detail","lapsesOn","daysUntil"');
    expect(lines.length).toBe(items.length + 1);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"evidence-lapses"');
    expect(lines[1]).toContain(`"${addDays(AS_OF, 30)}"`);
  });
});

describe('forecastQueue — bundled fixture', () => {
  it('produces at least one row of every kind within 180 days, all in range, sorted, and never loses rows when the horizon widens', async () => {
    const demo = (await import('../src/fixtures/harbourline-register.json')).default;
    const r = validateRegister(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = forecastQueue(r.register, r.register.asOf, 180);
    expect(new Set(f.map((i) => i.kind))).toEqual(new Set(['evidence-lapses', 'exception-expires', 'review-due']));
    for (const i of f) {
      expect(i.daysUntil).toBeGreaterThanOrEqual(0);
      expect(i.daysUntil).toBeLessThanOrEqual(180);
      expect(daysBetween(r.register.asOf, i.lapsesOn)).toBe(i.daysUntil);
    }
    expect(f).toEqual([...f].sort((a, b) => a.lapsesOn.localeCompare(b.lapsesOn) || a.vendorName.localeCompare(b.vendorName)));
    const wide = forecastQueue(r.register, r.register.asOf, 365);
    for (const i of f) expect(wide).toContainEqual(i);
    expect(wide.length).toBeGreaterThanOrEqual(f.length);
  });
});
