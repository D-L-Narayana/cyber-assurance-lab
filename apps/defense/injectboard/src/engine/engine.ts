import type { Scenario, Inject, Option } from './scenario';
import { achievableMaxScore, upperBoundScore, type AchievableScore } from './score';

export interface DecisionRecord { decisionId: string; injectId: string; optionId: string; optionLabel: string; atMinute: number; dueMinute: number; breachedSla: boolean; minutesLate: number; score: number; note: string }
export interface Task { id: string; role: string; title: string; createdMinute: number; dueMinute: number; status: 'open' | 'done'; completedAtMinute: number | null; overdue: boolean }
export interface Lesson { text: string; category: 'process' | 'technology' | 'communication' | 'people'; owner: string; atMinute: number }
export interface State {
  clockMinute: number; delivered: string[]; deliveredAt: Record<string, number>; unlocked: Record<string, number>;
  decisions: DecisionRecord[]; tasks: Task[]; lessons: Lesson[]; score: number; log: Action[];
}
export type Action =
  | { type: 'advance'; minutes: number }
  | { type: 'decide'; decisionId: string; optionId: string }
  | { type: 'complete'; taskId: string }
  | { type: 'lesson'; text: string; category: Lesson['category']; owner: string };

export const MAX_STEP = 600;

function deliverDue(state: State, scenario: Scenario): State {
  const delivered = [...state.delivered]; const deliveredAt = { ...state.deliveredAt };
  const due = scenario.injects.filter(i => !delivered.includes(i.id)).map(i => ({ i, at: i.atMinute ?? state.unlocked[i.id] ?? null })).filter(x => x.at !== null && (x.at as number) <= state.clockMinute);
  due.sort((a, b) => (a.at as number) - (b.at as number) || scenario.injects.indexOf(a.i) - scenario.injects.indexOf(b.i));
  for (const d of due) { delivered.push(d.i.id); deliveredAt[d.i.id] = d.at as number; }
  return { ...state, delivered, deliveredAt };
}

export function initialState(scenario: Scenario): State {
  return deliverDue({ clockMinute: 0, delivered: [], deliveredAt: {}, unlocked: {}, decisions: [], tasks: [], lessons: [], score: 0, log: [] }, scenario);
}

export function advanceClock(state: State, scenario: Scenario, minutes: number): State {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_STEP) throw new Error(`Clock step must be an integer between 0 and ${MAX_STEP} minutes.`);
  const next = { ...state, clockMinute: state.clockMinute + minutes, log: [...state.log, { type: 'advance', minutes } as Action] };
  return deliverDue(next, scenario);
}

/** Minutes until the next scheduled (or unlocked) undelivered inject, or null. */
export function minutesToNextInject(state: State, scenario: Scenario): number | null {
  const times = scenario.injects.filter(i => !state.delivered.includes(i.id)).map(i => i.atMinute ?? state.unlocked[i.id] ?? null).filter((t): t is number => t !== null && t > state.clockMinute);
  return times.length ? Math.min(...times) - state.clockMinute : null;
}

export function pendingDecisions(state: State, scenario: Scenario): Inject[] {
  return scenario.injects.filter(i => i.decision && state.delivered.includes(i.id) && !state.decisions.some(d => d.decisionId === i.decision!.id));
}

