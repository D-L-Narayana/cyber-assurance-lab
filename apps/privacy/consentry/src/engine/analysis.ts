import { evaluate, RULES } from './evaluate';
import type { Decision, DecisionOutcome, Workspace } from './types';

export function evaluateAll(ws: Workspace, policyOverride?: Workspace['policy']): Decision[] {
  const policy = policyOverride ?? ws.policy;
  const subjects = new Map(ws.subjects.map((s) => [s.id, s]));
  return ws.events.map((event) => {
    const subject = subjects.get(event.subjectId) ?? { id: event.subjectId, label: 'unknown subject', regime: 'unknown' as const, ageBand: 'unknown' as const, gpcSignal: false };
    return evaluate(event, { subject, purposes: ws.purposes, records: ws.records, policy });
  });
}

export interface ExpectationFailure {
  eventId: string;
  expected: DecisionOutcome;
  expectedReason?: string;
  observed: DecisionOutcome | 'missing-event';
  observedReason?: string;
}

export interface SuiteResult {
  total: number;
  passed: number;
  failed: ExpectationFailure[];
}

/** Runs the workspace's stored expectations against the current policy table. */
export function runExpectations(ws: Workspace): SuiteResult {
  const decisions = new Map(evaluateAll(ws).map((d) => [d.eventId, d]));
  const failed: ExpectationFailure[] = [];
  for (const exp of ws.expectations) {
    const d = decisions.get(exp.eventId);
    if (!d) {
      failed.push({ eventId: exp.eventId, expected: exp.expect, observed: 'missing-event', ...(exp.reasonCode ? { expectedReason: exp.reasonCode } : {}) });
      continue;
    }
    const ok = d.decision === exp.expect && (!exp.reasonCode || exp.reasonCode === d.reasonCode);
    if (!ok) failed.push({ eventId: exp.eventId, expected: exp.expect, observed: d.decision, observedReason: d.reasonCode, ...(exp.reasonCode ? { expectedReason: exp.reasonCode } : {}) });
  }
  return { total: ws.expectations.length, passed: ws.expectations.length - failed.length, failed };
}

export interface RuleCoverage {
  ruleId: string;
  title: string;
  /** Number of fixture decisions that change (decision or reason code) when this rule is disabled. */
  decisionsChanged: number;
  changedEventIds: string[];
  /** Number of fixture events on which this rule was the terminal rule. */
  terminalFor: number;
  exercised: boolean;
}

/**
 * Rule-level mutation analysis: disable one rule at a time and count decisions that change.
 * A rule that never changes any fixture decision is unexercised by the fixtures, which means the
 * fixtures could not detect a regression in it.
 */
export function ruleCoverage(ws: Workspace): RuleCoverage[] {
  const baseline = evaluateAll(ws);
  return RULES.map((rule) => {
    const mutated = evaluateAll(ws, { ...ws.policy, disabledRules: [...ws.policy.disabledRules, rule.id] });
    const changedEventIds = baseline
      .filter((d, i) => d.decision !== mutated[i]!.decision || d.reasonCode !== mutated[i]!.reasonCode)
      .map((d) => d.eventId);
    const terminalFor = baseline.filter((d) => d.ruleId === rule.id).length;
    return { ruleId: rule.id, title: rule.title, decisionsChanged: changedEventIds.length, changedEventIds, terminalFor, exercised: changedEventIds.length > 0 };
  });
}

export interface DecisionExport {
  schema: 'consentry.decisions';
  version: 1;
  generatedAt: string;
  policyId: string;
  policyVersion: number;
  disabledRules: string[];
  summary: Record<DecisionOutcome, number>;
  decisions: Decision[];
}

export function exportDecisions(ws: Workspace, decisions: Decision[], generatedAt: string): DecisionExport {
  const summary: Record<DecisionOutcome, number> = { allow: 0, deny: 0, review: 0 };
  for (const d of decisions) summary[d.decision] += 1;
  return { schema: 'consentry.decisions', version: 1, generatedAt, policyId: ws.policy.id, policyVersion: ws.policy.version, disabledRules: ws.policy.disabledRules, summary, decisions };
}
