import type { State } from './engine';
import type { Scenario } from './scenario';
import { completeness } from './engine';
import { achievableMaxScore, type AchievableScore } from './score';

const clock = (startAt: string, minute: number) => new Date(Date.parse(startAt) + minute * 60_000).toISOString().slice(11, 16) + 'Z';

/**
 * After-action report (Markdown + `injectboard.aar/1` JSON). The score line shows both numbers: the best total
 * achievable on one path and the upper bound over all branches. `achievable` may be passed in (memoised by the UI);
 * otherwise the branch-aware search runs here.
 */
export function afterActionReport(state: State, scenario: Scenario, generatedAt: string, achievable?: AchievableScore) {
  const bounds = achievable ?? achievableMaxScore(scenario);
  const c = completeness(state, scenario, bounds);
  const roleName = (id: string) => scenario.roles.find(r => r.id === id)?.name ?? id;
  const timeline = [
    ...state.delivered.map(id => { const i = scenario.injects.find(x => x.id === id)!; return { minute: state.deliveredAt[id], kind: 'inject', text: `${roleName(i.role)}: ${i.title}` }; }),
    ...state.decisions.map(d => ({ minute: d.atMinute, kind: 'decision', text: `${d.optionLabel}${d.breachedSla ? ` (SLA breached by ${d.minutesLate} min)` : ''}` })),
    ...state.tasks.filter(t => t.status === 'done').map(t => ({ minute: t.completedAtMinute!, kind: 'task', text: `${roleName(t.role)} completed "${t.title}"${t.overdue ? ' (overdue)' : ''}` })),
    ...state.lessons.map(l => ({ minute: l.atMinute, kind: 'lesson', text: `[${l.category}] ${l.text}` })),
  ].sort((a, b) => a.minute - b.minute);
  const achievableText = `${c.achievableMax}${bounds.truncated ? ' (search budget reached; achievable total is a lower bound)' : ''}`;
  const json = {
    schema: 'injectboard.aar/1', generatedAt, scenario: { id: scenario.id, title: scenario.title, version: scenario.version },
    dataNotice: 'Synthetic tabletop scenario; no malware, no real systems, no real people.',
    exerciseMinutes: state.clockMinute, completeness: c, slaBreaches: c.breaches,
    scoreBounds: { upperBound: c.maxScore, achievable: bounds.max, truncated: bounds.truncated, bestPath: bounds.path },
    decisions: state.decisions, tasks: state.tasks, lessons: state.lessons, timeline, actionLog: state.log,
  };
  const lines = [
    `# After-action report — ${scenario.title}`, '',
    `Generated ${generatedAt}. Exercise clock ran ${state.clockMinute} minutes from ${scenario.startAt}. Synthetic tabletop; educational prototype.`, '',
    '## Summary',
    `- Decisions: ${c.decisionsMade}/${c.decisionsTotal} (${c.pct}%)`, `- SLA breaches: ${c.breaches}`, `- Tasks done: ${c.tasksDone}/${c.tasksTotal}, overdue open: ${c.overdueOpen}`,
    `- Score: ${c.score}/${achievableText} best achievable on one path; upper bound ${c.maxScore} (best option of every decision, including branch-only ones)`,
    `- Lessons captured: ${c.lessons}`, '',
    '## Timeline', ...timeline.map(t => `- ${clock(scenario.startAt, t.minute)} (+${t.minute}m) ${t.kind}: ${t.text}`), '',
    '## Decisions', ...state.decisions.map(d => `- ${d.optionLabel} — at +${d.atMinute}m, due +${d.dueMinute}m${d.breachedSla ? `, **breached by ${d.minutesLate} min**` : ', on time'}. ${d.note}`), '',
    '## Lessons', ...(state.lessons.length ? state.lessons.map(l => `- [${l.category}] ${l.text} (owner: ${roleName(l.owner)})`) : ['- none recorded']), '',
  ];
  return { json, markdown: lines.join('\n') };
}
