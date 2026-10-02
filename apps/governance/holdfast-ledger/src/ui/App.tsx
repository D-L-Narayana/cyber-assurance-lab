import { useEffect, useMemo, useState } from 'react';
import demoJson from '../fixtures/demo.json';
import { computeDue, executePlan, exportAudit, planDisposal, reconcile, validateFixture, verifyChain } from '../engine/ledger';
import type { ChainVerification, DueItem, Fixture, Plan, Receipt } from '../engine/types';
import { parseBoundedJson } from '../engine/safe';
import { downloadText } from './download';

const STATE_LABEL: Record<DueItem['state'], string> = { retained: 'Retained', due: 'Due today', overdue: 'Overdue', held: 'On hold', disposed: 'Disposed', unscheduled: 'No schedule' };
const STATE_FILL: Record<DueItem['state'], string> = { retained: '#4f6f63', due: '#d9a441', overdue: '#e07b3a', held: 'url(#hatch)', disposed: '#3fae98', unscheduled: '#6c6c7a' };

export function App() {
  const initial = useMemo(() => { const v = validateFixture(demoJson); if (!v.ok) throw new Error(v.errors.join('; ')); return v.fixture; }, []);
  const [fixture, setFixture] = useState<Fixture>(initial);
  const [asOf, setAsOf] = useState(initial.asOf);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Plan | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [tampered, setTampered] = useState<Receipt[] | null>(null);
  const [verdict, setVerdict] = useState<(ChainVerification & { on: string }) | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const working = { ...fixture, asOf };
  const due = useMemo(() => computeDue(working, asOf), [fixture, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => { const c: Record<DueItem['state'], number> = { retained: 0, due: 0, overdue: 0, held: 0, disposed: 0, unscheduled: 0 }; for (const d of due) c[d.state]++; return c; }, [due]);
  useEffect(() => { setCurrent(null); }, [asOf, fixture]);
  const shown = tampered ?? receipts;

  const generate = async () => {
    const p = await planDisposal(working, asOf);
    setCurrent(p);
    const dup = plans.find((x) => x.id === p.id);
    setNotice(dup ? { tone: 'warn', text: `Identical inputs → identical plan ${p.id.slice(0, 12)}…; nothing new to execute.` } : { tone: 'ok', text: `Plan ${p.id.slice(0, 12)}… : ${p.counts.dispose} to dispose, ${p.counts.skip} blocked by holds.` });
  };
  const execute = async () => {
    if (!current) return;
    const r = await executePlan(current, working, receipts);
    if (r.skippedAlreadyExecuted) { setNotice({ tone: 'warn', text: 'This plan was already executed; execution is idempotent and nothing changed.' }); return; }
    if (r.rejectedStale) { setCurrent(null); setNotice({ tone: 'bad', text: r.reason ?? 'Stale plan rejected.' }); return; }
    setReceipts(r.receipts); setFixture({ ...fixture, records: r.records }); setPlans((ps) => ps.some((p) => p.id === current.id) ? ps : [...ps, current]); setTampered(null); setVerdict(null);
    setNotice({ tone: 'ok', text: `Simulated ${r.receipts.length - receipts.length} disposals; ${r.receipts.length} receipts in the chain.` });
  };
  const verify = async () => { const v = await verifyChain(shown); setVerdict({ ...v, on: tampered ? 'tampered copy' : 'ledger' }); };
  const tamper = () => { if (receipts.length < 2) return; const i = Math.floor(receipts.length / 2); setTampered(receipts.map((r, k) => k === i ? { ...r, action: r.action === 'delete' ? 'anonymise' : 'delete' } : r)); setVerdict(null); setNotice({ tone: 'warn', text: `Demo: flipped the action on receipt #${receipts[i]!.seq} in a copy of the ledger. Verify to see detection.` }); };
  const toggleHold = (id: string) => {
    setFixture({ ...fixture, holds: fixture.holds.map((h) => h.id !== id ? h : { ...h, releasedOn: h.releasedOn === null || Date.parse(h.releasedOn) > Date.parse(asOf) ? asOf : null }) });
    setNotice({ tone: 'ok', text: `Hold ${id} toggled as of ${asOf}; due states recomputed and the next plan id will differ.` });
  };
  const onImport = async (file?: File) => {
    if (!file) return;
    const p = parseBoundedJson(await file.text()); if (!p.ok) { setNotice({ tone: 'bad', text: p.error }); return; }
    const v = validateFixture(p.value); if (!v.ok) { setNotice({ tone: 'bad', text: 'Fixture rejected: ' + v.errors.slice(0, 5).join(' · ') }); return; }
    setFixture(v.fixture); setAsOf(v.fixture.asOf); setPlans([]); setReceipts([]); setTampered(null); setVerdict(null); setNotice({ tone: 'ok', text: `Loaded “${v.fixture.label}” (${v.fixture.records.length} records). Ledger reset.` });
  };
  const doExport = async (kind: 'json' | 'receipts' | 'records') => {
    const out = await exportAudit(working, plans, receipts);
    if (kind === 'json') downloadText('holdfast-audit.json', JSON.stringify(out.json, null, 2), 'application/json');
    else if (kind === 'receipts') downloadText('holdfast-receipts.csv', out.csv, 'text/csv');
    else downloadText('holdfast-records.csv', out.csvRecords, 'text/csv');
    setNotice({ tone: 'ok', text: `Exported ${kind}. Chain ${out.json.chain.ok ? 'verified' : 'NOT verified'}: ${out.json.chain.note}` });
  };

  // calendar geometry
  const cal = useMemo(() => {
    const recs = fixture.records.map((r) => ({ r, d: due.find((x) => x.recordId === r.id)! }));
    const starts = recs.map((x) => Date.parse(x.r.triggerDate));
    const ends = recs.map((x) => x.d.dueOn ? Date.parse(x.d.dueOn) : Date.parse(x.r.triggerDate) + 365 * 86400000);
    const min = Math.min(...starts, Date.parse(asOf) - 180 * 86400000), max = Math.max(...ends, Date.parse(asOf) + 180 * 86400000);
    const W = 900, L = 150, R = 20, rowH = 9, gap = 2;
    const x = (ms: number) => L + ((ms - min) / (max - min)) * (W - L - R);
    const groups = fixture.systems.map((s) => ({ s, rows: recs.filter((x) => x.r.systemId === s.id) }));
    let y = 24; const placed: { x1: number; x2: number; y: number; rec: typeof recs[number] }[] = []; const labels: { y: number; text: string }[] = [];
    for (const g of groups) { labels.push({ y: y + 6, text: `${g.s.name} (${g.rows.length})` }); y += 12; for (const rec of g.rows) { placed.push({ x1: x(Date.parse(rec.r.triggerDate)), x2: x(rec.d.dueOn ? Date.parse(rec.d.dueOn) : Date.parse(rec.r.triggerDate) + 365 * 86400000), y, rec }); y += rowH + gap; } y += 10; }
    const years: { x: number; label: string }[] = [];
    for (let yr = new Date(min).getUTCFullYear(); yr <= new Date(max).getUTCFullYear() + 1; yr++) { const ms = Date.parse(`${yr}-01-01`); if (ms >= min && ms <= max) years.push({ x: x(ms), label: String(yr) }); }
    return { W, H: y + 4, L, placed, labels, years, todayX: x(Date.parse(asOf)), rowH };
  }, [fixture, due, asOf]);
  const focused = focus ? { r: fixture.records.find((r) => r.id === focus)!, d: due.find((d) => d.recordId === focus)! } : null;
  const schedule = focused ? fixture.schedules.find((s) => s.id === focused.d.scheduleId) : null;

  return (
    <>
      <header className="mast">
        <div className="mast-row">
          <h1>Holdfast Ledger<small>Retention · legal holds · simulated disposal with hash-chained receipts · synthetic data, educational prototype</small></h1>
          <div className="ctl">
            <label className="field">As-of date<input type="date" value={asOf} onChange={(e) => { if (e.target.value) { setAsOf(e.target.value); setNotice({ tone: 'ok', text: `Clock moved to ${e.target.value}; due states recomputed.` }); } }} /></label>
            <label className="btn ghost">Load fixture<input className="sr-only" type="file" accept=".json,application/json" onChange={(e) => onImport(e.target.files?.[0])} /></label>
            <button className="btn ghost" onClick={() => doExport('records')}>Records CSV</button>
            <button className="btn ghost" onClick={() => doExport('receipts')}>Receipts CSV</button>
            <button className="btn" onClick={() => doExport('json')}>Export audit JSON</button>
          </div>
        </div>
        <div className="states" role="list" aria-label="Records by state">
          {(Object.keys(counts) as DueItem['state'][]).map((s) => <span role="listitem" key={s}><i className={`st-${s}`} aria-hidden="true" />{STATE_LABEL[s]} <b>{counts[s]}</b></span>)}
          <span>{fixture.label} · {fixture.records.length} records · {fixture.holds.length} holds</span>
        </div>
        {notice && <p className={`verdict ${notice.tone}`} role="status">{notice.text}</p>}
      </header>

      <div className="grid">
        <div className="col">
          <section aria-labelledby="cal-h">
            <h2 id="cal-h">Retention calendar</h2>
            <p className="note">Each bar runs from the record's trigger event to the end of its retention period. Hatched bars are blocked by an active hold. The brass dashed line is the as-of date; move it to see states change.</p>
            <div className="calendar">
              <svg viewBox={`0 0 ${cal.W} ${cal.H}`} width="100%" role="img" aria-label={`Retention calendar: ${counts.overdue} overdue, ${counts.due} due today, ${counts.held} on hold, ${counts.retained} retained`}>
                <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#5b2a21" /><rect width="3" height="6" fill="#c4573f" /></pattern></defs>
                {cal.years.map((y) => <g key={y.label}><line x1={y.x} x2={y.x} y1={14} y2={cal.H} stroke="#2a4a3f" /><text x={y.x + 3} y={11}>{y.label}</text></g>)}
                {cal.labels.map((l) => <text key={l.text} className="sys" x={6} y={l.y}>{l.text}</text>)}
                {cal.placed.map((p) => (
                  <rect key={p.rec.r.id} className="bar" x={p.x1} y={p.y} width={Math.max(2, p.x2 - p.x1)} height={cal.rowH} fill={STATE_FILL[p.rec.d.state]} opacity={p.rec.d.state === 'disposed' ? 0.5 : 1} tabIndex={0}
                    onClick={() => setFocus(p.rec.r.id)} onFocus={() => setFocus(p.rec.r.id)}>
                    <title>{`${p.rec.r.id} · ${p.rec.r.category} · ${STATE_LABEL[p.rec.d.state]}${p.rec.d.dueOn ? ` · due ${p.rec.d.dueOn}` : ''}`}</title>
                  </rect>
                ))}
                <line className="today" x1={cal.todayX} x2={cal.todayX} y1={14} y2={cal.H} />
              </svg>
              <div className="legend-note">{focused ? <><span className="mono">{focused.r.id}</span> · {focused.r.category} · subject <span className="mono">{focused.r.subjectRef}</span> · trigger {focused.r.triggerDate} · {schedule ? `${schedule.name}: ${schedule.retainDays} days after ${schedule.trigger} → ${schedule.action}` : 'no schedule covers this category'} · <strong>{STATE_LABEL[focused.d.state]}</strong>{focused.d.dueOn ? ` (due ${focused.d.dueOn}${focused.d.daysOverdue ? `, ${focused.d.daysOverdue} days ago` : ''})` : ''}{focused.d.holdIds.length ? ` · holds: ${focused.d.holdIds.join(', ')}` : ''}</> : 'Select a bar for details.'}</div>
            </div>
            <details className="fallback">
              <summary>Table view of all {fixture.records.length} records</summary>
              <table className="plain"><thead><tr><th>Record</th><th>System</th><th>Category</th><th>Trigger</th><th>Due</th><th>State</th><th>Holds</th></tr></thead>
                <tbody>{fixture.records.map((r) => { const d = due.find((x) => x.recordId === r.id)!; return <tr key={r.id}><td className="mono">{r.id}</td><td>{r.systemId}</td><td>{r.category}</td><td className="mono">{r.triggerDate}</td><td className="mono">{d.dueOn ?? '—'}</td><td>{STATE_LABEL[d.state]}{d.daysOverdue ? ` (+${d.daysOverdue}d)` : ''}</td><td className="mono">{d.holdIds.join(', ')}</td></tr>; })}</tbody></table>
            </details>
          </section>

          <section aria-labelledby="plan-h">
            <h2 id="plan-h">Disposal plan</h2>
            <p className="note">A plan lists every record whose retention has ended as of the clock. Records under an active hold are kept and the hold is named. The plan id is a SHA-256 of its inputs, so re-planning the same situation yields the same id and executing it twice is a no-op.</p>
            <div className="actions"><button className="btn" onClick={generate}>Generate plan for {asOf}</button><button className="btn teal" onClick={execute} disabled={!current || current.counts.dispose === 0}>Execute plan (simulated)</button></div>
            {current ? (
              <>
                <p className="plan-id">plan {current.id}</p>
                <table className="plain"><thead><tr><th>Record</th><th>Action</th><th>Decision</th><th>Reason</th></tr></thead>
                  <tbody>{current.items.map((i) => <tr key={i.recordId}><td className="mono">{i.recordId}</td><td>{i.action}</td><td><span className={`tag ${i.decision}`}>{i.decision}</span></td><td>{i.reason}</td></tr>)}</tbody></table>
                {current.items.length === 0 && <p className="note">Nothing is due as of {asOf}.</p>}
              </>
            ) : <p className="note">No plan generated for this clock yet.</p>}
            {plans.length > 0 && <p className="note">{plans.length} plan{plans.length > 1 ? 's' : ''} executed in this session: {plans.map((p) => <span key={p.id} className="mono">{p.id.slice(0, 10)}… ({reconcile(p, receipts).ok ? 'reconciled' : 'MISMATCH'}) </span>)}</p>}
          </section>
        </div>

        <div className="col right">
          <section aria-labelledby="hold-h">
            <h2 id="hold-h">Legal holds<span className="mono">{fixture.holds.filter((h) => h.releasedOn === null || Date.parse(h.releasedOn) > Date.parse(asOf)).length} active</span></h2>
            <ul className="holds">
              {fixture.holds.map((h) => { const active = Date.parse(h.placedOn) <= Date.parse(asOf) && (h.releasedOn === null || Date.parse(h.releasedOn) > Date.parse(asOf)); return (
                <li key={h.id} className={active ? '' : 'released'}>
                  <div className="row"><strong>{h.name}</strong><button className="btn hold" onClick={() => toggleHold(h.id)}>{active ? 'Release as of ' + asOf : 'Reinstate'}</button></div>
                  <span className="mono">{h.id} · placed {h.placedOn}{h.releasedOn ? ` · released ${h.releasedOn}` : ''} · {h.authority}</span>
                  <span className="mono">scope {Object.entries(h.scope).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(' ')}</span>
                </li>); })}
            </ul>
          </section>

          <section aria-labelledby="chain-h">
            <h2 id="chain-h">Receipt chain<span className="mono">{shown.length} receipts{tampered ? ' · TAMPERED COPY' : ''}</span></h2>
            <p className="note">Every simulated disposal appends a receipt whose hash covers its content and the previous receipt's hash. Verification recomputes the chain from genesis.</p>
            <div className="actions">
              <button className="btn teal" onClick={verify} disabled={shown.length === 0}>Verify chain</button>
              <button className="btn ghost" onClick={tamper} disabled={receipts.length < 2 || !!tampered}>Tamper demo</button>
              <button className="btn ghost" onClick={() => { setTampered(null); setVerdict(null); }} disabled={!tampered}>Restore ledger</button>
            </div>
            {verdict && <p className={`verdict ${verdict.ok ? 'ok' : 'bad'}`} role="status">{verdict.ok ? `Chain intact: ${verdict.checked} receipts verified on the ${verdict.on}.` : `Chain broken at receipt #${verdict.brokenAt} on the ${verdict.on}: ${verdict.reason}`}</p>}
            {shown.length === 0 ? <p className="note">No receipts yet. Generate and execute a plan.</p> : (
              <ol className="chain">
                {shown.map((r) => <li key={r.seq} className={verdict && !verdict.ok && verdict.brokenAt === r.seq ? 'broken' : ''}><span className="dot">{r.seq}</span><div><div><span className="mono">{r.recordId}</span> · {r.action} · {r.executedOn} · plan <span className="mono">{r.planId.slice(0, 8)}…</span></div><div className="hash">hash {r.hash.slice(0, 32)}… ← prev {r.prevHash.slice(0, 16)}…</div></div></li>)}
              </ol>
            )}
          </section>
        </div>
      </div>
      <p className="foot">Holdfast Ledger is an educational prototype. All records, schedules and holds are synthetic; "disposal" flips a status flag in memory and nothing outside this tab is touched. Retention bases are placeholder policy text, not legal advice. State resets on refresh — export the audit JSON to keep it.</p>
    </>
  );
}
