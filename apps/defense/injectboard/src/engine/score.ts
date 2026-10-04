import type { Scenario, Option } from './scenario';
import { initialState, advanceClock, decide, minutesToNextInject, pendingDecisions, MAX_STEP, type State, type Action } from './engine';

/** One committed decision on a path through the scenario. */
export interface PathStep { decisionId: string; optionId: string }

export interface AchievableScore {
  /** Best total found on one playable path (exact unless `truncated`). */
  max: number;
  /** The decisions, in order, that reach `max`. */
  path: PathStep[];
  /** True when the expansion budget stopped the search; `max` is then a lower bound of the true achievable total. */
  truncated: boolean;
  /** Decision nodes expanded (greedy warm start + branching search). */
  expansions: number;
  /** Engine action log (advance/decide) that `replay()` turns into a state scoring `max`. */
  log: Action[];
}

/** Expansion budget: how many decision nodes the branching search may expand before it stops and flags `truncated`. */
export const SEARCH_BUDGET = 20_000;

/** Sum of the best option of every decision, including branch-only ones — an upper bound, not necessarily playable. */
export function upperBoundScore(scenario: Scenario): number {
  return scenario.injects.reduce((s, i) => s + (i.decision && i.decision.options.length ? Math.max(...i.decision.options.map(o => o.score)) : 0), 0);
}

/** Advance the clock (in steps the engine accepts) until a decision is pending or nothing more can ever be delivered. */
function settle(state: State, scenario: Scenario): State {
  let s = state;
  while (pendingDecisions(s, scenario).length === 0) {
    const n = minutesToNextInject(s, scenario);
    if (n === null) return s;
    s = advanceClock(s, scenario, Math.min(n, MAX_STEP));
  }
  return s;
}

/**
 * Options of one decision are future-equivalent for scoring when they make the same set of still-unreachable
 * decision-bearing injects reachable (tasks, notes, SLA and unlock timing never change the total). Only the
 * best-scoring option of each equivalence class is kept; the result is sorted best-first, ties in option order.
 */
function candidates(state: State, scenario: Scenario, options: Option[]): Option[] {
  const keyOf = (o: Option) => {
    const ids = new Set<string>();
    for (const u of o.unlocks ?? []) {
      const target = scenario.injects.find(i => i.id === u.injectId);
      if (target?.decision && !state.delivered.includes(u.injectId) && state.unlocked[u.injectId] === undefined) ids.add(u.injectId);
    }
    return [...ids].sort().join('\u0000');
  };
  const best = new Map<string, Option>();
  for (const o of options) { const k = keyOf(o); const cur = best.get(k); if (!cur || o.score > cur.score) best.set(k, o); }
  return [...best.values()].sort((a, b) => b.score - a.score || options.indexOf(a) - options.indexOf(b));
}

/**
 * Branch-aware search for the best total reachable on ONE path, driven through the real engine functions.
 * Decisions are expanded as they become deliverable (the clock only advances when nothing is pending — delaying a
 * decision can never make more decisions reachable), options are tried best-first, unlocks are followed.
 * A greedy warm start always yields one complete, playable path; the depth-first search then spends the remaining
 * budget. If the budget runs out, `truncated` is true and `max` is a lower bound. Deterministic for a given scenario.
 * `expansions` can exceed `budget` only when the budget is smaller than the number of decisions on the greedy path.
 */
export function achievableMaxScore(scenario: Scenario, budget: number = SEARCH_BUDGET): AchievableScore {
  const start = settle(initialState(scenario), scenario);
  const best: { s: State } = { s: start };
  const consider = (s: State) => { if (s.score > best.s.score) best.s = s; };
  let expansions = 0; let truncated = false;

  let g = start;
  for (;;) {
    const pending = pendingDecisions(g, scenario);
    if (pending.length === 0) break;
    const d = pending[0].decision!;
    const opts = candidates(g, scenario, d.options);
    if (!opts.length) break;
    expansions++;
    const r = decide(g, scenario, d.id, opts[0].id);
    if (!r.ok) break;
    g = settle(r.state, scenario);
  }
  consider(g);

  const stack: State[] = [start];
  while (stack.length) {
    const node = stack.pop()!;
    const pending = pendingDecisions(node, scenario);
    if (pending.length === 0) { consider(node); continue; }
    if (expansions >= budget) { truncated = true; break; }
    expansions++;
    const d = pending[0].decision!;
    const opts = candidates(node, scenario, d.options);
    for (let i = opts.length - 1; i >= 0; i--) {
      const r = decide(node, scenario, d.id, opts[i].id);
      if (r.ok) stack.push(settle(r.state, scenario));
    }
  }

  const b = best.s;
  return { max: b.score, path: b.decisions.map(x => ({ decisionId: x.decisionId, optionId: x.optionId })), truncated, expansions, log: b.log };
}
