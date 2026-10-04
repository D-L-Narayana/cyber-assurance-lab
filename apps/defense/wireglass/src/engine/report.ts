import type { Alert, NormalizedEvent } from './types';
import type { RuleConfig } from './rules';
import type { TriageState } from './triage';
import type { TuningRecord } from './diff';

export interface ReportInput { events: NormalizedEvent[]; alerts: Alert[]; triage: TriageState; config: RuleConfig; generatedAt: string; tuning?: TuningRecord }

export function buildReport({ events, alerts, triage, config, generatedAt, tuning }: ReportInput) {
  const open = alerts.filter(a => triage[a.id]?.status !== 'closed').length;
  const byRule: Record<string, number> = {};
  for (const a of alerts) byRule[a.ruleId] = (byRule[a.ruleId] ?? 0) + 1;
  const byProto: Record<string, number> = {};
  for (const e of events) byProto[e.proto] = (byProto[e.proto] ?? 0) + 1;
  return {
    schema: 'wireglass.report/1',
    generatedAt,
    tool: 'Wireglass educational detection workbench',
    dataNotice: 'All events are synthetic fixtures or user-pasted text processed in the browser. No packet capture, no network access.',
    config,
    summary: { events: events.length, alerts: alerts.length, open, closed: alerts.length - open, byRule, byProto },
    alerts: alerts.map(a => ({
      id: a.id, ruleId: a.ruleId, severity: a.severity, src: a.src, dst: a.dst,
      firstTs: new Date(a.firstTs).toISOString(), lastTs: new Date(a.lastTs).toISOString(),
      eventCount: a.eventIds.length, evidence: a.evidence, explanation: a.explanation,
      triage: triage[a.id] ?? null,
    })),
    // Additive (October 2026): present only when a rule-configuration change was applied in the session.
    ...(tuning ? { tuning } : {}),
  };
}
export type Report = ReturnType<typeof buildReport>;
