import { useMemo, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Dialog from '@radix-ui/react-dialog';
import { initialState, advanceClock, decide, completeTask, addLesson, completeness, minutesToNextInject, pendingDecisions, replay, type State, type Lesson } from './engine/engine';
import { validateScenario, LIMITS, type Scenario } from './engine/scenario';
import { RANSOMWARE_TABLETOP } from './engine/fixtures';
import { afterActionReport } from './engine/report';

const wall = (startAt: string, minute: number) => new Date(Date.parse(startAt) + minute * 60_000).toISOString().slice(11, 16) + 'Z';
const CATEGORIES: Lesson['category'][] = ['process', 'technology', 'communication', 'people'];

export function App() {
  const [scenario, setScenario] = useState<Scenario>(RANSOMWARE_TABLETOP);
  const [state, setState] = useState<State>(() => initialState(RANSOMWARE_TABLETOP));
  const [roleView, setRoleView] = useState<string>('all');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [lessonText, setLessonText] = useState('');
  const [lessonCat, setLessonCat] = useState<Lesson['category']>('process');
  const [lessonOwner, setLessonOwner] = useState('ic');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aarOpen, setAarOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const c = completeness(state, scenario);
  const next = minutesToNextInject(state, scenario);
  const pending = pendingDecisions(state, scenario);
  const roleName = (id: string) => scenario.roles.find(r => r.id === id)?.name ?? id;
  const feed = useMemo(() => [...state.delivered].reverse().map(id => scenario.injects.find(i => i.id === id)!).filter(i => roleView === 'all' || i.role === roleView), [state.delivered, scenario, roleView]);
  const tasks = state.tasks.filter(t => roleView === 'all' || t.role === roleView);
  const aar = useMemo(() => afterActionReport(state, scenario, new Date().toISOString()), [state, scenario]);

  function step(min: number) { setState(s => advanceClock(s, scenario, min)); setError(null); setStatus(`Clock advanced ${min} min.`); }
  function jump() { if (next === null) { setStatus('No further scheduled injects. Decisions may still unlock follow-ups.'); return; } step(next); }
  function commit(decisionId: string) {
    const opt = choice[decisionId];
    if (!opt) { setError('Choose an option before committing.'); return; }
    const r = decide(state, scenario, decisionId, opt);
    if (!r.ok) { setError(r.reason); return; }
    setState(r.state); setError(null);
    const rec = r.state.decisions[r.state.decisions.length - 1];
    setStatus(`Committed "${rec.optionLabel}" at +${rec.atMinute}m${rec.breachedSla ? ` — SLA breached by ${rec.minutesLate} min` : ' — within SLA'}.`);
  }
  function lesson() {
    const before = state; const after = addLesson(state, { text: lessonText, category: lessonCat, owner: lessonOwner });
    if (after === before) { setError('A lesson needs some text.'); return; }
    setState(after); setLessonText(''); setError(null); setStatus('Lesson recorded.');
  }
  function reset() { setState(initialState(scenario)); setChoice({}); setStatus('Exercise reset to +0m.'); setError(null); }
  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  function doImport() {
    if (importText.length > 200_000) { setImportErrors(['Scenario text exceeds 200,000 characters.']); return; }
    let parsed: unknown; try { parsed = JSON.parse(importText); } catch { setImportErrors(['Not valid JSON.']); return; }
    const v = validateScenario(parsed);
    if (!v.ok) { setImportErrors(v.errors); return; }
    setScenario(v.scenario); setState(initialState(v.scenario)); setChoice({}); setImportOpen(false); setImportErrors([]); setRoleView('all');
    setStatus(`Loaded scenario "${v.scenario.title}" with ${v.scenario.injects.length} injects.`);
  }
  function replayDemo() {
    const s = replay(scenario, state.log);
    setStatus(`Replayed ${state.log.length} logged actions → identical state: ${JSON.stringify(s) === JSON.stringify(state) ? 'yes' : 'no'}.`);
  }

  return (
    <div className="board">
      <a className="skip" href="#feed">Skip to inject feed</a>
      <header className="cmd">
        <div className="cmd-title">
          <p className="eyebrow">Incident-response tabletop commander · synthetic scenario · educational prototype</p>
          <h1>Injectboard</h1>
          <p className="scenario-title">{scenario.title}</p>
        </div>
        <div className="clock" role="group" aria-label="Exercise clock">
          <div className="clock-face">
            <span className="clock-time">{wall(scenario.startAt, state.clockMinute)}</span>
            <span className="clock-offset">+{state.clockMinute} min</span>
          </div>
          <div className="clock-controls">
            <button type="button" className="btn" onClick={() => step(5)}>Advance 5 min</button>
            <button type="button" className="btn" onClick={() => step(15)}>Advance 15 min</button>
            <button type="button" className="btn accent" onClick={jump} disabled={next === null}>Jump to next inject{next !== null ? ` (+${next}m)` : ''}</button>
          </div>
        </div>
        <div className="cmd-actions">
          <Dialog.Root open={aarOpen} onOpenChange={setAarOpen}>
            <Dialog.Trigger asChild><button type="button" className="btn outline">After-action report</button></Dialog.Trigger>
            <Dialog.Portal><Dialog.Overlay className="overlay" /><Dialog.Content className="dialog wide">
              <Dialog.Title>After-action report</Dialog.Title>
              <Dialog.Description className="muted">Generated from the exercise state. Markdown preview below; JSON follows schema <code>injectboard.aar/1</code>.</Dialog.Description>
              <pre className="aar">{aar.markdown}</pre>
              <div className="row end">
                <button type="button" className="btn outline" onClick={() => download(`injectboard-aar-${Date.now()}.md`, aar.markdown, 'text/markdown')}>Download Markdown</button>
                <button type="button" className="btn" onClick={() => download(`injectboard-aar-${Date.now()}.json`, JSON.stringify(aar.json, null, 2), 'application/json')}>Download JSON</button>
                <Dialog.Close asChild><button type="button" className="btn outline">Close</button></Dialog.Close>
              </div>
            </Dialog.Content></Dialog.Portal>
          </Dialog.Root>
          <Dialog.Root open={importOpen} onOpenChange={o => { setImportOpen(o); setImportErrors([]); }}>
            <Dialog.Trigger asChild><button type="button" className="btn outline">Import scenario</button></Dialog.Trigger>
            <Dialog.Portal><Dialog.Overlay className="overlay" /><Dialog.Content className="dialog">
              <Dialog.Title>Import a scenario</Dialog.Title>
              <Dialog.Description className="muted">JSON matching the shipped scenario shape: roles, injects (≤ {LIMITS.maxInjects}) with optional decisions, options, tasks and unlocks. Keep it fictional.</Dialog.Description>
              <label htmlFor="scn" className="visually-hidden">Scenario JSON</label>
              <textarea id="scn" rows={10} value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false} />
              {importErrors.length > 0 && <ul role="alert" className="errors">{importErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <div className="row end"><button type="button" className="btn outline" onClick={() => download('injectboard-scenario.json', JSON.stringify(scenario, null, 2), 'application/json')}>Download current</button><Dialog.Close asChild><button type="button" className="btn outline">Cancel</button></Dialog.Close><button type="button" className="btn" onClick={doImport}>Validate and load</button></div>
            </Dialog.Content></Dialog.Portal>
          </Dialog.Root>
          <button type="button" className="btn outline" onClick={reset}>Reset exercise</button>
        </div>
      </header>
      <p className="status" role="status" aria-live="polite">{status}</p>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="strip" aria-label="Exercise progress">
        <div><span className="k">Decisions</span><strong>{c.decisionsMade}/{c.decisionsTotal}</strong><span className="muted">{c.pct}% complete · {pending.length} pending</span></div>
        <div className={c.breaches ? 'warn' : ''}><span className="k">SLA breaches</span><strong>{c.breaches}</strong><span className="muted">decisions committed after their SLA</span></div>
        <div className={c.overdueOpen ? 'warn' : ''}><span className="k">Tasks</span><strong>{c.tasksDone}/{c.tasksTotal}</strong><span className="muted">{c.overdueOpen} open past due</span></div>
        <div><span className="k">Score</span><strong>{c.score}/{c.maxScore}</strong><span className="muted">sum of option scores; max is the best option each time</span></div>
        <div><span className="k">Lessons</span><strong>{c.lessons}</strong><span className="muted">captured during play</span></div>
      </section>

      <div className="role-bar">
        <span className="k">Role view</span>
        <ToggleGroup.Root type="single" value={roleView} onValueChange={v => v && setRoleView(v)} className="roles" aria-label="Filter the board by role">
          <ToggleGroup.Item value="all">All roles</ToggleGroup.Item>
          {scenario.roles.map(r => <ToggleGroup.Item key={r.id} value={r.id}>{r.name}</ToggleGroup.Item>)}
        </ToggleGroup.Root>
      </div>

      <main className="lanes">
        <section className="feed" id="feed" aria-labelledby="feed-h">
          <h2 id="feed-h">Inject feed{roleView !== 'all' ? ` — ${roleName(roleView)}` : ''}</h2>
          {feed.length === 0 && <p className="empty">No injects for this role yet. Advance the clock.</p>}
          {feed.map(inj => {
            const d = inj.decision; const made = d ? state.decisions.find(x => x.decisionId === d.id) : undefined;
            const deliveredAt = state.deliveredAt[inj.id]; const due = d ? deliveredAt + d.slaMinutes : null;
            const remaining = due !== null ? due - state.clockMinute : null;
            const pct = d && remaining !== null ? Math.max(0, Math.min(100, (remaining / d.slaMinutes) * 100)) : 0;
            return (
              <article key={inj.id} className={`inject ${d && !made ? (remaining! < 0 ? 'is-breached' : 'is-pending') : ''}`} aria-labelledby={`inj-${inj.id}`}>
                <header className="inject-head">
                  <span className="role-tag">{roleName(inj.role)}</span>
                  <span className="mono muted">{wall(scenario.startAt, deliveredAt)} · +{deliveredAt}m</span>
                </header>
                <h3 id={`inj-${inj.id}`}>{inj.title}</h3>
                <p className="body">{inj.body}</p>
                {d && !made && (
                  <div className="decision">
                    <div className="sla" aria-label={remaining! >= 0 ? `${remaining} minutes left on the SLA` : `SLA exceeded by ${-remaining!} minutes`}>
                      <div className="sla-bar"><div className={`sla-fill ${remaining! < 0 ? 'over' : remaining! <= 5 ? 'tight' : ''}`} style={{ width: `${pct}%` }} /></div>
                      <span className={`sla-text ${remaining! < 0 ? 'over' : ''}`}>{remaining! >= 0 ? `${remaining} min left of ${d.slaMinutes}` : `SLA exceeded by ${-remaining!} min`}</span>
                    </div>
                    <p className="prompt">{d.prompt}</p>
                    <RadioGroup.Root className="options" value={choice[d.id] ?? ''} onValueChange={v => setChoice(ch => ({ ...ch, [d.id]: v }))} aria-label={d.prompt}>
                      {d.options.map(o => (
                        <label key={o.id} className={`option ${choice[d.id] === o.id ? 'is-chosen' : ''}`}>
                          <RadioGroup.Item value={o.id} className="radio" id={`${d.id}-${o.id}`}><RadioGroup.Indicator className="radio-dot" /></RadioGroup.Item>
                          <span>{o.label}</span>
                        </label>
                      ))}
                    </RadioGroup.Root>
                    <button type="button" className="btn" onClick={() => commit(d.id)}>Commit decision</button>
                  </div>
                )}
                {made && (
                  <div className={`made ${made.breachedSla ? 'breached' : ''}`}>
                    <p><strong>Decided:</strong> {made.optionLabel} <span className="mono muted">+{made.atMinute}m</span> {made.breachedSla ? <span className="pill over">SLA breached by {made.minutesLate} min</span> : <span className="pill ok">within SLA</span>} <span className="pill">score {made.score}</span></p>
                    <p className="muted">{made.note}</p>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="side">
          <section aria-labelledby="tasks-h">
            <h2 id="tasks-h">Containment tasks{roleView !== 'all' ? ` — ${roleName(roleView)}` : ''}</h2>
            {tasks.length === 0 ? <p className="empty">Tasks appear when decisions create them.</p> : (
              <ul className="tasks">
                {tasks.map(t => {
                  const late = t.status === 'open' && state.clockMinute > t.dueMinute;
                  return (
                    <li key={t.id} className={`task ${t.status} ${late || t.overdue ? 'late' : ''}`}>
                      <div>
                        <span className="role-tag">{roleName(t.role)}</span> <span>{t.title}</span>
                        <div className="mono muted small">due +{t.dueMinute}m{t.status === 'done' ? ` · done +${t.completedAtMinute}m${t.overdue ? ' (overdue)' : ''}` : late ? ` · ${state.clockMinute - t.dueMinute} min overdue` : ` · ${t.dueMinute - state.clockMinute} min left`}</div>
                      </div>
                      {t.status === 'open' && <button type="button" className="btn small" onClick={() => { setState(s => completeTask(s, t.id)); setStatus(`Task "${t.title}" marked done.`); }}>Mark done</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-labelledby="lessons-h">
            <h2 id="lessons-h">Lessons</h2>
            <form className="lesson-form" onSubmit={e => { e.preventDefault(); lesson(); }}>
              <label>Lesson <input value={lessonText} maxLength={500} onChange={e => setLessonText(e.target.value)} placeholder="What should change before the real thing?" /></label>
              <div className="row">
                <label>Category <select value={lessonCat} onChange={e => setLessonCat(e.target.value as Lesson['category'])}>{CATEGORIES.map(x => <option key={x}>{x}</option>)}</select></label>
                <label>Owner <select value={lessonOwner} onChange={e => setLessonOwner(e.target.value)}>{scenario.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <button type="submit" className="btn small">Add lesson</button>
              </div>
            </form>
            <ul className="lessons">{state.lessons.map((l, i) => <li key={i} className="lesson"><span className="pill">{l.category}</span> {l.text} <span className="muted small">— {roleName(l.owner)}, +{l.atMinute}m</span></li>)}</ul>
          </section>
          <section aria-labelledby="log-h">
            <h2 id="log-h">Decision log</h2>
            {state.decisions.length === 0 ? <p className="empty">No decisions committed yet.</p> : (
              <table className="log">
                <thead><tr><th scope="col">At</th><th scope="col">Decision</th><th scope="col">SLA</th><th scope="col">Score</th></tr></thead>
                <tbody>{state.decisions.map(d => <tr key={d.decisionId}><td className="mono">+{d.atMinute}m</td><td>{d.optionLabel}</td><td className={d.breachedSla ? 'over' : 'ok'}>{d.breachedSla ? `+${d.minutesLate} late` : 'on time'}</td><td className="mono">{d.score}</td></tr>)}</tbody>
              </table>
            )}
            <button type="button" className="link" onClick={replayDemo}>Verify replay determinism ({state.log.length} actions)</button>
          </section>
        </aside>
      </main>
      <footer className="foot">Educational prototype: a deterministic inject scheduler and SLA clock over a fictional scenario. No malware, no real systems, no messaging. In-memory state resets on refresh — download the after-action report to keep it.</footer>
    </div>
  );
}
