import type { Finding, NotebookState, Observation } from './notebook';

export interface Report {
  schema: 'assaynotebook.report/1';
  generatedAt: string;
  scope: string;
  tool: { name: 'assaynotebook'; mode: 'in-browser deterministic lab simulation' };
  summary: { observations: number; findings: number; byStatus: Record<string, number>; bySeverity: Record<string, number> };
  findings: Finding[];
  observations: Observation[];
  disclaimer: string;
}

export const DISCLAIMER = 'Educational prototype. All requests were made against a deterministic application simulated inside the browser tab. This is not a penetration test of any real system, and no finding here describes real software.';

const redact = (text: string) => text.replace(/sid=[a-z0-9]+/gi, 'sid=[redacted]');
function redactObservation(o: Observation): Observation {
  const headers = Object.fromEntries(Object.entries(o.response.headers).map(([k, v]) => [k, redact(v)]));
  return { ...o, response: { ...o.response, headers, body: redact(o.response.body) } };
}

export function buildReport(state: NotebookState, options: { generatedAt?: string; scope: string }): Report {
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const f of state.findings) { byStatus[f.status] = (byStatus[f.status] ?? 0) + 1; bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1; }
  return {
    schema: 'assaynotebook.report/1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scope: options.scope,
    tool: { name: 'assaynotebook', mode: 'in-browser deterministic lab simulation' },
    summary: { observations: state.observations.length, findings: state.findings.length, byStatus, bySeverity },
    findings: JSON.parse(JSON.stringify(state.findings)),
    observations: state.observations.map(redactObservation),
    disclaimer: DISCLAIMER,
  };
}

export function reportToMarkdown(r: Report): string {
  const obs = new Map(r.observations.map((o) => [o.id, o]));
  const lines = [
    `# Assessment notebook — ${r.scope}`, '', `Generated ${r.generatedAt} · ${r.summary.observations} observations · ${r.summary.findings} findings`, '', `> ${r.disclaimer} (not a penetration test)`, '',
  ];
  for (const f of r.findings) {
    const first = obs.get(f.evidence[0]?.observationId);
    lines.push(`## ${f.id} · ${f.title}`, '', `**${f.severity.toUpperCase()}** — impact ${f.impact}, likelihood ${f.likelihood}. ${f.rationale}`, '', `${f.cwe}: ${f.cweName} · ${f.owasp2021} · endpoint \`${f.endpoint}\` · status **${f.status}**`, '');
    if (first) lines.push('**Reproduction (lab):**', '', '```', `${first.request.method} ${first.request.path}${first.request.query ? '?' + new URLSearchParams(first.request.query).toString() : ''}${first.request.session ? `\nSession: ${first.request.session}` : ''}${first.request.body ? `\nBody: ${JSON.stringify(first.request.body)}` : ''}`, `→ HTTP ${first.response.status}`, '```', '');
    lines.push('**Evidence:**', ...f.evidence.map((e) => `- ${e.observationId} \`${e.hash.slice(0, 16)}…\` — ${e.detail}`), '');
    if (f.retests.length) lines.push('**Retests:**', ...f.retests.map((t) => `- ${t.at} on ${t.build}: ${t.outcome} — ${t.evidence}`), '');
    lines.push(`**Remediation:** ${f.remediation}`, '');
  }
  if (r.findings.length === 0) lines.push('No findings recorded.', '');
  return lines.join('\n');
}
