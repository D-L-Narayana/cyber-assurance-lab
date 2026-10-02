import { useEffect, useMemo, useRef, useState } from 'react';
import { applyEvent, derive, GuardrailError, newException, prioritise, tick } from '../engine/lifecycle';
import { POLICY, POLICY_NOTE } from '../engine/policy';
import { MAX_BOARD_BYTES, validateBoard, validateBoardObject } from '../engine/validate';
import type { Board, Derived, Event, Exception, State } from '../engine/types';
import demo from '../fixtures/harbourline-board.json';
import { downloadText, readTextFile } from './files';
import { Kanban } from './Kanban';
import { Detail } from './Detail';

export type Notice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] } | null;

function loadDemo(): Board {
  const r = validateBoardObject(demo);
  if (!r.ok) throw new Error('Bundled board invalid: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.board;
}

function readHash(): string | null {
  const m = /^#\/([A-Za-z0-9_-]{1,64})$/.exec(location.hash);
  return m ? m[1] : null;
}

/** Apply time-driven transitions to every record for the board date. */
function ticked(board: Board): Board {
  return { ...board, exceptions: board.exceptions.map((e) => tick(e, board.asOf)) };
}

export default function App() {
  const [board, setBoard] = useState<Board>(() => ticked(loadDemo()));
  const [selected, setSelected] = useState<string | null>(() => readHash() ?? 'EX-107');
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded 12 synthetic exceptions and applied today\'s time-driven transitions (expiry, escalation). Everything here is fictional.' });
  const fileRef = useRef<HTMLInputElement>(null);

  const derived = useMemo(() => new Map(board.exceptions.map((e) => [e.id, derive(e, board.asOf)])), [board]);
  const ranked = useMemo(() => prioritise(board), [board]);

  useEffect(() => {
    const onHash = () => setSelected(readHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  function select(id: string | null) {
    setSelected(id);
    const target = id ? '#/' + id : '#';
    if (location.hash !== target) history.replaceState(null, '', target);
  }

  function setAsOf(asOf: string) {
    const next = ticked({ ...board, asOf });
    const moved = next.exceptions.filter((e, i) => e.state !== board.exceptions[i].state);
    setBoard(next);
    setNotice({ kind: 'info', text: `Board date set to ${asOf}.${moved.length ? ` Time moved ${moved.map((e) => `${e.id} → ${e.state}`).join(', ')}.` : ' No time-driven transitions.'}` });
  }

  function dispatch(id: string, ev: Event) {
    const e = board.exceptions.find((x) => x.id === id);
    if (!e) return;
    try {
      const next = tick(applyEvent(e, ev, board.asOf), board.asOf);
      setBoard({ ...board, exceptions: board.exceptions.map((x) => (x.id === id ? next : x)) });
      setNotice({ kind: 'success', text: `${id}: ${ev.type} by ${ev.actor.trim()} → ${next.state}.` });
    } catch (err) {
      if (err instanceof GuardrailError) setNotice({ kind: 'error', text: `${id}: ${ev.type} refused by policy (${err.reasons.length} reason${err.reasons.length === 1 ? '' : 's'}).`, details: err.reasons });
      else setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }

  function editDraft(id: string, patch: Partial<Exception>) {
    const e = board.exceptions.find((x) => x.id === id);
    if (!e) return;
    if (e.state !== 'draft') {
      setNotice({ kind: 'error', text: `${id} is ${e.state}; only drafts can be edited. Withdraw and raise a new request to change the terms.` });
      return;
    }
    const next = { ...e, ...patch };
    const check = validateBoardObject({ ...board, exceptions: board.exceptions.map((x) => (x.id === id ? next : x)) });
    if (!check.ok) {
      setNotice({ kind: 'error', text: 'Edit rejected.', details: check.issues.map((i) => `${i.path}: ${i.message}`) });
      return;
    }
    setBoard(check.board);
  }

  function addDraft() {
    const n = board.exceptions.length + 1;
    const id = `EX-${100 + n}`;
    const e = newException({ id, title: 'New exception request', policyRef: 'SEC-POL-', riskLevel: 'moderate', requester: 'requester', owner: '', compensatingControls: [], justification: '', requestedOn: board.asOf, startOn: board.asOf, expiresOn: board.asOf, remediation: { plan: '', dueOn: board.asOf, status: 'planned' } });
    setBoard({ ...board, exceptions: [...board.exceptions, e] });
    select(id);
    setNotice({ kind: 'info', text: `Draft ${id} created. Fill it in; submit will list every policy guardrail it fails.` });
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_BOARD_BYTES);
      const r = validateBoard(text);
      if (!r.ok) {
        setNotice({ kind: 'error', text: `Import rejected: ${r.issues.length} issue(s). Nothing changed.`, details: r.issues.map((i) => `${i.path || 'board'} — ${i.message}`) });
        return;
      }
      setBoard(ticked(r.board));
      select(r.board.exceptions[0]?.id ?? null);
      setNotice({ kind: 'success', text: `Imported ${r.board.exceptions.length} exceptions as of ${r.board.asOf} and applied time-driven transitions.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const sel = selected ? board.exceptions.find((e) => e.id === selected) : undefined;
  const selD: Derived | undefined = sel ? derived.get(sel.id) : undefined;
  const stamp = board.asOf.replace(/-/g, '');
  const counts = (s: State) => board.exceptions.filter((e) => e.state === s).length;

  return (
    <div className="app">
      <a className="skip" href="#board">Skip to board</a>
      <header className="top">
        <div className="brand">
          <h1>Graceline</h1>
          <p className="brand__sub">Policy exceptions that do not quietly disappear: a guarded lifecycle with approval quorum, separation of duties, duration limits, expiry escalation and closure evidence. Educational prototype on synthetic records.</p>
        </div>
        <div className="controls">
          <label><span>Board date</span><input type="date" value={board.asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>
          <div className="btns" role="group" aria-label="Board actions">
            <button type="button" onClick={() => { setBoard(ticked(loadDemo())); select('EX-107'); setNotice({ kind: 'info', text: 'Reloaded the synthetic board.' }); }}>Load demo board</button>
            <button type="button" className="primary" onClick={addDraft}>New request</button>
            <button type="button" onClick={() => fileRef.current?.click()}>Import board</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
            <button type="button" onClick={() => downloadText(`graceline-board-${stamp}.json`, JSON.stringify(board, null, 2))}>Export board</button>
            <button type="button" onClick={() => downloadText(`graceline-register-${stamp}.json`, JSON.stringify({ schema: 'graceline.register/1', asOf: board.asOf, policyNote: POLICY_NOTE, policy: POLICY, ranked, exceptions: board.exceptions }, null, 2))}>Export risk register</button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.text}</p>
          {notice.details && <ul>{notice.details.slice(0, 12).map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}

      <section className="board" id="board" aria-labelledby="board-h">
        <div className="pane-head">
          <h2 id="board-h">Lifecycle board</h2>
          <p className="small muted">{counts('active')} active · {[...derived.values()].filter((d) => d.expiring).length} expiring · {counts('expired')} expired · {counts('escalated')} escalated · {counts('under-review')} under review. Each card's ribbon runs from start to expiry; the marker is today.</p>
        </div>
        <Kanban board={board} derived={derived} selected={selected} onSelect={select} />
      </section>

      <div className="lower">
        <section className="detail" aria-live="polite">
          {sel && selD ? (
            <Detail key={sel.id + sel.state + sel.history.length} e={sel} d={selD} asOf={board.asOf} onEvent={(ev) => dispatch(sel.id, ev)} onEdit={(patch) => editDraft(sel.id, patch)} onJumpAway={() => select(null)} />
          ) : (
            <div className="empty-detail">
              <h2>No exception selected</h2>
              <p>Select a card to read its decision history, see the quorum and guardrails, and act on it (approve, reject, renew, update remediation, close).</p>
            </div>
          )}
        </section>

        <aside className="priority" aria-labelledby="prio-h">
          <h2 id="prio-h">Attention order</h2>
          <p className="small muted">priority = risk weight × state factor × compensating relief + overdue days / 15</p>
          <ol className="plist">
            {ranked.filter((d) => d.priority > 0).map((d) => {
              const e = board.exceptions.find((x) => x.id === d.id)!;
              return (
                <li key={d.id}>
                  <button type="button" className={`prow ${selected === d.id ? 'is-selected' : ''}`} onClick={() => select(d.id)} aria-pressed={selected === d.id}>
                    <span className="prow__p mono">{d.priority.toFixed(2)}</span>
                    <span className="prow__t">{e.title}</span>
                    <span className="prow__m small">
                      <span className={`risk risk--${e.riskLevel}`}>{e.riskLevel}</span> · <span className={`st st--${d.state}`}>{d.expiring ? 'expiring' : d.state}</span>
                      {d.overdueDays > 0 && <span className="bad"> · {d.overdueDays} d overdue</span>}
                      {d.guardrails.length > 0 && <span className="bad"> · policy violation</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      <footer className="foot">
        <p>{POLICY_NOTE} Session state is memory-only; export the board to keep it. Notifications are shown in-app only; nothing is sent anywhere.</p>
      </footer>
    </div>
  );
}
