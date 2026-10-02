import type { Catalog, ReviewItem } from './types';
import { effectiveRetentionDays } from './retention';

const DAY_MS = 86_400_000;
export const DUE_SOON_DAYS = 30;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * Retention review calendar. Each element's review cadence comes from its schedule
 * (default 365 days when the element has only an override). Sorted: overdue first (most overdue
 * first), then never reviewed, then by days until due.
 */
export function retentionReviews(catalog: Catalog, asOf: string): ReviewItem[] {
  const systems = new Set(catalog.systems.map((s) => s.id));
  const items: ReviewItem[] = [];
  for (const el of catalog.elements) {
    if (!systems.has(el.systemId)) continue;
    const effective = effectiveRetentionDays(el, catalog.schedules);
    if (effective === undefined) continue;
    const schedule = catalog.schedules.find((s) => s.id === el.scheduleId);
    const reviewEveryDays = schedule?.reviewEveryDays ?? 365;
    if (!el.lastReviewedOn) {
      items.push({ elementId: el.id, systemId: el.systemId, effectiveRetentionDays: effective, reviewEveryDays, status: 'never-reviewed' });
      continue;
    }
    const nextReviewOn = addDays(el.lastReviewedOn, reviewEveryDays);
    const daysUntilDue = daysBetween(asOf, nextReviewOn);
    const status: ReviewItem['status'] = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= DUE_SOON_DAYS ? 'due-soon' : 'current';
    items.push({ elementId: el.id, systemId: el.systemId, effectiveRetentionDays: effective, reviewEveryDays, lastReviewedOn: el.lastReviewedOn, nextReviewOn, status, daysUntilDue });
  }
  const rank: Record<ReviewItem['status'], number> = { overdue: 0, 'never-reviewed': 1, 'due-soon': 2, current: 3 };
  return items.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0) || a.elementId.localeCompare(b.elementId));
}
