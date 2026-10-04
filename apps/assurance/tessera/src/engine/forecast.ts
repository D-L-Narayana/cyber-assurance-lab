// Tessera evidence forecast. Pure, deterministic, no DOM access.
// Re-evaluates every outcome at profile.asOf + h days with the pack otherwise unchanged: no new evidence, no
// re-collection and no new reviewer decisions. Every difference therefore comes from the freshness and decision-age
// rules in evaluate.ts; the forecast adds no rules of its own and is not a prediction of what the team will do.
import { CATALOG } from './catalog';
import { DECISION_VALID_DAYS, buildReport, evaluateSubcategory } from './evaluate';
import type {
  EvidencePack,
  ForecastDriver,
  ForecastDriverCount,
  ForecastRow,
  ForecastSummaryEntry,
  Report,
  SubcategoryResult,
} from './types';

const DAY = 86_400_000;

export const DEFAULT_HORIZONS: readonly number[] = [30, 90, 180];
/** Budget: a projection evaluates at most this many horizons (25 outcomes each) … */
export const MAX_HORIZONS = 12;
/** … none further out than ten years (matches the validDays cap). Out-of-budget horizons are reported as `dropped`. */
export const MAX_HORIZON_DAYS = 3650;
export const MAX_TOP_DRIVERS = 10;

export const FORECAST_NOTE =
  'Projection only: each outcome is re-evaluated at asOf + horizon days assuming no new evidence, no re-collection and no new reviewer decisions, using the same freshness (validDays / 1.5×validDays) and decision-age (365 days) rules as the current view. Evidence or decisions dated after asOf start counting once the horizon passes their date. Educational heuristic, not a prediction.';

