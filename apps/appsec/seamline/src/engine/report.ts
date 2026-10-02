import type { Decision, Message, Run, Scenario, StepResult } from './types';

export interface Report {
  schema: 'seamline.report/1';
  generatedAt: string;
  tool: { name: 'seamline'; mode: 'browser-local deterministic simulation' };
  scenario: { name: string; baseTime: string; steps: number };
  runs: Record<'trusting' | 'enforcing', Run>;
  comparison: { stepId: string; label: string; tamper?: string; trusting: Decision; enforcing: Decision; finding?: string }[];
  disclaimer: string;
}
export const DISCLAIMER = 'Educational prototype. Both "servers" are models inside the browser; the client is JSON, not a mobile app. This is not a mobile or API penetration test and describes no real system.';

function redactMessage(m: Message): Message & { token: string } {
  return { ...m, token: `[token:${m.user}]`, payload: JSON.parse(JSON.stringify(m.payload)) as Message['payload'] };
}
function redactRun(run: Run): Run {
  return { ...run, steps: run.steps.map((s): StepResult => ({ ...s, sent: redactMessage(s.sent), received: redactMessage(s.received) })) };
}

export function buildReport(scenario: Scenario, runs: { trusting: Run; enforcing: Run }, generatedAt = new Date().toISOString()): Report {
  return {
    schema: 'seamline.report/1', generatedAt, tool: { name: 'seamline', mode: 'browser-local deterministic simulation' },
    scenario: { name: scenario.name, baseTime: scenario.baseTime, steps: scenario.steps.length },
    runs: { trusting: redactRun(runs.trusting), enforcing: redactRun(runs.enforcing) },
    comparison: scenario.steps.map((s, i) => ({ stepId: s.id, label: s.label, tamper: s.tamper?.kind, trusting: runs.trusting.steps[i].decision, enforcing: runs.enforcing.steps[i].decision, finding: runs.trusting.steps[i].finding?.cwe })),
    disclaimer: DISCLAIMER,
  };
}

export function reportToMarkdown(r: Report): string {
  const lines = [
    `# Trust-boundary review — ${r.scenario.name}`, '', `Generated ${r.generatedAt} · ${r.scenario.steps} client events · trusting server: ${r.runs.trusting.summary.findings} findings · enforcing server: ${r.runs.enforcing.summary.findings} findings`, '', `> ${r.disclaimer}`, '',
    '| Step | Event | Tamper | Trusting server | Enforcing server | Weakness when trusted |', '|---|---|---|---|---|---|',
    ...r.comparison.map((c) => `| ${c.stepId} | ${c.label} | ${c.tamper ?? '—'} | ${c.trusting} | ${c.enforcing} | ${c.finding ?? '—'} |`), '',
    '## Findings against the trusting server', '',
    ...r.runs.trusting.steps.filter((s) => s.finding).flatMap((s) => [`### ${s.stepId} · ${s.finding!.title} (${s.finding!.cwe}, ${s.finding!.severity})`, '', s.finding!.detail, '', `Server-side control that neutralised it in the enforcing model: ${r.runs.enforcing.steps.find((e) => e.stepId === s.stepId)?.narrative ?? ''}`, '']),
  ];
  return lines.join('\n');
}
