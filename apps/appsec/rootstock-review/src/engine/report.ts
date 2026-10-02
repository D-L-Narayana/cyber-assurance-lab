import type { Lockgraph, Plan, Review, ReviewRow } from './types';

export interface Report {
  schema: 'rootstock.report/1';
  generatedAt: string;
  tool: { name: 'rootstock-review'; mode: 'browser-local deterministic evaluation of a synthetic snapshot' };
  project: { name: string; root: string; policy: Lockgraph['policy'] };
  summary: Review['summary'];
  notes: Review['notes'];
  rows: ReviewRow[];
  plan: (Plan & { package: string })[];
  unresolved: Review['unresolved'];
  disclaimer: string;
}
export const DISCLAIMER = 'Educational prototype. Evaluates a synthetic lock snapshot with synthetic advisories and a local policy. Not a vulnerability scan, SBOM attestation or legal licence opinion.';

export function buildReport(lock: Lockgraph, review: Review, generatedAt = new Date().toISOString()): Report {
  return {
    schema: 'rootstock.report/1', generatedAt, tool: { name: 'rootstock-review', mode: 'browser-local deterministic evaluation of a synthetic snapshot' },
    project: { name: lock.name, root: `${lock.root.name}@${lock.root.version}`, policy: lock.policy },
    summary: review.summary, notes: review.notes, rows: JSON.parse(JSON.stringify(review.rows)),
    plan: review.rows.filter((r) => r.plan).map((r) => ({ package: r.id, ...r.plan! })),
    unresolved: review.unresolved, disclaimer: DISCLAIMER,
  };
}

export function reportToMarkdown(r: Report): string {
  const lines = [
    `# Dependency review — ${r.project.name}`, '', `Generated ${r.generatedAt} · root ${r.project.root} · ${r.summary.packages} packages · ${r.summary.vulnerable} with advisories (${r.summary.blocking} blocking) · ${r.summary.licenseDeny} licence deny · ${r.summary.unknownLicense} unknown licence · ${r.summary.unresolvedEdges} unresolved edge(s)`, '',
    `> ${r.disclaimer}`, '', `> ${r.notes.reachability}`, '',
    '## Upgrade plan', '',
    ...(r.plan.length ? r.plan.map((p) => `- **${p.package}** — ${p.kind}${p.target ? ` → ${p.target}` : ''}. ${p.detail}`) : ['- No advisories matched.']), '',
    '## Packages needing attention', '', '| Package | Reachability | Licence | Advisories | Flags |', '|---|---|---|---|---|',
    ...r.rows.filter((x) => x.attention).map((x) => `| ${x.id} | ${x.reachability} | ${x.license.expression || '(none)'} → ${x.license.verdict} | ${x.advisories.map((a) => `${a.id} ${a.severity}${a.blocking ? ' (blocking)' : ''}`).join('<br>') || '—'} | ${x.flags.join(', ') || '—'} |`), '',
    '## Unresolved edges', '', ...(r.unresolved.length ? r.unresolved.map((u) => `- ${u.from} → ${u.name} ${u.range}: no package in the snapshot satisfies this range.`) : ['- none']), '',
    `_${r.notes.data}_`,
  ];
  return lines.join('\n');
}
