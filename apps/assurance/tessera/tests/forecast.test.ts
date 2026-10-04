import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/engine/catalog';
import { DECISION_VALID_DAYS, buildReport, toCsv } from '../src/engine/evaluate';
import {
  DEFAULT_HORIZONS,
  MAX_HORIZONS,
  MAX_HORIZON_DAYS,
  addDays,
  buildReportWithForecast,
  degradingIds,
  forecastPack,
  forecastSummary,
  forecastToCsvRows,
  normaliseHorizons,
} from '../src/engine/forecast';
import { validatePack } from '../src/engine/validate';
import type { Decision, Evidence, EvidencePack, ForecastRow } from '../src/engine/types';

// Evidence forecast: re-evaluate every outcome at asOf + h days with the pack unchanged (no new evidence, no new
// decisions). Dates below are chosen so that each boundary lands exactly on the rule edge documented in README.
const AS_OF = '2026-10-01';
const SUB = 'PR.AA-05';
const LONG = 'Compensating manual control observed and documented in the walkthrough notes (ticket T-1).';

function ev(partial: Partial<Evidence> & { id: string }): Evidence {
  return {
    title: 'Evidence ' + partial.id,
    type: 'policy',
    subcategoryIds: [SUB],
    collectedOn: AS_OF,
    validDays: 365,
    scope: 'full',
    assertion: 'supports',
    source: 'grc.example',
    ...partial,
  };
}

function pack(evidence: Evidence[], decisions: Decision[] = []): EvidencePack {
  return {
    schema: 'tessera.pack/1',
    profile: { name: 'Forecast test profile', asOf: AS_OF, priorities: {} },
    evidence,
    decisions,
  };
}

const dec = (verdict: Decision['verdict'], rationale: string, decidedOn: string): Decision => ({ subcategoryId: SUB, reviewer: 'r.kaur', verdict, rationale, decidedOn });

function row(rows: ForecastRow[], horizonDays: number, id = SUB): ForecastRow {
  const r = rows.find((x) => x.horizonDays === horizonDays && x.subcategoryId === id);
  expect(r, `row for ${id} at +${horizonDays} days`).toBeDefined();
  return r!;
}