export type DecideResult = { ok: true; state: State } | { ok: false; reason: string };
export function decide(state: State, scenario: Scenario, decisionId: string, optionId: string): DecideResult {
  const inject = scenario.injects.find(i => i.decision?.id === decisionId);
  if (!inject || !inject.decision) return { ok: false, reason: `Unknown decision ${decisionId}.` };
  if (!state.delivered.includes(inject.id)) return { ok: false, reason: `Inject "${inject.title}" has not been delivered yet.` };
  if (state.decisions.some(d => d.decisionId === decisionId)) return { ok: false, reason: 'This decision has already been committed.' };
  const option: Option | undefined = inject.decision.options.find(o => o.id === optionId);
  if (!option) return { ok: false, reason: `Unknown option ${optionId}.` };
  const dueMinute = state.deliveredAt[inject.id] + inject.decision.slaMinutes;
  const minutesLate = Math.max(0, state.clockMinute - dueMinute);
  const record: DecisionRecord = { decisionId, injectId: inject.id, optionId, optionLabel: option.label, atMinute: state.clockMinute, dueMinute, breachedSla: minutesLate > 0, minutesLate, score: option.score, note: option.note };
  const tasks: Task[] = [...state.tasks, ...(option.tasks ?? []).map(t => ({ id: t.id, role: t.role, title: t.title, createdMinute: state.clockMinute, dueMinute: state.clockMinute + t.dueInMinutes, status: 'open' as const, completedAtMinute: null, overdue: false }))];
  const unlocked = { ...state.unlocked };
  for (const u of option.unlocks ?? []) unlocked[u.injectId] = state.clockMinute + u.afterMinutes;
  const next: State = { ...state, decisions: [...state.decisions, record], tasks, unlocked, score: state.score + option.score, log: [...state.log, { type: 'decide', decisionId, optionId }] };
  return { ok: true, state: deliverDue(next, scenario) };
}

export function completeTask(state: State, taskId: string): State {
  const t = state.tasks.find(x => x.id === taskId && x.status === 'open');
  if (!t) return state;
  return { ...state, tasks: state.tasks.map(x => x.id === taskId ? { ...x, status: 'done', completedAtMinute: state.clockMinute, overdue: state.clockMinute > x.dueMinute } : x), log: [...state.log, { type: 'complete', taskId }] };
}

export function addLesson(state: State, l: Omit<Lesson, 'atMinute'>): State {
  const text = l.text.trim().slice(0, 500);
  if (!text) return state;
  return { ...state, lessons: [...state.lessons, { ...l, text, atMinute: state.clockMinute }], log: [...state.log, { type: 'lesson', text, category: l.category, owner: l.owner }] };
}

/**
 * Progress summary. `maxScore` is the UPPER BOUND (best option of every decision, including branch-only ones);
 * `achievableMax` is the best total reachable on one path (see `score.ts`), with `achievableTruncated` set when the
 * search budget stopped early. Callers that render often should pass a memoised `achievable` result.
 */
export function completeness(state: State, scenario: Scenario, achievable: AchievableScore = achievableMaxScore(scenario)) {
  const decisionsTotal = scenario.injects.filter(i => i.decision).length;
  const decisionsMade = state.decisions.length;
  const breaches = state.decisions.filter(d => d.breachedSla).length;
  const tasksTotal = state.tasks.length; const tasksDone = state.tasks.filter(t => t.status === 'done').length;
  const overdueOpen = state.tasks.filter(t => t.status === 'open' && state.clockMinute > t.dueMinute).length;
  const maxScore = upperBoundScore(scenario);
  return { decisionsTotal, decisionsMade, pct: decisionsTotal ? Math.round((decisionsMade / decisionsTotal) * 100) : 0, breaches, tasksTotal, tasksDone, overdueOpen, lessons: state.lessons.length, score: state.score, maxScore, achievableMax: achievable.max, achievableTruncated: achievable.truncated };
}

/** Deterministically rebuild state from an action log. Invalid actions are skipped, never throw. */
export function replay(scenario: Scenario, log: Action[]): State {
  let s = initialState(scenario);
  for (const a of log) {
    if (a.type === 'advance') { try { s = advanceClock(s, scenario, a.minutes); } catch { /* skip invalid step */ } }
    else if (a.type === 'decide') { const r = decide(s, scenario, a.decisionId, a.optionId); if (r.ok) s = r.state; }
    else if (a.type === 'complete') s = completeTask(s, a.taskId);
    else if (a.type === 'lesson') s = addLesson(s, { text: a.text, category: a.category, owner: a.owner });
  }
  return s;
}