/** ISO date + whole days, computed in UTC so month, year and leap-day rollovers are exact. */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Positive whole-day horizons within budget, de-duplicated and ascending; everything else goes to `dropped`. */
export function normaliseHorizons(input: readonly number[]): { horizons: number[]; dropped: number[] } {
  const dropped: number[] = [];
  const keep = new Set<number>();
  for (const h of input) {
    if (Number.isInteger(h) && h > 0 && h <= MAX_HORIZON_DAYS) keep.add(h);
    else dropped.push(h);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  dropped.push(...sorted.slice(MAX_HORIZONS));
  return { horizons: sorted.slice(0, MAX_HORIZONS), dropped };
}

/** True when the recorded decision is inside its validity window at the result's evaluation date. */
function decisionInWindow(r: SubcategoryResult): boolean {
  return r.decisionAgeDays !== undefined && r.decisionAgeDays >= 0 && r.decisionAgeDays <= DECISION_VALID_DAYS;
}

function driversBetween(now: SubcategoryResult, then: SubcategoryResult): ForecastDriver[] {
  const later = new Map(then.evidence.map((e) => [e.evidenceId, e.freshness]));
  const out: ForecastDriver[] = [];
  for (const e of now.evidence) {
    const to = later.get(e.evidenceId);
    if (to !== undefined && to !== e.freshness) out.push({ evidenceId: e.evidenceId, from: e.freshness, to });
  }
  return out.sort((a, b) => cmp(a.evidenceId, b.evidenceId));
}

/**
 * One row per catalog subcategory per horizon (horizons ascending, catalog order within a horizon), including the
 * rows that do not change, so consumers can filter or count however they need. `degrades` means the residual
 * exposure is higher at the horizon than today — the status moved to a higher-exposure class, so the band can only
 * stay or worsen. Equal-exposure changes (contradicted → refuted) and improvements are reported but not degradations.
 */
export function forecastPack(pack: EvidencePack, horizonsDays: readonly number[] = DEFAULT_HORIZONS): ForecastRow[] {
  const { horizons } = normaliseHorizons(horizonsDays);
  if (horizons.length === 0) return [];
  const now = CATALOG.map((s) => evaluateSubcategory(s.id, pack));
  const rows: ForecastRow[] = [];
  for (const horizonDays of horizons) {
    const asOf = addDays(pack.profile.asOf, horizonDays);
    const projected: EvidencePack = { ...pack, profile: { ...pack.profile, asOf } };
    now.forEach((a, i) => {
      const b = evaluateSubcategory(CATALOG[i].id, projected);
      rows.push({
        horizonDays,
        asOf,
        subcategoryId: a.subcategoryId,
        statusNow: a.status,
        statusThen: b.status,
        residualNow: a.residual,
        residualThen: b.residual,
        bandNow: a.band,
        bandThen: b.band,
        degrades: b.residual > a.residual,
        drivers: driversBetween(a, b),
        decisionLapses: decisionInWindow(a) && !decisionInWindow(b),
      });
    });
  }
  return rows;
}

/** Per horizon: how many outcomes degrade, how many decisions lapse, and which freshness transitions drive the degradations. */
export function forecastSummary(rows: ForecastRow[]): ForecastSummaryEntry[] {
  const byHorizon = new Map<number, ForecastRow[]>();
  for (const r of rows) byHorizon.set(r.horizonDays, [...(byHorizon.get(r.horizonDays) ?? []), r]);
  return [...byHorizon.keys()]
    .sort((a, b) => a - b)
    .map((horizonDays) => {
      const list = byHorizon.get(horizonDays)!;
      const degrading = list.filter((r) => r.degrades);
      const counts = new Map<string, ForecastDriverCount>();
      for (const r of degrading) {
        for (const d of r.drivers) {
          const key = `${d.evidenceId}\u0000${d.from}\u0000${d.to}`;
          const c = counts.get(key) ?? { evidenceId: d.evidenceId, from: d.from, to: d.to, outcomes: 0 };
          c.outcomes += 1;
          counts.set(key, c);
        }
      }
      const topDrivers = [...counts.values()]
        .sort((a, b) => b.outcomes - a.outcomes || cmp(a.evidenceId, b.evidenceId) || cmp(a.from, b.from) || cmp(a.to, b.to))
        .slice(0, MAX_TOP_DRIVERS);
      return {
        horizonDays,
        asOf: list[0].asOf,
        outcomes: list.length,
        degrading: degrading.length,
        decisionLapses: list.filter((r) => r.decisionLapses).length,
        topDrivers,
      };
    });
}

/** Sorted ids of outcomes that degrade at any horizon up to and including `maxHorizonDays` (used for the mosaic marker). */
export function degradingIds(rows: ForecastRow[], maxHorizonDays: number): string[] {
  const ids = new Set<string>();
  for (const r of rows) if (r.degrades && r.horizonDays <= maxHorizonDays) ids.add(r.subcategoryId);
  return [...ids].sort(cmp);
}

/** Rows for `toCsv` (same formula-neutralising writer as the report CSV). */
export function forecastToCsvRows(rows: ForecastRow[]): (string | number)[][] {
  const out: (string | number)[][] = [
    ['horizonDays', 'asOf', 'subcategory', 'function', 'category', 'statusNow', 'statusThen', 'residualNow', 'residualThen', 'bandNow', 'bandThen', 'degrades', 'decisionLapses', 'drivers'],
  ];
  for (const r of rows) {
    const s = CATALOG.find((c) => c.id === r.subcategoryId);
    out.push([
      r.horizonDays,
      r.asOf,
      r.subcategoryId,
      s?.functionName ?? '',
      s?.categoryName ?? '',
      r.statusNow,
      r.statusThen,
      r.residualNow,
      r.residualThen,
      r.bandNow,
      r.bandThen,
      r.degrades ? 'yes' : 'no',
      r.decisionLapses ? 'yes' : 'no',
      r.drivers.map((d) => `${d.evidenceId} ${d.from}→${d.to}`).join('; '),
    ]);
  }
  return out;
}

/** The ordinary `tessera.report/1` plus the additive, optional `forecast` block (schema id unchanged). */
export function buildReportWithForecast(pack: EvidencePack, horizonsDays: readonly number[] = DEFAULT_HORIZONS): Report {
  const { horizons } = normaliseHorizons(horizonsDays);
  return { ...buildReport(pack), forecast: { horizons, rows: forecastPack(pack, horizons), note: FORECAST_NOTE } };
}
