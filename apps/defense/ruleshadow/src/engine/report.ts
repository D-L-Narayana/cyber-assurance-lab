import type { Rule } from './rules';
import type { Finding } from './analyze';
import type { Proposal } from './change';

/** CSV with every field quoted. Cells whose first non-whitespace/non-control character is = + - @ (or that start with a control character) get a leading apostrophe so spreadsheets treat them as text. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => { let s = v === null || v === undefined ? '' : String(v); if (/^[\s\x00-\x1f]*[=+\-@]/.test(s) || /^[\x00-\x1f]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  return [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

export function buildReport({ rules, findings, proposals, generatedAt, now }: { rules: Rule[]; findings: Finding[]; proposals: Proposal[]; generatedAt: string; now: string }) {
  const byKind: Record<string, number> = {}; for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const bySeverity: Record<string, number> = {}; for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  return {
    schema: 'ruleshadow.report/1', generatedAt, reviewDate: now, tool: 'Ruleshadow educational rule-review simulator',
    dataNotice: 'Synthetic rule set analysed in the browser. No device connection, no packet generation, no deployment.',
    summary: { rules: rules.length, enabled: rules.filter(r => r.enabled).length, findings: findings.length, byKind, bySeverity, proposals: proposals.length, approved: proposals.filter(p => p.approved).length, manualReview: proposals.filter(p => p.manualReview).length },
    findings, proposals, rules,
  };
}
