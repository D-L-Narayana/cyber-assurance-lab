import { describe, it, expect } from 'vitest';
import { achievableMaxScore, upperBoundScore, SEARCH_BUDGET, type PathStep } from './score';
import { initialState, advanceClock, decide, minutesToNextInject, pendingDecisions, completeness, replay, MAX_STEP, type State } from './engine';
import { afterActionReport } from './report';
import { validateScenario, type Scenario } from './scenario';
import { RANSOMWARE_TABLETOP } from './fixtures';

/** Drive the real engine along a path: advance the clock until each decision's inject is delivered, then decide. */
function drive(scenario: Scenario, path: PathStep[]): State {
  let s = initialState(scenario);
  for (const step of path) {
    while (!pendingDecisions(s, scenario).some(i => i.decision!.id === step.decisionId)) {
      const n = minutesToNextInject(s, scenario);
      if (n === null) throw new Error(`decision ${step.decisionId} never becomes deliverable`);
      s = advanceClock(s, scenario, Math.min(n, MAX_STEP));
    }
    const r = decide(s, scenario, step.decisionId, step.optionId);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  }
  return s;
}

/** The 0-point option unlocks a decision worth 30, so the best path is NOT "best option everywhere". */
const branchy: Scenario = {
  id: 'branchy', title: 'Branch pays off', version: 1, startAt: '2026-10-01T09:00:00Z',
  roles: [{ id: 'ic', name: 'Incident commander' }],
  injects: [
    { id: 'i1', atMinute: 0, role: 'ic', title: 'Alert', body: 'b', decision: { id: 'd1', prompt: 'p', slaMinutes: 15, options: [
      { id: 'yes', label: 'Contain', score: 10, note: '' },
      { id: 'wait', label: 'Observe', score: 0, note: '', unlocks: [{ injectId: 'i2', afterMinutes: 5 }] },
    ] } },
    { id: 'i2', atMinute: null, role: 'ic', title: 'Follow-up', body: 'b', decision: { id: 'd2', prompt: 'p', slaMinutes: 15, options: [
      { id: 'big', label: 'Big', score: 30, note: '' },
      { id: 'small', label: 'Small', score: 0, note: '' },
    ] } },
  ],
};

/**
 * Hostile dense scenario: `decisions` injects at minute 0 with `optionsPer` options each, and every option unlocks a
 * DIFFERENT decision-bearing inject, so no two options of a decision are future-equivalent and nothing can be pruned:
 * optionsPer^decisions complete paths. 16 × 3 → 43 million leaves, far beyond any sane budget.
 */
function dense(decisions: number, optionsPer: number): Scenario {
  const injects: Scenario['injects'] = [];
  for (let d = 0; d < decisions; d++) {
    const options = Array.from({ length: optionsPer }, (_, o) => ({ id: `o${o}`, label: `Option ${o}`, score: (o * 7) % 11, note: '', unlocks: [{ injectId: `u${d}-${o}`, afterMinutes: 1 }] }));
    injects.push({ id: `d${d}`, atMinute: 0, role: 'ic', title: `Decision ${d}`, body: 'b', decision: { id: `dec${d}`, prompt: 'p', slaMinutes: 10, options } });
    for (let o = 0; o < optionsPer; o++) {
      injects.push({ id: `u${d}-${o}`, atMinute: null, role: 'ic', title: `Unlock ${d}-${o}`, body: 'b', decision: { id: `udec${d}-${o}`, prompt: 'p', slaMinutes: 10, options: [
        { id: 'a', label: 'A', score: 1, note: '' }, { id: 'b', label: 'B', score: 0, note: '' },
      ] } });
    }
  }
  return { id: 'dense', title: 'Dense', version: 1, startAt: '2026-10-01T09:00:00Z', roles: [{ id: 'ic', name: 'IC' }], injects };
}

describe('achievable score', () => {
  it('fixture: upper bound 52, but only 48 is achievable on one path because the branch decision needs the 0-point observe option', () => {
    expect(upperBoundScore(RANSOMWARE_TABLETOP)).toBe(52);
    const r = achievableMaxScore(RANSOMWARE_TABLETOP);
    expect(r.max).toBe(48);
    expect(r.truncated).toBe(false);
    expect(r.path.map(p => p.decisionId)).not.toContain('d-late-isolate');
    expect(r.path.find(p => p.decisionId === 'd-isolate')?.optionId).toBe('isolate');
    expect(r.path).toHaveLength(6);
  });

  it('the returned path replays to exactly that score through the engine', () => {
    const r = achievableMaxScore(RANSOMWARE_TABLETOP);
    expect(r.path.length).toBeGreaterThan(0);
    const driven = drive(RANSOMWARE_TABLETOP, r.path);
    expect(driven.score).toBe(r.max);
    const again = replay(RANSOMWARE_TABLETOP, driven.log);
    expect(again).toEqual(driven);
    expect(replay(RANSOMWARE_TABLETOP, r.log).score).toBe(r.max);
  });

  it('explores the branch when the branch-only decision is worth more than the option that skips it', () => {
    expect(validateScenario(branchy).ok).toBe(true);
    expect(upperBoundScore(branchy)).toBe(40);
    const r = achievableMaxScore(branchy);
    expect(r.max).toBe(30);
    expect(r.path).toEqual([{ decisionId: 'd1', optionId: 'wait' }, { decisionId: 'd2', optionId: 'big' }]);
    expect(drive(branchy, r.path).score).toBe(30);
  });

  it('completeness and the after-action report show both numbers', () => {
    const s = initialState(RANSOMWARE_TABLETOP);
    const c = completeness(s, RANSOMWARE_TABLETOP);
    expect(c.maxScore).toBe(52);
    expect(c.achievableMax).toBe(48);
    expect(c.achievableTruncated).toBe(false);
    const rep = afterActionReport(s, RANSOMWARE_TABLETOP, '2026-10-04T12:00:00Z');
    expect(rep.markdown).toMatch(/Score: 0\/48/);
    expect(rep.markdown).toMatch(/upper bound 52/);
    expect(rep.json.completeness.achievableMax).toBe(48);
    expect(rep.json.scoreBounds).toMatchObject({ upperBound: 52, achievable: 48, truncated: false });
    // A precomputed result can be supplied so the UI does not re-run the search on every render.
    expect(completeness(s, RANSOMWARE_TABLETOP, achievableMaxScore(RANSOMWARE_TABLETOP))).toEqual(c);
  });

  it('is deterministic and stops at the expansion budget on a dense branching scenario, flagging truncation', () => {
    const hostile = dense(16, 3); // 3^16 complete paths; 64 injects, 64 decisions
    expect(validateScenario(hostile).ok).toBe(true);
    const a = achievableMaxScore(hostile);
    const b = achievableMaxScore(hostile);
    expect(a).toEqual(b);
    expect(a.truncated).toBe(true);
    expect(a.expansions).toBeLessThanOrEqual(SEARCH_BUDGET);
    expect(a.max).toBeGreaterThan(0);
    expect(a.max).toBeLessThanOrEqual(upperBoundScore(hostile));
    expect(drive(hostile, a.path).score).toBe(a.max);
    expect(achievableMaxScore(RANSOMWARE_TABLETOP, 2).truncated).toBe(true);
    expect(achievableMaxScore(RANSOMWARE_TABLETOP).expansions).toBeLessThan(100);
  });
});
