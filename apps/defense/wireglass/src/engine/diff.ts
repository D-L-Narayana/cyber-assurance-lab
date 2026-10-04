import type { Alert, NormalizedEvent } from './types';
import { runRules, type RuleConfig } from './rules';

/**
 * Tuning what-if. Alert ids are content-derived (rule id + source + matched event ids), so two rule configurations run
 * over the same events can be compared by id: an alert that keeps its evidence keeps its id, whatever the thresholds.
 */
export interface AlertDiff { removed: Alert[]; added: Alert[]; kept: Alert[] }
export interface TuningRecord { from: RuleConfig; to: RuleConfig; removed: string[]; added: string[] }

const byTime = (a: Alert, b: Alert) => a.firstTs - b.firstTs || a.id.localeCompare(b.id);

/** `removed` = in before only, `added` = in after only, `kept` = the after objects whose id also existed before. All sorted by first timestamp, then id. */
export function diffAlerts(before: Alert[], after: Alert[]): AlertDiff {
  const beforeIds = new Set(before.map(a => a.id));
  const afterIds = new Set(after.map(a => a.id));
  return {
    removed: before.filter(a => !afterIds.has(a.id)).sort(byTime),
    added: after.filter(a => !beforeIds.has(a.id)).sort(byTime),
    kept: after.filter(a => beforeIds.has(a.id)).sort(byTime),
  };
}

/** Runs both configurations over `events` and records the configs plus the removed/added alert ids (for the report's additive `tuning` field). */
export function recordTuning(events: NormalizedEvent[], from: RuleConfig, to: RuleConfig): TuningRecord {
  const d = diffAlerts(runRules(events, from), runRules(events, to));
  return { from, to, removed: d.removed.map(a => a.id), added: d.added.map(a => a.id) };
}
