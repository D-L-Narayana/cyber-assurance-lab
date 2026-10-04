// Tierline decision engine: scoring, tiering, sensitivity, evidence coverage, cadence and queue. Pure.
import { COVERAGE_RELIEF, EXCEPTION_CREDIT, EXPIRING_WINDOW_DAYS, MAX_EXCEPTION_DAYS, HARD_TRIGGERS, QUESTIONS, REQUIREMENTS, REVIEW_MONTHS, TIER_THRESHOLDS, TIER_WEIGHT } from './model';
import type { Flip, ForecastItem, ForecastKind, QueueItem, QueueKind, Register, Requirement, RequirementResult, Tier, Vendor, VendorAssessment } from './types';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

/** Add calendar months, clamping to the last day of the target month. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/** Points per question; unanswered questions are scored at the maximum (conservative) and reported. */
export function pointsFor(answers: Record<string, string>): { points: Record<string, number>; unanswered: string[] } {
  const points: Record<string, number> = {};
  const unanswered: string[] = [];
  for (const q of QUESTIONS) {
    const opt = q.options.find((o) => o.id === answers[q.id]);
    if (!opt) {
      unanswered.push(q.id);
      points[q.id] = 4;
    } else points[q.id] = opt.points;
  }
  return { points, unanswered };
}

export function inherentScore(answers: Record<string, string>): VendorAssessment['contributions'] extends infer C ? { score: number; contributions: C; unanswered: string[] } : never {
  const { points, unanswered } = pointsFor(answers);
  const contributions = QUESTIONS.map((q) => ({
    questionId: q.id,
    dimension: q.dimension,
    points: points[q.id],
    weight: q.weight,
    contribution: r2((q.weight * points[q.id]) / 4),
  }));
  const score = r2(contributions.reduce((a, c) => a + c.contribution, 0));
  return { score, contributions, unanswered };
}

export function tierFor(score: number, hardTriggerTiers: Tier[]): { tier: Tier; reasons: string[] } {
  const reasons: string[] = [];
  let tier: Tier = score >= TIER_THRESHOLDS.tier1 ? 1 : score >= TIER_THRESHOLDS.tier2 ? 2 : 3;
  reasons.push(`Inherent score ${score} → tier ${tier} (tier 1 ≥ ${TIER_THRESHOLDS.tier1}, tier 2 ≥ ${TIER_THRESHOLDS.tier2}).`);
  for (const t of hardTriggerTiers) {
    if (t < tier) {
      reasons.push(`Hard trigger raises tier ${tier} → ${t}.`);
      tier = t;
    }
  }
  return { tier, reasons };
}

function evaluate(answers: Record<string, string>): { score: number; tier: Tier; triggers: string[]; reasons: string[]; contributions: VendorAssessment['contributions']; unanswered: string[]; hardTiers: Tier[] } {
  const { score, contributions, unanswered } = inherentScore(answers);
  const { points } = pointsFor(answers);
  const fired = HARD_TRIGGERS.filter((h) => h.when(points));
  const hardTiers = fired.map((h) => h.tier);
  const { tier, reasons } = tierFor(score, hardTiers);
  if (unanswered.length) reasons.push(`Unanswered question(s) ${unanswered.join(', ')} scored at maximum until answered.`);
  return { score, tier, triggers: fired.map((h) => h.text), reasons, contributions, unanswered, hardTiers };
}

/** Every single-answer change that moves the tier. */
export function sensitivity(answers: Record<string, string>): Flip[] {
  const base = evaluate(answers);
  const flips: Flip[] = [];
  for (const q of QUESTIONS) {
    const current = answers[q.id];
    for (const opt of q.options) {
      if (opt.id === current) continue;
      const alt = evaluate({ ...answers, [q.id]: opt.id });
      if (alt.tier !== base.tier) {
        flips.push({
          questionId: q.id,
          fromOptionId: current ?? '(unanswered)',
          toOptionId: opt.id,
          newTier: alt.tier,
          direction: alt.tier < base.tier ? 'up' : 'down',
          deltaScore: r2(alt.score - base.score),
        });
      }
    }
  }
  // Nearest flips first, by absolute score change
  return flips.sort((a, b) => Math.abs(a.deltaScore) - Math.abs(b.deltaScore) || a.questionId.localeCompare(b.questionId) || a.toOptionId.localeCompare(b.toOptionId));
}

