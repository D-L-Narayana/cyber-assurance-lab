import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import demoJson from './fixtures/demo-catalog.json';
import type { Catalog, Finding, FindingCode, RetentionException, Severity } from './engine/types';
import { DEFAULT_LIMITS, findingsToCsv, parseCatalog, serializeCatalog } from './engine/catalogIO';
import { buildGraph } from './engine/graph';
import { runChecks, effectiveRetentionDays, MAX_EXCEPTION_TERM_DAYS } from './engine/checks';
import { retentionReviews } from './engine/review';
import type { NormalisationNote } from './engine/types';
import { LineageMap } from './ui/LineageMap';

function loadDemo(): { catalog: Catalog; notes: NormalisationNote[] } {
  const r = parseCatalog(JSON.stringify(demoJson));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return { catalog: r.catalog, notes: r.notes };
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export function App() {
  const initial = useMemo(loadDemo, []);
  const [catalog, setCatalog] = useState<Catalog>(initial.catalog);
  const [notes, setNotes] = useState<NormalisationNote[]>(initial.notes);
  const [selected, setSelected] = useState<string | null>('crm');
  const [sevFilter, setSevFilter] = useState<Severity | ''>('');
  const [codeFilter, setCodeFilter] = useState<FindingCode | ''>('');
  const [showAccepted, setShowAccepted] = useState(true);
  const [status, setStatus] = useState('Demo catalog loaded: synthetic systems, owners and flows. In-memory only; refresh resets.');
  const [source, setSource] = useState<'demo' | 'imported'>('demo');
  const [acceptTarget, setAcceptTarget] = useState<Finding | null>(null);

  const graph = useMemo(() => buildGraph(catalog), [catalog]);
  const findings = useMemo(() => runChecks(catalog, graph, catalog.asOf), [catalog, graph]);
  const reviews = useMemo(() => retentionReviews(catalog, catalog.asOf), [catalog]);
  const open = findings.filter((f) => !f.accepted);
  const systemsById = new Map(catalog.systems.map((s) => [s.id, s]));
  const ownersById = new Map(catalog.owners.map((o) => [o.id, o]));
  const selectedSystem = selected ? systemsById.get(selected) : undefined;
  const selectedElements = catalog.elements.filter((e) => e.systemId === selected);
  const selectedFindings = findings.filter((f) => f.systemId === selected);
  const reviewByElement = new Map(reviews.map((r) => [r.elementId, r]));

  const visible = findings.filter((f) => (!sevFilter || f.severity === sevFilter) && (!codeFilter || f.code === codeFilter) && (showAccepted || !f.accepted));
  const codes = Array.from(new Set(findings.map((f) => f.code))).sort();

  function acceptException(f: Finding, input: { rationale: string; approvedBy: string; expiresOn: string }) {
    // Element findings keep the legacy `elementId` alongside `subject` so exports stay readable by older importers;
    // flow findings (PURPOSE_DRIFT, UNMAPPED_TRANSFER, DANGLING_FLOW) carry only the subject. Ids skip any `ex-NNN`
    // already present so a re-import never fails on a duplicate id.
    const kind = f.subject.kind === 'flow' ? 'flow' : 'element';
    const used = new Set(catalog.exceptions.map((x) => x.id));
    let n = catalog.exceptions.length + 1;
    let id = `ex-${String(n).padStart(3, '0')}`;
    while (used.has(id)) { n += 1; id = `ex-${String(n).padStart(3, '0')}`; }
    const ex: RetentionException = { id, ...(kind === 'element' ? { elementId: f.subject.id } : {}), subject: { kind, id: f.subject.id }, acceptsFinding: f.code, rationale: input.rationale, approvedBy: input.approvedBy, approvedOn: catalog.asOf, expiresOn: input.expiresOn, status: 'approved' };
    setCatalog({ ...catalog, exceptions: [...catalog.exceptions, ex] });
    setAcceptTarget(null);
    setStatus(`Exception ${ex.id} recorded for ${kind} ${f.subject.id} (${f.code}); expires ${input.expiresOn}.`);
  }

  function markReviewed(elementId: string) {
    setCatalog({ ...catalog, elements: catalog.elements.map((e) => (e.id === elementId ? { ...e, lastReviewedOn: catalog.asOf } : e)) });
    setStatus(`${elementId} marked as reviewed on ${catalog.asOf}.`);
  }

  return (
    <>
      <header className="masthead">
        <h1>Tenure <small>data inventory &amp; retention graph</small></h1>
        <div className="tools" role="toolbar" aria-label="Catalog controls">
          <label>As of <input type="date" value={catalog.asOf} onChange={(e) => { if (e.target.value) setCatalog({ ...catalog, asOf: e.target.value }); }} /></label>
          <ImportDialog onImport={(c, n, w) => { setCatalog(c); setNotes(n); setSource('imported'); setSelected(c.systems[0]?.id ?? null); setStatus(`Imported ${c.systems.length} systems, ${c.elements.length} elements, ${c.flows.length} flows; ${n.length} normalisation note(s)${w.length ? `, ${w.length} warning(s)` : ''}.`); }} />
          <button type="button" className="btn btn-dark" onClick={() => download(`tenure-catalog-${catalog.asOf}.json`, serializeCatalog(catalog), 'application/json')}>Export catalog</button>
          <button type="button" className="btn btn-dark" onClick={() => download(`tenure-findings-${catalog.asOf}.json`, JSON.stringify({ schema: 'tenure.findings', version: 1, asOf: catalog.asOf, generatedAt: new Date().toISOString(), summary: { total: findings.length, open: open.length, accepted: findings.length - open.length }, findings }, null, 2), 'application/json')}>Export findings JSON</button>
          <button type="button" className="btn btn-dark" onClick={() => download(`tenure-findings-${catalog.asOf}.csv`, findingsToCsv(findings), 'text/csv')}>Export CSV</button>
          <button type="button" className="btn btn-dark" onClick={() => { const d = loadDemo(); setCatalog(d.catalog); setNotes(d.notes); setSource('demo'); setSelected('crm'); setStatus('Demo catalog reloaded.'); }}>Reset demo</button>
        </div>
      </header>
      <p className="disclaimer">Educational prototype. Consistency checks over a synthetic inventory; no live system is discovered or scanned. Retention periods and legal references in the fixture are placeholders, not advice.</p>

      <div className="atlas">
        <LineageMap graph={graph} findings={findings} selectedId={selected} onSelect={(id) => { setSelected(id); setStatus(`${systemsById.get(id)?.name ?? id} selected.`); }} />
        <aside className="inspector" aria-labelledby="insp-h">
          {selectedSystem ? (
            <>
              <h2 id="insp-h">{selectedSystem.name}</h2>
              <dl className="facts">
                <dt>Owner</dt><dd>{selectedSystem.ownerId ? (() => { const o = ownersById.get(selectedSystem.ownerId); return o ? <>{o.name} · {o.team}{!o.active && <> <span className="pill pill-high">inactive{o.leftOn ? ` since ${o.leftOn}` : ''}</span></>}</> : <span className="pill pill-high">unknown owner {selectedSystem.ownerId}</span>; })() : <span className="pill pill-medium">no owner</span>}</dd>
                <dt>Region</dt><dd>{selectedSystem.region}</dd>
                <dt>Hosting</dt><dd>{selectedSystem.hosting}{selectedSystem.vendor ? ` · ${selectedSystem.vendor}` : ''}</dd>
                <dt>Purposes</dt><dd>{selectedSystem.purposes.join(', ')}</dd>
                <dt>Flows</dt><dd>{graph.nodes.find((n) => n.id === selected)?.inbound ?? 0} in · {graph.nodes.find((n) => n.id === selected)?.outbound ?? 0} out</dd>
              </dl>
              <h3>Elements ({selectedElements.length})</h3>
              <div className="scroll" style={{ maxHeight: 260 }} tabIndex={0} role="region" aria-label="Elements in the selected system">
                <table>
                  <thead><tr><th scope="col">Element</th><th scope="col">Category</th><th scope="col">Retention</th><th scope="col">Review</th></tr></thead>
                  <tbody>
                    {selectedElements.map((e) => {
                      const days = effectiveRetentionDays(e, catalog.schedules);
                      const r = reviewByElement.get(e.id);
                      return (
                        <tr key={e.id}>
                          <td>{e.name}<br /><span className="mono" style={{ color: 'var(--mute)' }}>{e.id}</span></td>
                          <td>{e.category}{e.sensitivity >= 4 ? ' · S4' : ''}</td>
                          <td>{days === undefined ? <span className="pill pill-high">none</span> : <>{days} d{e.retentionDaysOverride !== undefined ? <span className="why">override</span> : <span className="why">{catalog.schedules.find((s) => s.id === e.scheduleId)?.trigger}</span>}</>}</td>
                          <td>{r ? <span className={`pill pill-${r.status}`}>{r.status}</span> : '—'}</td>
                        </tr>
                      );
                    })}
                    {selectedElements.length === 0 && <tr><td colSpan={4}>No elements recorded for this system.</td></tr>}
                  </tbody>
                </table>
              </div>
              <h3>Findings ({selectedFindings.filter((f) => !f.accepted).length} open, {selectedFindings.filter((f) => f.accepted).length} accepted)</h3>
              {selectedFindings.length === 0 ? <p style={{ margin: 0, color: 'var(--mute)' }}>No findings touch this system.</p> : (
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                  {selectedFindings.map((f) => <li key={f.id} style={{ fontSize: 13 }}><span className={`pill pill-${f.accepted ? 'accepted' : f.severity}`}>{f.accepted ? 'accepted' : f.severity}</span> <span className="mono">{f.code}</span><br />{f.message}</li>)}
                </ul>
              )}
            </>
          ) : <p>Select a system on the map.</p>}
        </aside>
      </div>

      <Tabs.Root defaultValue="findings" className="tabs">
        <Tabs.List className="tablist" aria-label="Inventory views">
          <Tabs.Trigger className="tab" value="findings">Findings ({open.length} open)</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="reviews">Retention review calendar ({reviews.filter((r) => r.status === 'overdue').length} overdue)</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="inventory">Inventory table</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="notes">Normalisation notes ({notes.length})</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="findings" className="tabpanel">
          <h2>Consistency findings</h2>
          <p className="lead">Each finding explains why it matters. Element- and flow-level findings (purpose drift, unmapped transfers and dangling flows included) can be accepted with a time-boxed exception approved by an active owner; accepted findings stay visible and lapse when the exception expires.</p>
          <div className="summary">{SEVERITIES.map((s) => <span key={s}><span className={`pill pill-${s}`}>{s}</span> {open.filter((f) => f.severity === s).length} open</span>)}<span><span className="pill pill-accepted">accepted</span> {findings.length - open.length}</span></div>
          <div className="filters">
            <label>Severity<select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as Severity | '')}><option value="">All</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Code<select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value as FindingCode | '')}><option value="">All</option>{codes.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={showAccepted} onChange={(e) => setShowAccepted(e.target.checked)} /> show accepted</label>
          </div>
          <div className="scroll" tabIndex={0} role="region" aria-label="Findings table">
            <table>
              <thead><tr><th scope="col">Severity</th><th scope="col">Code</th><th scope="col">System</th><th scope="col">Finding</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={5}>No findings match the current filters.</td></tr>}
                {visible.map((f) => (
                  <tr key={f.id} className={f.accepted ? 'accepted' : ''}>
                    <td><span className={`pill pill-${f.accepted ? 'accepted' : f.severity}`}>{f.accepted ? `accepted · ${f.exceptionId}` : f.severity}</span></td>
                    <td className="mono">{f.code}</td>
                    <td>{f.systemId ? <button type="button" className="rowbtn" onClick={() => { setSelected(f.systemId!); window.scrollTo({ top: 0 }); }}>{systemsById.get(f.systemId)?.name ?? f.systemId}</button> : '—'}</td>
                    <td>{f.message}<span className="why">{f.why}</span></td>
                    <td>{(f.subject.kind === 'element' || f.subject.kind === 'flow') && !f.accepted && f.code !== 'REVIEW_OVERDUE' && f.code !== 'ORPHAN_ELEMENT' ? <button type="button" className="btn btn-sm" onClick={() => setAcceptTarget(f)}>Accept with exception</button> : f.code === 'REVIEW_OVERDUE' ? <button type="button" className="btn btn-sm" onClick={() => markReviewed(f.subject.id)}>Mark reviewed</button> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="reviews" className="tabpanel">
          <h2>Retention review calendar</h2>
          <p className="lead">Each element's schedule sets a review cadence. Items are due when the cadence has elapsed since the last review; "never reviewed" items have no date on record.</p>
          <div className="summary">{(['overdue', 'never-reviewed', 'due-soon', 'current'] as const).map((s) => <span key={s}><span className={`pill pill-${s}`}>{s}</span> {reviews.filter((r) => r.status === s).length}</span>)}</div>
          <div className="scroll" tabIndex={0} role="region" aria-label="Review calendar table">
            <table>
              <thead><tr><th scope="col">Status</th><th scope="col">Element</th><th scope="col">System</th><th scope="col">Retention</th><th scope="col">Cadence</th><th scope="col">Last reviewed</th><th scope="col">Next due</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.elementId}>
                    <td><span className={`pill pill-${r.status}`}>{r.status}{r.daysUntilDue !== undefined && r.status === 'overdue' ? ` ${-r.daysUntilDue} d` : ''}</span></td>
                    <td className="mono">{r.elementId}</td>
                    <td>{systemsById.get(r.systemId)?.name ?? r.systemId}</td>
                    <td>{r.effectiveRetentionDays} d</td>
                    <td>{r.reviewEveryDays} d</td>
                    <td>{r.lastReviewedOn ?? '—'}</td>
                    <td>{r.nextReviewOn ?? '—'}</td>
                    <td>{r.status === 'current' ? '—' : <button type="button" className="btn btn-sm" onClick={() => markReviewed(r.elementId)}>Mark reviewed today</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="inventory" className="tabpanel">
          <h2>Inventory table</h2>
          <p className="lead">The full inventory as a table, for screen readers and spreadsheets: every element with its system, owner, category, purposes and effective retention.</p>
          <div className="scroll" tabIndex={0} role="region" aria-label="Full inventory table">
            <table>
              <thead><tr><th scope="col">System</th><th scope="col">Owner</th><th scope="col">Region</th><th scope="col">Element</th><th scope="col">Category</th><th scope="col">Sens.</th><th scope="col">Purposes</th><th scope="col">Retention (d)</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {catalog.elements.map((e) => {
                  const s = systemsById.get(e.systemId);
                  const o = s?.ownerId ? ownersById.get(s.ownerId) : undefined;
                  const days = effectiveRetentionDays(e, catalog.schedules);
                  return (
                    <tr key={e.id}>
                      <td>{s?.name ?? <span className="pill pill-high">unregistered: {e.systemId}</span>}</td>
                      <td>{o ? `${o.name}${o.active ? '' : ' (inactive)'}` : s ? <span className="pill pill-medium">none</span> : '—'}</td>
                      <td>{s?.region ?? '—'}</td>
                      <td>{e.name}<br /><span className="mono" style={{ color: 'var(--mute)' }}>{e.id}</span></td>
                      <td>{e.category}</td>
                      <td>{e.sensitivity}</td>
                      <td>{e.purposes.join(', ')}</td>
                      <td>{days ?? <span className="pill pill-high">none</span>}</td>
                      <td>{e.retentionDaysOverride !== undefined ? 'override' : catalog.schedules.find((x) => x.id === e.scheduleId)?.name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="notes" className="tabpanel">
          <h2>Normalisation notes</h2>
          <p className="lead">Every change the importer made to ids and vocabulary while loading the catalog. The bundled fixture is already canonical, so this list is empty until you import a messier file (try a category of "PII" or a region of "Europe").</p>
          {notes.length === 0 ? <div className="notice green">No changes were needed.</div> : (
            <div className="scroll" tabIndex={0} role="region" aria-label="Normalisation notes table">
              <table>
                <thead><tr><th scope="col">Path</th><th scope="col">Rule</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
                <tbody>{notes.map((n, i) => <tr key={i}><td className="mono">{n.path}</td><td>{n.rule}</td><td>{n.from}</td><td>{n.to}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>

      <Dialog.Root open={Boolean(acceptTarget)} onOpenChange={(o) => { if (!o) setAcceptTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby="acc-desc">
            <Dialog.Title asChild><h2>Accept with a time-boxed exception</h2></Dialog.Title>
            <Dialog.Description id="acc-desc" className="desc">{acceptTarget ? `${acceptTarget.message} Subject: ${acceptTarget.subject.kind} ${acceptTarget.subject.id}. ` : ''}The exception must name an active owner and an expiry date; it lapses automatically after that date.</Dialog.Description>
            {acceptTarget && <ExceptionForm owners={catalog.owners.filter((o) => o.active)} asOf={catalog.asOf} onSubmit={(input) => acceptException(acceptTarget, input)} onCancel={() => setAcceptTarget(null)} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <footer className="statusline">
        <span role="status" aria-live="polite">{status}</span>
        <span>Source: {source === 'demo' ? 'bundled synthetic fixture' : 'imported (in memory)'} · {catalog.systems.length} systems · {catalog.elements.length} elements · {catalog.flows.length} flows · no storage APIs, no network</span>
      </footer>
    </>
  );
}

function ExceptionForm({ owners, asOf, onSubmit, onCancel }: { owners: Catalog['owners']; asOf: string; onSubmit: (i: { rationale: string; approvedBy: string; expiresOn: string }) => void; onCancel: () => void }) {
  const [rationale, setRationale] = useState('');
  const [approvedBy, setApprovedBy] = useState(owners[0]?.id ?? '');
  const maxExpiry = new Date(Date.parse(`${asOf}T00:00:00Z`) + MAX_EXCEPTION_TERM_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [expiresOn, setExpiresOn] = useState(maxExpiry);
  const valid = rationale.trim().length >= 20 && approvedBy && expiresOn > asOf && expiresOn <= maxExpiry;
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ rationale: rationale.trim(), approvedBy, expiresOn }); }}>
      <label>Rationale (20+ characters)<textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      <div className="form-row">
        <label>Approved by (active owners only)<select value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.team}</option>)}</select></label>
        <label>Expires on (policy cap {MAX_EXCEPTION_TERM_DAYS} days)<input type="date" value={expiresOn} min={asOf} max={maxExpiry} onChange={(e) => setExpiresOn(e.target.value)} /></label>
      </div>
      {!valid && <span className="why">{rationale.trim().length < 20 ? 'Write a rationale of at least 20 characters.' : expiresOn <= asOf ? 'Expiry must be after the as-of date.' : ''}</span>}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid}>Record exception</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ImportDialog({ onImport }: { onImport: (c: Catalog, notes: NormalisationNote[], warnings: string[]) => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  function attempt(src: string) {
    const r = parseCatalog(src);
    if (r.ok) { onImport(r.catalog, r.notes, r.warnings); setText(''); setErrors([]); setOpen(false); } else setErrors(r.errors);
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors([]); }}>
      <Dialog.Trigger asChild><button type="button" className="btn btn-dark">Import catalog</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby="imp-desc">
          <Dialog.Title asChild><h2>Import a catalog</h2></Dialog.Title>
          <Dialog.Description id="imp-desc" className="desc">JSON with schema <code>tenure.catalog</code> v1. Limits: {DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')} bytes, depth {DEFAULT_LIMITS.maxDepth}, {DEFAULT_LIMITS.maxSystems} systems, {DEFAULT_LIMITS.maxElements.toLocaleString('en-US')} elements, {DEFAULT_LIMITS.maxFlows.toLocaleString('en-US')} flows. Synonyms such as "PII", "Europe" or "SCCs" are normalised and reported; unknown vocabulary is rejected.</Dialog.Description>
          <div className="form">
            <label>Choose a .json file<input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > DEFAULT_LIMITS.maxBytes) { setErrors([`File is ${f.size.toLocaleString('en-US')} bytes; the limit is ${DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')}.`]); return; } attempt(await f.text()); e.target.value = ''; }} /></label>
            <label>Or paste JSON<textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => attempt(text)}>Validate and import</button>
              <Dialog.Close asChild><button type="button" className="btn">Cancel</button></Dialog.Close>
            </div>
          </div>
          {errors.length > 0 && <div className="notice red" role="alert" style={{ marginTop: 12 }}><strong>Import rejected.</strong><ul>{errors.slice(0, 12).map((er, i) => <li key={i}>{er}</li>)}</ul></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