describe('forecast — dates and horizons', () => {
  it('addDays rolls over months, years and leap days in UTC', () => {
    expect(addDays('2026-10-01', 0)).toBe('2026-10-01');
    expect(addDays('2026-10-01', 30)).toBe('2026-10-31');
    expect(addDays('2026-10-01', 92)).toBe('2027-01-01');
    expect(addDays('2026-10-01', 180)).toBe('2027-03-30');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('sorts horizons ascending, merges duplicates and drops non-positive, fractional or non-finite values', () => {
    const n = normaliseHorizons([90, 30, 30, 0, -5, Number.NaN, 30.5, Number.POSITIVE_INFINITY]);
    expect(n.horizons).toEqual([30, 90]);
    expect(n.dropped).toHaveLength(5);
    expect(forecastPack(pack([]), [])).toEqual([]);
    expect(forecastPack(pack([]), [0, -1])).toEqual([]);
  });

  it('bounds the projection: at most MAX_HORIZONS horizons, none longer than MAX_HORIZON_DAYS', () => {
    expect(MAX_HORIZONS).toBe(12);
    expect(MAX_HORIZON_DAYS).toBe(3650);
    const many = normaliseHorizons(Array.from({ length: 20 }, (_, i) => (i + 1) * 10));
    expect(many.horizons).toEqual(Array.from({ length: 12 }, (_, i) => (i + 1) * 10));
    expect(many.dropped).toHaveLength(8);
    const far = normaliseHorizons([MAX_HORIZON_DAYS, MAX_HORIZON_DAYS + 1]);
    expect(far.horizons).toEqual([MAX_HORIZON_DAYS]);
    expect(far.dropped).toEqual([MAX_HORIZON_DAYS + 1]);
    expect(forecastPack(pack([]), Array.from({ length: 20 }, (_, i) => (i + 1) * 10))).toHaveLength(12 * 25);
  });

  it('defaults to 30/90/180 days and emits one row per subcategory per horizon, ordered by horizon then catalog order', () => {
    expect([...DEFAULT_HORIZONS]).toEqual([30, 90, 180]);
    const rows = forecastPack(pack([ev({ id: 'E1' })]));
    expect(rows).toHaveLength(75);
    expect([...new Set(rows.map((r) => r.horizonDays))]).toEqual([30, 90, 180]);
    expect(rows.slice(0, 25).map((r) => r.subcategoryId)).toEqual(CATALOG.map((s) => s.id));
    expect(rows.slice(0, 25).every((r) => r.asOf === '2026-10-31')).toBe(true);
    expect(row(rows, 180).asOf).toBe('2027-03-30');
  });
});

describe('forecast — freshness boundaries', () => {
  it('fresh → aging exactly one day after validDays: partial becomes weak with the artifact as the only driver', () => {
    const p = pack([ev({ id: 'E1', validDays: 90 })]); // collected on asOf: coverage 1 from one type → partial
    const rows = forecastPack(p, [90, 91]);
    expect(row(rows, 90)).toMatchObject({ asOf: '2026-12-30', statusNow: 'partial', statusThen: 'partial', residualNow: 1, residualThen: 1, degrades: false, drivers: [], decisionLapses: false });
    const at91 = row(rows, 91);
    expect(at91).toMatchObject({ asOf: '2026-12-31', statusNow: 'partial', statusThen: 'weak', residualNow: 1, residualThen: 1.6, bandNow: 'moderate', bandThen: 'moderate', degrades: true, decisionLapses: false });
    expect(at91.drivers).toEqual([{ evidenceId: 'E1', from: 'fresh', to: 'aging' }]);
  });

  it('aging → stale exactly one day after 1.5 × validDays: weak becomes none', () => {
    const p = pack([ev({ id: 'E1', validDays: 90, collectedOn: '2026-06-23' })]); // 100 days old: aging today
    const rows = forecastPack(p, [35, 36]);
    expect(row(rows, 35)).toMatchObject({ statusNow: 'weak', statusThen: 'weak', degrades: false, drivers: [] });
    expect(row(rows, 36)).toMatchObject({ statusNow: 'weak', statusThen: 'none', residualNow: 1.6, residualThen: 2, bandThen: 'high', degrades: true, drivers: [{ evidenceId: 'E1', from: 'aging', to: 'stale' }] });
  });

  it('a future-dated artifact (stale by rule today) is projected as current once the horizon passes its date — an improvement, never a degradation', () => {
    const p = pack([ev({ id: 'F', validDays: 90, collectedOn: '2026-11-01' })]);
    const rows = forecastPack(p, [30, 90]);
    expect(row(rows, 30)).toMatchObject({ statusNow: 'none', statusThen: 'none', degrades: false, drivers: [] });
    expect(row(rows, 90)).toMatchObject({ statusNow: 'none', statusThen: 'partial', residualNow: 2, residualThen: 1, degrades: false, drivers: [{ evidenceId: 'F', from: 'stale', to: 'fresh' }] });
  });
});

describe('forecast — decision lapse', () => {
  it('a valid override lapses exactly one day after DECISION_VALID_DAYS: sufficient reverts to the computed weak status', () => {
    const p = pack([ev({ id: 'T1', type: 'ticket', scope: 'partial', validDays: 3650 })], [dec('accepted', LONG, '2025-12-05')]); // decision is 300 days old
    const rows = forecastPack(p, [DECISION_VALID_DAYS - 300, DECISION_VALID_DAYS - 299]);
    expect(row(rows, 65)).toMatchObject({ statusNow: 'sufficient', statusThen: 'sufficient', residualNow: 0.3, residualThen: 0.3, degrades: false, decisionLapses: false, drivers: [] });
    expect(row(rows, 66)).toMatchObject({ statusNow: 'sufficient', statusThen: 'weak', residualThen: 1.6, bandNow: 'low', bandThen: 'moderate', degrades: true, decisionLapses: true, drivers: [] });
  });

  it('accepted-risk lapses to none and a not-applicable scoping lapses to the computed status', () => {
    const risk = forecastPack(pack([], [dec('accepted', LONG, AS_OF)]), [DECISION_VALID_DAYS, DECISION_VALID_DAYS + 1]);
    expect(row(risk, 365)).toMatchObject({ statusNow: 'accepted-risk', statusThen: 'accepted-risk', residualNow: 1.2, degrades: false, decisionLapses: false });
    expect(row(risk, 366)).toMatchObject({ statusThen: 'none', residualThen: 2, degrades: true, decisionLapses: true });
    const na = forecastPack(pack([], [dec('not-applicable', LONG, AS_OF)]), [366]);
    expect(row(na, 366)).toMatchObject({ statusNow: 'not-applicable', statusThen: 'none', residualNow: 0, residualThen: 2, bandNow: 'low', bandThen: 'high', degrades: true, decisionLapses: true });
  });

  it('a decision that is already stale today is not "currently applied", so it never lapses', () => {
    const mine = forecastPack(pack([], [dec('accepted', LONG, '2020-01-01')])).filter((r) => r.subcategoryId === SUB);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.statusNow === 'none' && r.statusThen === 'none' && !r.degrades && !r.decisionLapses)).toBe(true);
  });

  it('a decision dated after asOf (ignored today) starts applying once the horizon passes its date; that is a degradation, not a lapse', () => {
    const p = pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'configuration' })], [dec('gap', 'Policy not enforced.', '2027-01-01')]);
    const rows = forecastPack(p, [30, 120]);
    expect(row(rows, 30)).toMatchObject({ statusNow: 'sufficient', statusThen: 'sufficient', degrades: false, decisionLapses: false });
    expect(row(rows, 120)).toMatchObject({ statusNow: 'sufficient', statusThen: 'weak', degrades: true, decisionLapses: false, drivers: [] });
  });
});