/** One requirement's state for a vendor on a given date: newest usable item wins; the requirement's validity caps the item's. */
function requirementResult(vendor: Vendor, req: Requirement, asOf: string): RequirementResult {
  const items = vendor.evidence.filter((e) => e.type === req.type).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  // Evidence dated after the assessment date cannot be relied on (data-entry error or not yet issued).
  const future = items.filter((e) => e.issuedOn > asOf);
  const usable = items.filter((e) => e.issuedOn <= asOf);
  const newest = usable[0];
  if (newest) {
    const months = Math.min(newest.validMonths, req.validMonths);
    const expiresOn = addMonths(newest.issuedOn, months);
    const daysLeft = daysBetween(asOf, expiresOn);
    if (daysLeft >= 0) {
      return { type: req.type, state: daysLeft <= EXPIRING_WINDOW_DAYS ? 'expiring' : 'valid', evidenceId: newest.id, expiresOn, daysLeft, credit: 1 };
    }
    const exc = exceptionResult(vendor, req.type, asOf);
    if (exc) return exc;
    return { type: req.type, state: 'expired', evidenceId: newest.id, expiresOn, daysLeft, credit: 0 };
  }
  const exc = exceptionResult(vendor, req.type, asOf);
  if (exc) return exc;
  if (future.length) return { type: req.type, state: 'future-dated', evidenceId: future[future.length - 1].id, expiresOn: future[future.length - 1].issuedOn, daysLeft: daysBetween(asOf, future[future.length - 1].issuedOn), credit: 0 };
  const expiredExc = vendor.exceptions.filter((x) => x.evidenceType === req.type).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
  if (expiredExc) return { type: req.type, state: 'exception-expired', exceptionId: expiredExc.id, expiresOn: expiredExc.expiresOn, daysLeft: daysBetween(asOf, expiredExc.expiresOn), credit: 0 };
  return { type: req.type, state: 'missing', credit: 0 };
}

export function requirementResults(vendor: Vendor, tier: Tier, asOf: string): RequirementResult[] {
  return REQUIREMENTS[tier].map((req) => requirementResult(vendor, req, asOf));
}

/** Active exception → half credit; an exception running past the policy cap → no credit, reported. */
function exceptionResult(vendor: Vendor, type: RequirementResult['type'], asOf: string): RequirementResult | null {
  const active = vendor.exceptions.filter((x) => x.evidenceType === type && x.expiresOn >= asOf).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  if (!active.length) return null;
  const inPolicy = active.find((x) => daysBetween(asOf, x.expiresOn) <= MAX_EXCEPTION_DAYS);
  if (inPolicy) return { type, state: 'exception', exceptionId: inPolicy.id, expiresOn: inPolicy.expiresOn, daysLeft: daysBetween(asOf, inPolicy.expiresOn), credit: EXCEPTION_CREDIT };
  const longest = active[active.length - 1];
  return { type, state: 'exception-out-of-policy', exceptionId: longest.id, expiresOn: longest.expiresOn, daysLeft: daysBetween(asOf, longest.expiresOn), credit: 0 };
}

export function assessVendor(vendor: Vendor, asOf: string): VendorAssessment {
  const ev = evaluate(vendor.answers);
  const requirements = requirementResults(vendor, ev.tier, asOf);
  const coverage = requirements.length ? r2(requirements.reduce((a, r) => a + r.credit, 0) / requirements.length) : 1;
  const residual = r1(ev.score * (1 - COVERAGE_RELIEF * coverage));
  const reviewDueOn = vendor.lastReviewOn ? addMonths(vendor.lastReviewOn, REVIEW_MONTHS[ev.tier]) : null;
  const reviewOverdue = reviewDueOn ? reviewDueOn < asOf : true;
  const hardTriggered = ev.hardTiers.some((t) => t <= ev.tier);
  const nextUp = ev.tier === 1 ? null : ev.tier === 2 ? TIER_THRESHOLDS.tier1 : TIER_THRESHOLDS.tier2;
  const downAt = ev.tier === 3 || hardTriggered ? null : ev.tier === 1 ? TIER_THRESHOLDS.tier1 : TIER_THRESHOLDS.tier2;
  return {
    vendorId: vendor.id,
    inherent: ev.score,
    tier: ev.tier,
    tierReasons: ev.reasons,
    hardTriggers: ev.triggers,
    contributions: ev.contributions,
    distanceToNextTierUp: nextUp === null ? null : r2(nextUp - ev.score),
    distanceToTierDown: downAt === null ? null : r2(ev.score - downAt),
    flips: sensitivity(vendor.answers),
    requirements,
    coverage,
    residual,
    reviewDueOn,
    reviewOverdue,
    unanswered: ev.unanswered,
  };
}

const URGENCY: Record<QueueKind, number> = {
  'missing-evidence': 3,
  'expired-evidence': 3,
  'exception-expired': 3,
  'exception-out-of-policy': 3,
  'future-dated-evidence': 3,
  'review-overdue': 3,
  'incomplete-questionnaire': 3,
  'tier-drift': 2,
  'expiring-evidence': 2,
  'exception-expiring': 2,
  'review-due-soon': 1,
};

