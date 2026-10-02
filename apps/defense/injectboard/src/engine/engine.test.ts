import { describe, it, expect } from 'vitest';
import { initialState, advanceClock, decide, completeTask, addLesson, completeness, replay, type Action } from './engine';
import { validateScenario, type Scenario } from './scenario';
import { RANSOMWARE_TABLETOP } from './fixtures';
import { afterActionReport } from './report';

const mini: Scenario = {
  id: 'mini', title: 'Mini', version: 1, startAt: '2026-10-01T09:00:00Z',
  roles: [{ id: 'ic', name: 'Incident commander' }, { id: 'comms', name: 'Communications' }],
  injects: [
    { id: 'i1', atMinute: 0, role: 'ic', title: 'Alert', body: 'EDR alert on FS-01.', decision: { id: 'd1', prompt: 'Isolate FS-01?', slaMinutes: 15, options: [
      { id: 'yes', label: 'Isolate now', score: 10, note: 'Contained early', tasks: [{ id: 't-iso', role: 'ic', title: 'Confirm isolation', dueInMinutes: 10 }], unlocks: [{ injectId: 'i3', afterMinutes: 5 }] },
      { id: 'wait', label: 'Wait for more data', score: 0, note: 'Spread risk' },
    ] } },
    { id: 'i2', atMinute: 10, role: 'comms', title: 'Press call', body: 'Reporter asks about outage.' },
    { id: 'i3', atMinute: null, role: 'ic', title: 'Isolation confirmed', body: 'Host offline.' },
  ],
};

describe('inject scheduler', () => {
  it('delivers injects whose minute has passed, in order, and never the unlock-only ones', () => {
    let s = initialState(mini);
    expect(s.delivered).toEqual(['i1']);
    s = advanceClock(s, mini, 5);
    expect(s.delivered).toEqual(['i1']);
    s = advanceClock(s, mini, 5);
    expect(s.clockMinute).toBe(10);
    expect(s.delivered).toEqual(['i1', 'i2']);
    s = advanceClock(s, mini, 500);
    expect(s.delivered).not.toContain('i3');
  });
  it('rejects negative or oversized clock steps', () => {
    const s = initialState(mini);
    expect(() => advanceClock(s, mini, -1)).toThrow(/step/);
    expect(() => advanceClock(s, mini, 10_000)).toThrow(/step/);
  });
});

describe('decisions, SLA and tasks', () => {
  it('records a timely decision, applies score, creates tasks and unlocks a follow-up inject relative to decision time', () => {
    let s = initialState(mini);
    s = advanceClock(s, mini, 4);
    const r = decide(s, mini, 'd1', 'yes');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.decisions[0]).toMatchObject({ decisionId: 'd1', optionId: 'yes', atMinute: 4, breachedSla: false });
    expect(s.score).toBe(10);
    expect(s.tasks[0]).toMatchObject({ id: 't-iso', dueMinute: 14, status: 'open' });
    s = advanceClock(s, mini, 4);
    expect(s.delivered).not.toContain('i3');
    s = advanceClock(s, mini, 1);
    expect(s.delivered).toContain('i3');
  });
  it('flags a decision made after its SLA as breached', () => {
    let s = advanceClock(initialState(mini), mini, 20);
    const r = decide(s, mini, 'd1', 'wait');
    expect(r.ok && r.state.decisions[0].breachedSla).toBe(true);
    expect(r.ok && r.state.decisions[0].minutesLate).toBe(5);
  });
  it('rejects a second decision, an unknown option, and a decision whose inject is not yet delivered', () => {
    const late: Scenario = { ...mini, injects: mini.injects.map(i => i.id === 'i1' ? { ...i, atMinute: 30 } : i) };
    expect(decide(initialState(late), late, 'd1', 'yes').ok).toBe(false);
    const r1 = decide(initialState(mini), mini, 'd1', 'yes');
    expect(r1.ok && decide(r1.state, mini, 'd1', 'wait').ok).toBe(false);
    expect(decide(initialState(mini), mini, 'd1', 'nope').ok).toBe(false);
  });
  it('marks tasks completed after their due minute as overdue', () => {
    const r = decide(initialState(mini), mini, 'd1', 'yes');
    if (!r.ok) throw new Error('decide failed');
    let s = advanceClock(r.state, mini, 30);
    s = completeTask(s, 't-iso');
    expect(s.tasks[0]).toMatchObject({ status: 'done', completedAtMinute: 30, overdue: true });
    expect(completeTask(s, 'missing')).toBe(s);
  });
});

describe('completeness and lessons', () => {
  it('computes decision and task completeness from state', () => {
    let s = initialState(mini);
    expect(completeness(s, mini)).toMatchObject({ decisionsTotal: 1, decisionsMade: 0, pct: 0 });
    const r = decide(s, mini, 'd1', 'yes');
    if (!r.ok) throw new Error();
    s = addLesson(r.state, { text: 'Isolation playbook needs owner', category: 'process', owner: 'ic' });
    const c = completeness(s, mini);
    expect(c.decisionsMade).toBe(1);
    expect(c.tasksTotal).toBe(1);
    expect(c.lessons).toBe(1);
  });
  it('rejects empty lessons', () => {
    const s = initialState(mini);
    expect(addLesson(s, { text: '   ', category: 'process', owner: 'ic' })).toBe(s);
  });
});

describe('replay and report', () => {
  it('reproduces the same state from an action log', () => {
    const log: Action[] = [
      { type: 'advance', minutes: 4 }, { type: 'decide', decisionId: 'd1', optionId: 'yes' },
      { type: 'advance', minutes: 20 }, { type: 'complete', taskId: 't-iso' },
      { type: 'lesson', text: 'Need comms template', category: 'communication', owner: 'comms' },
    ];
    const a = replay(mini, log);
    const b = replay(mini, log);
    expect(a).toEqual(b);
    expect(a.clockMinute).toBe(24);
    expect(a.tasks[0].overdue).toBe(true);
  });
  it('writes an after-action report with a timeline, breaches and lessons', () => {
    const s = replay(mini, [{ type: 'advance', minutes: 20 }, { type: 'decide', decisionId: 'd1', optionId: 'wait' }]);
    const rep = afterActionReport(s, mini, '2026-10-01T12:00:00Z');
    expect(rep.json.schema).toBe('injectboard.aar/1');
    expect(rep.json.slaBreaches).toBe(1);
    expect(rep.markdown).toMatch(/After-action report/);
    expect(rep.markdown).toMatch(/Wait for more data/);
    expect(rep.markdown).toMatch(/synthetic/i);
  });
});

describe('scenario validation', () => {
  it('accepts the shipped ransomware tabletop and rejects duplicate ids, unknown roles and bad minutes', () => {
    expect(validateScenario(RANSOMWARE_TABLETOP).ok).toBe(true);
    const dup = { ...mini, injects: [...mini.injects, { ...mini.injects[1] }] };
    expect(validateScenario(dup).ok).toBe(false);
    const badRole = { ...mini, injects: [{ ...mini.injects[1], role: 'ghost' }] };
    expect(validateScenario(badRole).ok).toBe(false);
    const badMin = { ...mini, injects: [{ ...mini.injects[1], atMinute: -5 }] };
    expect(validateScenario(badMin).ok).toBe(false);
    expect(validateScenario({ nope: true }).ok).toBe(false);
    const big = { ...mini, injects: Array.from({ length: 201 }, (_, i) => ({ ...mini.injects[1], id: `x${i}` })) };
    expect(validateScenario(big).ok).toBe(false);
  });
});