describe('forecast — no false degradation', () => {
  it('reports no degradation, no drivers and no lapse when nothing in the pack changes within the horizons', () => {
    const p = pack([ev({ id: 'E1', validDays: 3650 }), ev({ id: 'E2', type: 'configuration', validDays: 3650 })], [dec('accepted', LONG, AS_OF)]);
    const rows = forecastPack(p);
    expect(rows).toHaveLength(75);
    expect(rows.every((r) => r.statusThen === r.statusNow && r.residualThen === r.residualNow && r.drivers.length === 0 && !r.degrades && !r.decisionLapses)).toBe(true);
    expect(row(rows, 180).statusNow).toBe('sufficient');
  });

  it('empty pack: every outcome is none now and later; nothing degrades; the summary is all zeros', () => {
    const rows = forecastPack(pack([]));
    expect(rows).toHaveLength(75);
    expect(rows.every((r) => r.statusNow === 'none' && r.statusThen === 'none' && r.residualNow === 2 && r.residualThen === 2 && !r.degrades)).toBe(true);
    const summary = forecastSummary(rows);
    expect(summary.map((s) => [s.horizonDays, s.outcomes, s.degrading, s.decisionLapses, s.topDrivers.length])).toEqual([[30, 25, 0, 0, 0], [90, 25, 0, 0, 0], [180, 25, 0, 0, 0]]);
    expect(forecastSummary([])).toEqual([]);
    expect(degradingIds(rows, 180)).toEqual([]);
  });

  it('a status change at equal exposure (contradicted → refuted) is reported but is not a degradation', () => {
    const p = pack([ev({ id: 'OK', validDays: 90, collectedOn: '2026-06-23' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })]);
    const r = row(forecastPack(p, [36]), 36);
    expect(r).toMatchObject({ statusNow: 'contradicted', statusThen: 'refuted', residualNow: 2, residualThen: 2, degrades: false, drivers: [{ evidenceId: 'OK', from: 'aging', to: 'stale' }] });
  });

  it('a refutation going stale improves the outcome; improvements are never degradations', () => {
    const p = pack([ev({ id: 'OK', validDays: 3650 }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes', validDays: 90, collectedOn: '2026-06-23' })]);
    const r = row(forecastPack(p, [36]), 36);
    expect(r).toMatchObject({ statusNow: 'contradicted', statusThen: 'partial', residualNow: 2, residualThen: 1, degrades: false, drivers: [{ evidenceId: 'BAD', from: 'aging', to: 'stale' }] });
  });
});

describe('forecast — determinism, summary and exports', () => {
  it('is deterministic and order-stable: identical packs give byte-identical rows; horizon input order does not matter', () => {
    const p = pack([ev({ id: 'E1', validDays: 90 }), ev({ id: 'E2', type: 'report', validDays: 30, subcategoryIds: ['PR.DS-01'] })]);
    expect(JSON.stringify(forecastPack(p))).toBe(JSON.stringify(forecastPack(structuredClone(p))));
    expect(JSON.stringify(forecastPack(p, [180, 30]))).toBe(JSON.stringify(forecastPack(p, [30, 180])));
    const rows = forecastPack(p);
    expect(rows).toHaveLength(75);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].horizonDays).toBeLessThanOrEqual(rows[i].horizonDays);
    expect(forecastSummary(rows)).toHaveLength(3);
    expect(JSON.stringify(forecastSummary(rows))).toBe(JSON.stringify(forecastSummary(forecastPack(structuredClone(p)))));
  });

  it('lists drivers sorted by evidence id regardless of pack order', () => {
    const p = pack([ev({ id: 'B', validDays: 90, collectedOn: '2026-06-23' }), ev({ id: 'A', type: 'configuration', validDays: 90, collectedOn: '2026-06-23' })]);
    expect(row(forecastPack(p, [36]), 36).drivers.map((d) => d.evidenceId)).toEqual(['A', 'B']);
  });

  it('summarises degrading outcomes per horizon and ranks the evidence driving them', () => {
    const p = pack([
      ev({ id: 'E1', validDays: 90, subcategoryIds: ['PR.AA-05', 'PR.DS-01', 'GV.PO-01'] }),
      ev({ id: 'E2', type: 'configuration', scope: 'partial', validDays: 90 }),
    ]);
    const rows = forecastPack(p, [30, 90, 91, 180]);
    const summary = forecastSummary(rows);
    expect(summary.map((s) => [s.horizonDays, s.asOf, s.degrading])).toEqual([[30, '2026-10-31', 0], [90, '2026-12-30', 0], [91, '2026-12-31', 3], [180, '2027-03-30', 3]]);
    expect(summary[2].topDrivers).toEqual([
      { evidenceId: 'E1', from: 'fresh', to: 'aging', outcomes: 3 },
      { evidenceId: 'E2', from: 'fresh', to: 'aging', outcomes: 1 },
    ]);
    expect(summary[3].topDrivers[0]).toEqual({ evidenceId: 'E1', from: 'fresh', to: 'stale', outcomes: 3 });
    expect(summary[0].topDrivers).toEqual([]);
  });

  it('degradingIds collects the outcomes that degrade at any horizon up to the given day, sorted', () => {
    const p = pack([ev({ id: 'E1', validDays: 90, subcategoryIds: ['PR.AA-05', 'PR.DS-01', 'GV.PO-01'] })]);
    const rows = forecastPack(p, [30, 91, 180]);
    expect(degradingIds(rows, 90)).toEqual([]);
    expect(degradingIds(rows, 91)).toEqual(['GV.PO-01', 'PR.AA-05', 'PR.DS-01']);
    expect(degradingIds(rows, 180)).toEqual(['GV.PO-01', 'PR.AA-05', 'PR.DS-01']);
  });

  it('forecast CSV rows go through the same formula-neutralising writer as the report', () => {
    const p = pack([ev({ id: '=HYPERLINK("x")', validDays: 90 })]);
    const rows = forecastPack(p, [91]);
    const csvRows = forecastToCsvRows(rows);
    expect(csvRows[0]).toEqual(['horizonDays', 'asOf', 'subcategory', 'function', 'category', 'statusNow', 'statusThen', 'residualNow', 'residualThen', 'bandNow', 'bandThen', 'degrades', 'decisionLapses', 'drivers']);
    expect(csvRows).toHaveLength(26);
    const csv = toCsv(csvRows);
    const line = csv.split('\r\n').find((l) => l.includes('"PR.AA-05"'))!;
    expect(line).toContain(`"'=HYPERLINK(""x"") fresh→aging"`);
    expect(line).toContain('"yes"');
    expect(csv.split('\r\n').every((l) => !/(^|,)"[=+\-@]/.test(l))).toBe(true);
  });

  it('buildReportWithForecast adds an additive, optional forecast block and leaves the base report byte-identical', () => {
    const p = pack([ev({ id: 'E1', validDays: 90 })]);
    const base = buildReport(p);
    expect(base.forecast).toBeUndefined();
    const withForecast = buildReportWithForecast(p, [30, 91]);
    expect(withForecast.schema).toBe('tessera.report/1');
    expect(withForecast.forecast?.horizons).toEqual([30, 91]);
    expect(withForecast.forecast?.rows).toHaveLength(50);
    expect(withForecast.forecast?.note).toMatch(/no new evidence/i);
    const rest = { ...withForecast };
    delete rest.forecast;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(base));
    expect(buildReportWithForecast(p).forecast?.horizons).toEqual([30, 90, 180]);
  });
});

describe('forecast — bundled fixture', () => {
  it('Harbourline: one outcome degrades within 30 days and five within 90 if no new evidence arrives', async () => {
    const demo = (await import('../src/fixtures/harbourline-pack.json')).default;
    const v = validatePack(JSON.stringify(demo));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const rows = forecastPack(v.pack);
    expect(degradingIds(rows, 30)).toEqual(['PR.AA-05']);
    expect(degradingIds(rows, 90)).toEqual(['GV.OC-03', 'ID.AM-01', 'PR.AA-05', 'PR.DS-01', 'PR.PS-02']);
    expect(row(rows, 30, 'PR.AA-05')).toMatchObject({ statusNow: 'sufficient', statusThen: 'partial', drivers: [{ evidenceId: 'EV-002', from: 'aging', to: 'stale' }] });
    expect(row(rows, 90, 'PR.PS-02')).toMatchObject({ statusNow: 'sufficient', statusThen: 'weak', drivers: [{ evidenceId: 'EV-007', from: 'fresh', to: 'stale' }] });
    expect(row(rows, 90, 'GV.OC-03')).toMatchObject({ statusNow: 'weak', statusThen: 'none' });
    expect(forecastSummary(rows).map((s) => s.degrading)).toEqual([1, 5, 6]);
    expect(degradingIds(rows, 180)).toEqual(['GV.OC-03', 'ID.AM-01', 'PR.AA-05', 'PR.AT-01', 'PR.DS-01', 'PR.PS-02']);
    expect(row(rows, 180, 'PR.AT-01')).toMatchObject({ statusNow: 'partial', statusThen: 'weak', residualNow: 0.5, residualThen: 0.8, bandNow: 'low', bandThen: 'moderate', degrades: true, drivers: [{ evidenceId: 'EV-018', from: 'fresh', to: 'aging' }] });
    expect(row(rows, 90, 'RS.MA-01')).toMatchObject({ statusNow: 'sufficient', statusThen: 'sufficient', residualNow: 0.3, degrades: false, drivers: [] }); // a tile without the ↓ marker
    expect(rows.every((r) => !r.decisionLapses)).toBe(true); // every valid decision in the fixture is 1–2 days old
  });

  it('Harbourline: the quarter-old acceptances lapse at the 365-day boundary, turning accepted-risk back into none', async () => {
    const demo = (await import('../src/fixtures/harbourline-pack.json')).default;
    const v = validatePack(JSON.stringify(demo));
    if (!v.ok) throw new Error('fixture invalid');
    const rows = forecastPack(v.pack, [DECISION_VALID_DAYS]);
    expect(row(rows, DECISION_VALID_DAYS, 'RC.CO-03')).toMatchObject({ statusNow: 'accepted-risk', statusThen: 'none', decisionLapses: true, degrades: true });
    expect(row(rows, DECISION_VALID_DAYS, 'GV.RM-02').decisionLapses).toBe(false); // its 2024 acceptance is already stale today
  });
});