export function buildQueue(register: Register): QueueItem[] {
  const asOf = register.asOf;
  const items: QueueItem[] = [];
  const push = (v: Vendor, tier: Tier, kind: QueueKind, detail: string, dueOn: string | null) => {
    const daysOverdue = dueOn ? daysBetween(dueOn, asOf) : 0;
    const priority = r2(TIER_WEIGHT[tier] * URGENCY[kind] + Math.min(Math.max(daysOverdue, 0) / 30, 6));
    items.push({ vendorId: v.id, vendorName: v.name, tier, kind, detail, dueOn, daysOverdue, priority });
  };
  for (const v of register.vendors) {
    const a = assessVendor(v, asOf);
    if (a.unanswered.length) push(v, a.tier, 'incomplete-questionnaire', `Unanswered: ${a.unanswered.join(', ')} (scored at maximum).`, null);
    if (v.recordedTier !== undefined && v.recordedTier !== a.tier) push(v, a.tier, 'tier-drift', `Recorded tier ${v.recordedTier} differs from computed tier ${a.tier}.`, null);
    for (const r of a.requirements) {
      switch (r.state) {
        case 'missing': push(v, a.tier, 'missing-evidence', `${r.type} required for tier ${a.tier} but not on file.`, null); break;
        case 'expired': push(v, a.tier, 'expired-evidence', `${r.type} (${r.evidenceId}) expired ${r.expiresOn}.`, r.expiresOn!); break;
        case 'expiring': push(v, a.tier, 'expiring-evidence', `${r.type} (${r.evidenceId}) expires ${r.expiresOn} (${r.daysLeft} days).`, r.expiresOn!); break;
        case 'future-dated': push(v, a.tier, 'future-dated-evidence', `${r.type} (${r.evidenceId}) is dated ${r.expiresOn}, after the assessment date — no credit until corrected or the date arrives.`, null); break;
        case 'exception-out-of-policy': push(v, a.tier, 'exception-out-of-policy', `Exception ${r.exceptionId} for ${r.type} runs to ${r.expiresOn} (${r.daysLeft} days), beyond the ${MAX_EXCEPTION_DAYS}-day cap — no credit.`, null); break;
        case 'exception-expired': push(v, a.tier, 'exception-expired', `Exception ${r.exceptionId} for ${r.type} expired ${r.expiresOn}; evidence still missing.`, r.expiresOn!); break;
        case 'exception':
          if ((r.daysLeft ?? 0) <= EXPIRING_WINDOW_DAYS) push(v, a.tier, 'exception-expiring', `Exception ${r.exceptionId} for ${r.type} expires ${r.expiresOn}.`, r.expiresOn!);
          break;
        default:
          break;
      }
    }
    if (a.reviewOverdue) push(v, a.tier, 'review-overdue', a.reviewDueOn ? `Periodic review was due ${a.reviewDueOn}.` : 'No periodic review recorded.', a.reviewDueOn);
    else if (a.reviewDueOn && daysBetween(asOf, a.reviewDueOn) <= EXPIRING_WINDOW_DAYS) push(v, a.tier, 'review-due-soon', `Periodic review due ${a.reviewDueOn}.`, a.reviewDueOn);
  }
  return items.sort((x, y) => y.priority - x.priority || x.vendorName.localeCompare(y.vendorName) || x.kind.localeCompare(y.kind));
}

// ---- Forecast (October 2026 round) ----

export const DEFAULT_FORECAST_DAYS = 180;
export const FORECAST_HORIZONS: readonly number[] = [90, 180, 365];

/**
 * Dates on which a requirement's state can change: evidence becomes usable (its issuedOn) or its credit ends (expiry + 1);
 * an exception ends (expiresOn + 1) or comes within the policy cap (expiresOn − MAX_EXCEPTION_DAYS). Every date comparison
 * in `requirementResult` flips on one of these, so the state is constant between them and walking them is an exact
 * simulation with no per-day cost (≤ 2 dates per evidence item + 2 per exception, both capped by the validator).
 */
function changeDates(vendor: Vendor, req: Requirement): string[] {
  const dates = new Set<string>();
  for (const e of vendor.evidence) {
    if (e.type !== req.type) continue;
    dates.add(e.issuedOn);
    dates.add(addDays(addMonths(e.issuedOn, Math.min(e.validMonths, req.validMonths)), 1));
  }
  for (const x of vendor.exceptions) {
    if (x.evidenceType !== req.type) continue;
    dates.add(addDays(x.expiresOn, 1));
    dates.add(addDays(x.expiresOn, -MAX_EXCEPTION_DAYS));
  }
  return [...dates].sort();
}

