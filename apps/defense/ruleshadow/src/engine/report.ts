import type { Rule } from './rules';
import { analyzeCoverage, type Finding } from './analyze';
import type { Proposal } from './change';
import { formatCoverage, type Coverage } from './boxes';

/** CSV with every field quoted. Cells whose first non-whitespace/non-control character is = + - @ (or that start with a control character) get a leading apostrophe so spreadsheets treat them as text. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => { let s = v === null || v === undefined ? '' : String(v); if (/^[\s\x00-\x1f]*[=+\-@]/.test(s) || /^[\x00-\x1f]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  return [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

/** Coverage label for a rule: whole percent plus an "(approximate)" marker when the fragment budget was reached; '' when unknown. */
export function coverageLabel(c: Coverage | undefined): string {
  return c ? `${formatCoverage(c.fraction)}${c.approximate ? ' (approximate)' : ''}` : '';
}

/** Rows for the findings CSV. `coverage` (from `analyzeCoverage`) adds the rule's union coverage by earlier rules as the last column. */
export function findingRows(findings: Finding[], proposals: Proposal[], decisions: Record<string, boolean>, coverage: Record<string, Coverage>): Record<string, unknown>[] {
  return findings.map(f => ({
    severity: f.severity, kind: f.kind, ruleId: f.ruleId ?? '', relatedRuleIds: f.relatedRuleIds.join(' '), title: f.title, detail: f.detail,
    proposal: proposals.find(p => p.findingId === f.id)?.op ?? '', approved: decisions[f.id] === true ? 'yes' : decisions[f.id] === false ? 'rejected' : 'pending',
    coverage: f.ruleId ? coverageLabel(coverage[f.ruleId]) : '',
  }));
}

export interface CoverageRow { ruleId: string; enabled: boolean; fraction: number | null; percent: string; coveringRuleIds: string[]; approximate: boolean }
/** One row per rule in rule order; disabled rules (not analysed) carry `fraction: null`. JSON-safe (no BigInt). */
export function coverageRows(rules: Rule[], coverage: Record<string, Coverage>): CoverageRow[] {
  return rules.map(r => {
    const c = r.enabled ? coverage[r.id] : undefined;
    return c
      ? { ruleId: r.id, enabled: r.enabled, fraction: c.fraction, percent: formatCoverage(c.fraction), coveringRuleIds: c.coveringRuleIds, approximate: c.approximate }
      : { ruleId: r.id, enabled: r.enabled, fraction: null, percent: '', coveringRuleIds: [], approximate: false };
  });
}

export function buildReport({ rules, findings, proposals, generatedAt, now, coverage }: { rules: Rule[]; findings: Finding[]; proposals: Proposal[]; generatedAt: string; now: string; coverage?: Record<string, Coverage> }) {
  const byKind: Record<string, number> = {}; for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const bySeverity: Record<string, number> = {}; for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  return {
    schema: 'ruleshadow.report/1', generatedAt, reviewDate: now, tool: 'Ruleshadow educational rule-review simulator',
    dataNotice: 'Synthetic rule set analysed in the browser. No device connection, no packet generation, no deployment.',
    summary: { rules: rules.length, enabled: rules.filter(r => r.enabled).length, findings: findings.length, byKind, bySeverity, proposals: proposals.length, approved: proposals.filter(p => p.approved).length, manualReview: proposals.filter(p => p.manualReview).length },
    findings, proposals, rules,
    // Additive (October 2026): union coverage of each rule by earlier enabled rules; see boxes.ts.
    coverage: coverageRows(rules, coverage ?? analyzeCoverage(rules)),
  };
}
