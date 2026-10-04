import type { Finding, FindingKind, SuiteRun, Verdict } from './types';

/** A finding reduced to what a retest needs to know; `key` is `endpoint|kind`, stable across runs of one contract. */
export interface FindingSummary {
  key: string;
  endpoint: string;
  kind: FindingKind;
  title: string;
  owaspApi: Finding['owaspApi'];
  severity: Finding['severity'];
  evidenceCases: number;
}
/** A finding present in both runs; current values plus what the previous run recorded. */
export interface PersistedFinding extends FindingSummary {
  severityBefore: Finding['severity'];
  evidenceCasesBefore: number;
}
export interface CaseChange { caseId: string; from: Verdict; to: Verdict }
export interface RunDiffSummary {
  closed: number;
  opened: number;
  persisted: number;
  caseChanges: number;
  /** Cases present in both runs (matched by case id). */
  casesCompared: number;
  casesOnlyBefore: number;
  casesOnlyAfter: number;
  /** No finding and no case verdict differs and both runs cover the same cases. */
  identical: boolean;
}
export interface RunDiff {
  /** In the previous run, absent now. */
  closed: FindingSummary[];
  /** Absent in the previous run, present now. */
  opened: FindingSummary[];
  /** In both runs. */
  persisted: PersistedFinding[];
  /** Cases whose verdict differs, sorted by case id. */
  caseChanges: CaseChange[];
  summary: RunDiffSummary;
}

export const findingKey = (f: Pick<Finding, 'endpoint' | 'kind'>): string => `${f.endpoint}|${f.kind}`;

const summarise = (f: Finding): FindingSummary => ({
  key: findingKey(f), endpoint: f.endpoint, kind: f.kind, title: f.title, owaspApi: f.owaspApi, severity: f.severity, evidenceCases: f.evidenceCases.length,
});
// Code-unit order, not locale order, so the output is identical on every machine.
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compares two runs of the same contract. Findings are matched by `endpoint|kind`; cases by id.
 * Output lists are sorted, so the same pair of runs always yields the same diff.
 */
export function compareRuns(before: SuiteRun, after: SuiteRun): RunDiff {
  const beforeFindings = new Map(before.findings.map((f) => [findingKey(f), f]));
  const afterFindings = new Map(after.findings.map((f) => [findingKey(f), f]));

  const closed = [...beforeFindings.values()].filter((f) => !afterFindings.has(findingKey(f))).map(summarise).sort((a, b) => byString(a.key, b.key));
  const opened = [...afterFindings.values()].filter((f) => !beforeFindings.has(findingKey(f))).map(summarise).sort((a, b) => byString(a.key, b.key));
  const persisted: PersistedFinding[] = [...afterFindings.values()]
    .filter((f) => beforeFindings.has(findingKey(f)))
    .map((f) => {
      const prev = beforeFindings.get(findingKey(f))!;
      return { ...summarise(f), severityBefore: prev.severity, evidenceCasesBefore: prev.evidenceCases.length };
    })
    .sort((a, b) => byString(a.key, b.key));

  const beforeVerdicts = new Map(before.results.map((r) => [r.caseId, r.verdict]));
  const afterVerdicts = new Map(after.results.map((r) => [r.caseId, r.verdict]));
  const caseChanges: CaseChange[] = [];
  let casesCompared = 0;
  let casesOnlyBefore = 0;
  for (const [caseId, from] of beforeVerdicts) {
    const to = afterVerdicts.get(caseId);
    if (to === undefined) { casesOnlyBefore += 1; continue; }
    casesCompared += 1;
    if (from !== to) caseChanges.push({ caseId, from, to });
  }
  let casesOnlyAfter = 0;
  for (const caseId of afterVerdicts.keys()) if (!beforeVerdicts.has(caseId)) casesOnlyAfter += 1;
  caseChanges.sort((a, b) => byString(a.caseId, b.caseId));

  const summary: RunDiffSummary = {
    closed: closed.length, opened: opened.length, persisted: persisted.length, caseChanges: caseChanges.length,
    casesCompared, casesOnlyBefore, casesOnlyAfter,
    identical: closed.length === 0 && opened.length === 0 && caseChanges.length === 0 && casesOnlyBefore === 0 && casesOnlyAfter === 0,
  };
  return { closed, opened, persisted, caseChanges, summary };
}