const FORECAST_ORDER: Record<ForecastKind, number> = { 'evidence-lapses': 0, 'exception-expires': 1, 'review-due': 2 };

/**
 * What will lapse within `horizonDays` of `asOf` if nothing new is filed and no review is held: for every requirement that
 * earns credit on `asOf`, the first date on which that credit falls below today's level (evidence credit ending → kind
 * `evidence-lapses`; an active exception ending → `exception-expires`), plus periodic reviews falling due (`review-due`).
 * Items that have already lapsed belong to the live queue (`buildQueue`) and never appear here; items the live queue
 * already flags as expiring / due soon do appear, with their date. `lapsesOn` is the last credited day (or the review due
 * date) and `daysUntil` counts from `asOf`; both are inclusive of the horizon. The forecast uses the `asOf` argument, not
 * `register.asOf`. Sorted by lapsesOn, then vendor name, then kind (deterministic for any input order). A non-finite or
 * negative horizon falls back to DEFAULT_FORECAST_DAYS; fractions are floored.
 */
export function forecastQueue(register: Register, asOf: string, horizonDays: number = DEFAULT_FORECAST_DAYS): ForecastItem[] {
  const horizon = Number.isFinite(horizonDays) && horizonDays >= 0 ? Math.floor(horizonDays) : DEFAULT_FORECAST_DAYS;
  const end = addDays(asOf, horizon);
  const items: ForecastItem[] = [];
  for (const v of register.vendors) {
    const a = assessVendor(v, asOf);
    const push = (kind: ForecastKind, detail: string, lapsesOn: string) => items.push({ vendorId: v.id, vendorName: v.name, tier: a.tier, kind, detail, lapsesOn, daysUntil: daysBetween(asOf, lapsesOn) });
    for (const req of REQUIREMENTS[a.tier]) {
      const now = requirementResult(v, req, asOf);
      if (now.credit <= 0) continue; // nothing is held today, so nothing can lapse; the live queue already lists it
      for (const d of changeDates(v, req)) {
        if (d <= asOf) continue;
        const lapsesOn = addDays(d, -1);
        if (lapsesOn > end) break;
        const then = requirementResult(v, req, d);
        if (then.credit >= now.credit) continue;
        const before = lapsesOn === asOf ? now : requirementResult(v, req, lapsesOn);
        const after = then.state === 'exception' ? `exception ${then.exceptionId} (half credit)` : then.state;
        if (before.state === 'exception') push('exception-expires', `Exception ${before.exceptionId} for ${req.type} ends ${lapsesOn}; from ${d} the requirement is ${after}.`, lapsesOn);
        else push('evidence-lapses', `${req.type} (${before.evidenceId}) is credited through ${lapsesOn}; from ${d} the requirement is ${after}.`, lapsesOn);
        break;
      }
    }
    if (a.reviewDueOn && !a.reviewOverdue && a.reviewDueOn <= end) {
      push('review-due', `Periodic review due ${a.reviewDueOn} (${REVIEW_MONTHS[a.tier]}-month cadence for tier ${a.tier}; last review ${v.lastReviewOn}).`, a.reviewDueOn);
    }
  }
  return items.sort((x, y) => x.lapsesOn.localeCompare(y.lapsesOn) || x.vendorName.localeCompare(y.vendorName) || FORECAST_ORDER[x.kind] - FORECAST_ORDER[y.kind] || x.detail.localeCompare(y.detail));
}

export function forecastToCsvRows(items: ForecastItem[]): (string | number)[][] {
  return [
    ['vendorId', 'vendor', 'tier', 'kind', 'detail', 'lapsesOn', 'daysUntil'],
    ...items.map((i) => [i.vendorId, i.vendorName, i.tier, i.kind, i.detail, i.lapsesOn, i.daysUntil]),
  ];
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = String(v);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function queueToCsvRows(queue: QueueItem[]): (string | number)[][] {
  return [
    ['vendorId', 'vendor', 'tier', 'kind', 'detail', 'dueOn', 'daysOverdue', 'priority'],
    ...queue.map((q) => [q.vendorId, q.vendorName, q.tier, q.kind, q.detail, q.dueOn ?? '', q.daysOverdue, q.priority]),
  ];
}

export const SCORING_NOTE =
  'Weights, thresholds, hard triggers, evidence requirements, cadences, the residual formula and the exception rules (half credit; no credit beyond ' + MAX_EXCEPTION_DAYS + ' days from the assessment date; evidence dated after the assessment date earns nothing) are a custom educational heuristic defined in this project; they are not a published standard or a regulatory classification.';
