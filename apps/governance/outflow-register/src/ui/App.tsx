import { useMemo, useState } from 'react';
import demoJson from '../fixtures/demo.json';
import { effectiveStatus, evidencePacket, exportIssues, findIssues, renewalQueue, transition, validateRegister } from '../engine/register';
import type { Agreement, AgreementStatus, Register } from '../engine/types';
import { parseBoundedJson } from '../engine/safe';
import { downloadText } from './download';

const TARGETS: Record<AgreementStatus, AgreementStatus[]> = { draft: ['active', 'terminated'], active: ['renewing', 'terminated'], renewing: ['active', 'terminated'], expired: ['renewing', 'terminated'], terminated: [] };
const VERB: Record<AgreementStatus, string> = { draft: 'Back to draft', active: 'Activate', renewing: 'Start renewal', expired: 'Mark expired', terminated: 'Terminate' };

export function App() {
  const initial = useMemo(() => { const v = validateRegister(demoJson); if (!v.ok) throw new Error(v.errors.join('; ')); return v.register; }, []);
  const [reg, setReg] = useState<Register>(initial);
  const [asOf, setAsOf] = useState(initial.asOf);
  const [selId, setSelId] = useState<string | null>('ag-07');
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ reason: '', ack: false, newEndOn: '' });

  const working = useMemo(() => ({ ...reg, asOf }), [reg, asOf]);
  const issues = useMemo(() => findIssues(working, asOf), [working, asOf]);
  const queue = useMemo(() => renewalQueue(working, asOf), [working, asOf]);
  const sel = reg.agreements.find((a) => a.id === selId) ?? null;
  const vendorOf = (id: string) => reg.vendors.find((v) => v.id === id);
  const ownerOf = (id: string | null) => reg.owners.find((o) => o.id === id) ?? null;
  const issuesFor = (a: Agreement) => issues.filter((i) => i.agreementId === a.id || reg.flows.some((f) => f.id === i.flowId && f.agreementId === a.id));
  const worst = (a: Agreement) => { const s = issuesFor(a).map((i) => i.severity); return s.includes('high') ? 'high' : s.includes('medium') ? 'medium' : s.includes('low') ? 'low' : null; };
  const sevCount = (s: 'high' | 'medium' | 'low') => issues.filter((i) => i.severity === s).length;

  const doTransition = (to: AgreementStatus) => {
    if (!sel) return;
    const r = transition(working, { agreementId: sel.id, to, reason: form.reason, acknowledgeActiveFlows: form.ack, newEndOn: form.newEndOn || undefined });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setReg({ ...r.register, asOf: reg.asOf }); setForm({ reason: '', ack: false, newEndOn: '' });
    setNotice({ tone: 'ok', text: `"${sel.title}" is now ${to}. History entry #${r.register.history.length} recorded.` });
  };
  const onImport = async (file?: File) => {
    if (!file) return;
    const p = parseBoundedJson(await file.text()); if (!p.ok) { setNotice({ tone: 'error', text: p.error }); return; }
    const v = validateRegister(p.value); if (!v.ok) { setNotice({ tone: 'error', text: 'Register rejected: ' + v.errors.slice(0, 5).join(' · ') }); return; }
    setReg(v.register); setAsOf(v.register.asOf); setSelId(v.register.agreements[0]?.id ?? null); setVendorFilter(null); setNotice({ tone: 'ok', text: `Loaded “${v.register.label}”: ${v.register.agreements.length} agreements, ${v.register.flows.length} flows.` });
  };
  const exportReg = (kind: 'json' | 'csv') => { const out = exportIssues(working, asOf); if (kind === 'json') downloadText('outflow-register.json', JSON.stringify(out.json, null, 2), 'application/json'); else downloadText('outflow-issues.csv', out.csv, 'text/csv'); setNotice({ tone: 'ok', text: `Exported register ${kind.toUpperCase()}: ${out.json.issues.length} issues, ${out.json.queue.length} in the renewal queue.` }); };
  const exportPacket = (kind: 'json' | 'md') => { if (!sel) return; const p = evidencePacket(working, sel.id, asOf); if (kind === 'json') downloadText(`packet-${sel.id}.json`, JSON.stringify(p.json, null, 2), 'application/json'); else downloadText(`packet-${sel.id}.md`, p.markdown, 'text/markdown'); setNotice({ tone: 'ok', text: `Evidence packet for "${sel.title}" exported as ${kind === 'md' ? 'Markdown' : 'JSON'}.` }); };

  // relationship map geometry
  const map = useMemo(() => {
    const W = 760, L = 20, R = 20, colW = 190, rowH = 34, top = 28;
    const sysY = new Map(reg.systems.map((s, i) => [s.id, top + i * rowH]));
    const venY = new Map(reg.vendors.map((v, i) => [v.id, top + i * rowH]));
    const H = top + Math.max(reg.systems.length, reg.vendors.length) * rowH + 8;
    const x1 = L + colW, x2 = W - R - colW;
    const links = reg.flows.filter((f) => f.active).map((f) => { const ys = sysY.get(f.systemId)!, yv = venY.get(f.vendorId)!; const sev = issues.filter((i) => i.flowId === f.id).map((i) => i.severity); const s = sev.includes('high') ? 'high' : sev.includes('medium') ? 'medium' : ''; const mx = (x1 + x2) / 2; return { f, d: `M${x1},${ys + 12} C${mx},${ys + 12} ${mx},${yv + 12} ${x2},${yv + 12}`, width: 1 + f.categories.length * 1.2, sev: s }; });
    return { W, H, L, R, colW, rowH, sysY, venY, x1, x2, links };
  }, [reg, issues]);
  const shown = reg.agreements.filter((a) => !vendorFilter || a.vendorId === vendorFilter);
  const selIssues = sel ? issuesFor(sel) : [];
  const selPriority = sel ? queue.find((q) => q.agreementId === sel.id) : null;
  const liveFlows = sel ? reg.flows.filter((f) => f.agreementId === sel.id && f.active) : [];

  return (
    <>
      <header className="mast">
        <div className="mast-row">
          <h1>Outflow Register<small>Data-sharing agreements · vendor flows · obligations · renewal cockpit — synthetic register, educational prototype, not legal advice</small></h1>
          <div className="ctl">
            <label className="field">As-of date<input type="date" value={asOf} onChange={(e) => { if (e.target.value) { setAsOf(e.target.value); setNotice({ tone: 'ok', text: `Clock set to ${e.target.value}; issues and priorities recomputed.` }); } }} /></label>
            <label className="btn ghost">Load register<input className="sr-only" type="file" accept=".json,application/json" onChange={(e) => onImport(e.target.files?.[0])} /></label>
            <button className="btn ghost" onClick={() => exportReg('csv')}>Issues CSV</button>
            <button className="btn" onClick={() => exportReg('json')}>Export register JSON</button>
          </div>
        </div>
        <div className="counts" role="list" aria-label="Register summary">
          <span role="listitem">{reg.label}</span><span role="listitem"><b>{reg.agreements.length}</b> agreements · <b>{reg.vendors.length}</b> vendors · <b>{reg.flows.filter((f) => f.active).length}</b> active flows</span>
          <span role="listitem"><span className="sev high">{sevCount('high')} high</span> <span className="sev medium">{sevCount('medium')} medium</span> <span className="sev low">{sevCount('low')} low</span> open issues as of <b>{asOf}</b></span>
        </div>
        {notice && <p className={`notice ${notice.tone === 'error' ? 'error' : ''}`} role="status">{notice.text}</p>}
      </header>

      <div className="desk">
        <div className="col">
          <section aria-labelledby="map-h">
            <h2 id="map-h">Where data leaves<span className="mono">{reg.flows.filter((f) => f.active).length} active flows</span></h2>
            <p className="note">Internal systems on the left, vendors on the right; each ribbon is an active flow, thicker for more data categories. Red ribbons carry a high-severity issue (no agreement, uncovered category, agreement ended). Select a vendor to filter the agreements below.</p>
            <div className="sheet map">
              <svg viewBox={`0 0 ${map.W} ${map.H}`} width="100%" role="group" aria-label={`Flow map: ${reg.flows.filter((f) => f.active).length} active flows from ${reg.systems.length} systems to ${reg.vendors.length} vendors`}>
                <text className="col-title" x={map.L} y={14}>Internal systems</text><text className="col-title" x={map.x2} y={14}>Vendors</text>
                {map.links.map((l) => <path key={l.f.id} className={`flow ${l.sev} ${vendorFilter && l.f.vendorId !== vendorFilter ? 'dim' : ''}`} d={l.d} strokeWidth={l.width}><title>{`${l.f.id}: ${l.f.categories.join(', ')} → ${vendorOf(l.f.vendorId)?.name}${l.sev ? ` (${l.sev} issue)` : ''}`}</title></path>)}
                {reg.systems.map((s) => <g key={s.id}><rect className="sys" x={map.L} y={map.sysY.get(s.id)!} width={map.colW} height={24} /><text x={map.L + 8} y={map.sysY.get(s.id)! + 16}>{s.name}</text></g>)}
                {reg.vendors.map((v) => <g key={v.id} className={`v ${vendorFilter === v.id ? 'sel' : ''}`} tabIndex={0} role="button" aria-pressed={vendorFilter === v.id} aria-label={`Filter by ${v.name}`} onClick={() => setVendorFilter(vendorFilter === v.id ? null : v.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVendorFilter(vendorFilter === v.id ? null : v.id); } }}>
                  <rect className="vendor" x={map.x2} y={map.venY.get(v.id)!} width={map.colW} height={24} /><text x={map.x2 + 8} y={map.venY.get(v.id)! + 16}>{v.name.length > 26 ? v.name.slice(0, 25) + '…' : v.name}</text></g>)}
              </svg>
            </div>
          </section>

          <section aria-labelledby="ag-h">
            <h2 id="ag-h">Agreements<span className="mono">{shown.length}{vendorFilter ? ` · ${vendorOf(vendorFilter)?.name}` : ''}</span>{vendorFilter && <button className="btn small outline" style={{ marginLeft: 10 }} onClick={() => setVendorFilter(null)}>Clear filter</button>}</h2>
            <div className="sheet" style={{ overflowX: 'auto' }}>
              <table className="ag">
                <thead><tr><th scope="col">Agreement</th><th scope="col">Vendor</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Ends</th><th scope="col">Categories</th><th scope="col">Issues</th></tr></thead>
                <tbody>
                  {shown.map((a) => { const eff = effectiveStatus(a, asOf); const o = ownerOf(a.ownerId); const w = worst(a); return (
                    <tr key={a.id} aria-selected={a.id === selId}>
                      <td><button className="link" onClick={() => setSelId(a.id)} aria-pressed={a.id === selId}>{a.title}</button><div className="mono">{a.id}</div></td>
                      <td>{vendorOf(a.vendorId)?.name}</td>
                      <td>{o ? <>{o.name}{o.status === 'left' && <span className="sev high" style={{ marginLeft: 6 }}>left</span>}</> : <span className="sev medium">none</span>}</td>
                      <td><span className={`status ${eff}`}>{eff}{eff !== a.status ? ` (recorded ${a.status})` : ''}</span></td>
                      <td className="mono">{a.endOn}</td>
                      <td className="mono">{a.categories.join(', ') || '—'}</td>
                      <td>{w ? <span className={`sev ${w}`}>{issuesFor(a).length} · {w}</span> : <span className="mono">0</span>}</td>
                    </tr>); })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="col right">
          <section aria-labelledby="q-h">
            <h2 id="q-h">Renewal cockpit<span className="mono">{queue.length} in queue</span></h2>
            <p className="note">Priority = expiry (≤40) + restricted categories (≤20) + active flows (≤20) + open obligations (≤15) + missing owner (10). Expand any row to see the arithmetic.</p>
            <ol className="queue">
              {queue.slice(0, 8).map((q) => { const a = reg.agreements.find((x) => x.id === q.agreementId)!; return (
                <li key={q.agreementId} className={q.agreementId === selId ? 'sel' : ''}>
                  <div className="head"><button onClick={() => setSelId(a.id)} aria-pressed={a.id === selId}>{a.title}</button><span className="score">{q.score}</span></div>
                  <div className="bars" aria-hidden="true">{q.breakdown.map((b) => { const max = { expiry: 40, 'restricted categories': 20, 'active flows': 20, 'open obligations': 15, owner: 10 }[b.factor] ?? 10; return <span key={b.factor}><i style={{ ['--w' as string]: `${(b.points / max) * 100}%` }} /></span>; })}</div>
                  <details><summary>{vendorOf(a.vendorId)?.name} · {q.daysToEnd === null ? 'ended' : `${q.daysToEnd} days left`} · breakdown</summary>
                    <dl>{q.breakdown.map((b) => <div key={b.factor} style={{ display: 'contents' }}><dt>{b.points} · {b.factor}</dt><dd>{b.note}</dd></div>)}</dl></details>
                </li>); })}
            </ol>
          </section>

          {sel && (
            <section aria-labelledby="d-h">
              <h2 id="d-h">{sel.title}</h2>
              <div className="sheet detail">
                <div>
                  <h3>Agreement</h3>
                  <dl className="kv">
                    <dt>Vendor</dt><dd>{vendorOf(sel.vendorId)?.name} · {vendorOf(sel.vendorId)?.country} · {vendorOf(sel.vendorId)?.role}</dd>
                    <dt>Owner</dt><dd>{ownerOf(sel.ownerId)?.name ?? 'none'}{ownerOf(sel.ownerId)?.status === 'left' ? ' (left)' : ''}</dd>
                    <dt>Status</dt><dd><span className={`status ${effectiveStatus(sel, asOf)}`}>{effectiveStatus(sel, asOf)}</span> recorded as {sel.status} · {sel.startOn} → {sel.endOn} · notice {sel.noticeDays} d</dd>
                    <dt>Purpose</dt><dd>{sel.purpose}</dd>
                    <dt>Categories</dt><dd className="mono">{sel.categories.join(', ') || '— none listed'}</dd>
                    <dt>Mechanism</dt><dd>{sel.transferMechanism}</dd>
                    {selPriority && <><dt>Priority</dt><dd>{selPriority.score} ({selPriority.breakdown.map((b) => `${b.factor} ${b.points}`).join(', ')})</dd></>}
                  </dl>
                </div>
                <div>
                  <h3>Obligations · {sel.obligations.filter((o) => o.evidence).length}/{sel.obligations.length} evidenced</h3>
                  {sel.obligations.length === 0 ? <p className="note">No obligations recorded.</p> : <ul className="obls">{sel.obligations.map((o) => <li key={o.id}><i className={o.evidence ? '' : 'open'} aria-hidden="true" /><span>{o.kind.replace(/_/g, ' ')} — {o.requirement}{o.evidence ? <span className="mono"> · {o.evidence.ref}, {o.evidence.on}</span> : <strong> · no evidence</strong>}</span></li>)}</ul>}
                </div>
                <div>
                  <h3>Flows under this agreement · {liveFlows.length} active</h3>
                  {reg.flows.filter((f) => f.agreementId === sel.id).length === 0 ? <p className="note">No flows reference this agreement.</p> : <ul className="obls">{reg.flows.filter((f) => f.agreementId === sel.id).map((f) => <li key={f.id}><i className={f.active && f.categories.some((c) => !sel.categories.includes(c)) ? 'open' : ''} aria-hidden="true" /><span><span className="mono">{f.id}</span> {reg.systems.find((s) => s.id === f.systemId)?.name} → {f.direction} · {f.categories.join(', ')} · {f.active ? 'active' : 'inactive'} · last {f.lastTransferOn ?? 'never'}</span></li>)}</ul>}
                </div>
                <div>
                  <h3>Open issues · {selIssues.length}</h3>
                  {selIssues.length === 0 ? <p className="note">No open issues.</p> : <ul className="issues">{selIssues.map((i) => <li key={i.id} className={i.severity}><span className="mono">{i.kind}</span> — {i.detail}</li>)}</ul>}
                </div>
                <div className="trans">
                  <h3>Change status</h3>
                  {TARGETS[sel.status].length === 0 ? <p className="note">Terminated agreements cannot change status.</p> : (
                    <>
                      <label className="note" style={{ display: 'block', marginBottom: 0 }}>Reason (required)<textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                      {sel.status === 'renewing' && <label className="note" style={{ display: 'block', marginBottom: 0 }}>New end date (to activate the renewal)<input type="date" value={form.newEndOn} onChange={(e) => setForm({ ...form, newEndOn: e.target.value })} /></label>}
                      {liveFlows.length > 0 && <label className="note" style={{ display: 'block', marginBottom: 0 }}><input type="checkbox" checked={form.ack} onChange={(e) => setForm({ ...form, ack: e.target.checked })} /> I acknowledge {liveFlows.length} active flow{liveFlows.length === 1 ? '' : 's'} must be stopped or re-papered if this agreement ends</label>}
                      <div className="row">{TARGETS[sel.status].map((t) => <button key={t} className={`btn ${t === 'terminated' ? 'outline' : 'slate'} small`} onClick={() => doTransition(t)}>{VERB[t]}</button>)}</div>
                    </>
                  )}
                </div>
                <div>
                  <h3>History · {reg.history.filter((h) => h.agreementId === sel.id).length}</h3>
                  {reg.history.filter((h) => h.agreementId === sel.id).length === 0 ? <p className="note">No status changes in this session.</p> : <ol className="hist">{reg.history.filter((h) => h.agreementId === sel.id).map((h) => <li key={h.seq}><span className="mono">#{h.seq} {h.on}</span> {h.from} → {h.to} — {h.reason}{h.note ? ` (${h.note})` : ''}</li>)}</ol>}
                </div>
                <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn small" onClick={() => exportPacket('json')}>Evidence packet JSON</button>
                  <button className="btn small outline" onClick={() => exportPacket('md')}>Evidence packet Markdown</button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      <p className="foot">Outflow Register is an educational prototype. Vendors, agreements, owners and flows are synthetic; transfer mechanisms are labels, not legal determinations. Status changes live in memory and reset on refresh — export the register or an evidence packet to keep them.</p>
    </>
  );
}
