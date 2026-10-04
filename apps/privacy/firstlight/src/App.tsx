import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import demoJson from './fixtures/misdirected-export.json';
import type { Circumstances, DataClass, FactKey, IncidentBundle, IncidentEvent } from './engine/types';
import { buildTimeline } from './engine/timeline';
import { evidenceClock } from './engine/clock';
import { severity, summariseScope } from './engine/severity';
import { severitySensitivity } from './engine/sensitivity';
import { FACTS, readiness } from './engine/readiness';
import { buildPacket, redactText } from './engine/packet';
import { completeTask, DEFAULT_LIMITS, parseBundle, serializeBundle } from './engine/bundleIO';
import { ClockBand } from './ui/ClockBand';

function load(): IncidentBundle {
  const r = parseBundle(JSON.stringify(demoJson));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.bundle;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const DEMO_NOW = '2026-09-22T12:00:00Z';
const toLocalInput = (iso: string) => iso.slice(0, 16);
const fromLocalInput = (v: string) => (Number.isNaN(Date.parse(`${v}:00Z`)) ? DEMO_NOW : `${v}:00Z`);

export function App() {
  const [b, setB] = useState<IncidentBundle>(load);
  const [now, setNow] = useState(DEMO_NOW);
  const [redacted, setRedacted] = useState(true);
  const [status, setStatus] = useState('Demo incident loaded (synthetic). "Now" is a fixed demo time so the clock is reproducible; change it to explore. In-memory only.');
  const [source, setSource] = useState<'demo' | 'imported'>('demo');

  const timeline = useMemo(() => buildTimeline(b.events), [b.events]);
  const clocks = useMemo(() => b.jurisdictions.map((j) => evidenceClock(j, timeline.awareAt, now)), [b.jurisdictions, timeline.awareAt, now]);
  const scope = useMemo(() => summariseScope(b.dataScope), [b.dataScope]);
  const sev = useMemo(() => severity(b), [b]);
  const flips = useMemo(() => severitySensitivity(b), [b]);
  const ready = useMemo(() => readiness(b), [b]);
  const packet = useMemo(() => buildPacket(b, now, redacted), [b, now, redacted]);

  function setCirc<K extends keyof Circumstances>(k: K, v: Circumstances[K]) { setB({ ...b, circumstances: { ...b.circumstances, [k]: v } }); }
  function setFact(k: FactKey, v: string) { setB({ ...b, facts: { ...b.facts, [k]: v } }); }

  return (
    <>
      <header className="top">
        <h1>Firstlight <small>privacy incident triage &amp; notification-readiness lab</small><br /><span className="inc">{b.id} · {b.title}</span></h1>
        <div className="tools" role="toolbar" aria-label="Incident controls">
          <label>Now (UTC) <input type="datetime-local" value={toLocalInput(now)} onChange={(e) => { if (e.target.value) setNow(fromLocalInput(e.target.value)); }} /></label>
          <ImportDialog onImport={(nb, w) => { setB(nb); setSource('imported'); setStatus(`Imported ${nb.id}: ${nb.events.length} events, ${nb.dataScope.length} data items.${w.length ? ` ${w.length} warning(s).` : ''}`); }} />
          <button type="button" className="btn" onClick={() => download(`${b.id}-bundle.json`, serializeBundle(b))}>Export bundle</button>
          <button type="button" className="btn btn-amber" onClick={() => download(`${b.id}-readiness-packet${redacted ? '-redacted' : ''}.json`, JSON.stringify(packet, null, 2))}>Export packet{redacted ? ' (redacted)' : ''}</button>
          <button type="button" className="btn" onClick={() => { setB(load()); setNow(DEMO_NOW); setSource('demo'); setStatus('Demo incident reloaded.'); }}>Reset demo</button>
        </div>
      </header>
      <p className="disclaimer">Educational prototype on a synthetic incident. It assembles and checks facts; it does not decide whether a breach must be notified, and nothing is sent to any authority or person.</p>

      <ClockBand timeline={timeline} clocks={clocks} now={now} />

      <div className="board">
        <section className="col" aria-labelledby="ev-h">
          <h2 id="ev-h">Event stream <span className="count">{timeline.events.length} events · {timeline.duplicatesRemoved.length} duplicates removed</span></h2>
          {timeline.issues.length === 0 ? <div className="okline">Sequence consistent: detection, awareness and containment are in order.</div> : (
            <div className="issues" role="list" aria-label="Sequence issues">
              {timeline.issues.map((i, n) => <div className="issue" role="listitem" key={n}><code>{i.code}</code> {i.message}</div>)}
            </div>
          )}
          <ol className="stream">
            {timeline.events.map((e) => (
              <li key={e.id} className={e.kind}>
                <span className="when">{e.at.replace('T', ' ').replace('Z', 'Z')}</span><span className={`kind ${e.kind}`}>{e.kind}</span>{e.personal && <span className="flag">personal</span>}
                <div className="sum">{redacted && e.personal ? <em style={{ color: 'var(--mute)' }}>[personal detail withheld in redacted view]</em> : e.summary}</div>
                <div className="src">{e.id} · {redacted ? redactText(e.source, b.personalTokens) : e.source}</div>
              </li>
            ))}
          </ol>
          <AddEvent onAdd={(e) => { setB({ ...b, events: [...b.events, e] }); setStatus(`Event ${e.id} added (${e.kind}).`); }} nextId={`ev-${String(b.events.length + 1).padStart(2, '0')}`} defaultAt={now} />
        </section>

        <section className="col" aria-labelledby="sc-h">
          <h2 id="sc-h">Affected data &amp; severity <span className="count">≥ {scope.subjectsLowerBound.toLocaleString('en-US')} subjects (lower bound)</span></h2>
          <div className="scroll" tabIndex={0} role="region" aria-label="Affected data table">
            <table>
              <thead><tr><th scope="col">Category</th><th scope="col">Class</th><th scope="col" className="num">Subjects</th><th scope="col" className="num">Records</th><th scope="col">Exposure</th></tr></thead>
              <tbody>
                {b.dataScope.map((d) => (
                  <tr key={d.id}><td>{d.category}{d.encrypted ? ' · encrypted' : ''}</td><td className="mono">{d.dataClass}</td><td className="num">{d.subjects.toLocaleString('en-US')}{d.estimate ? '~' : ''}</td><td className="num">{d.records.toLocaleString('en-US')}</td><td className="mono" style={{ fontSize: 11.5 }}>{d.exposure.map((x) => x[0]!.toUpperCase()).join('/')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="band-note" style={{ marginTop: 6 }}>Subject count is the largest single item, a lower bound: overlap between items is unknown, so counts are not summed. Highest class <b>{scope.highestClass}</b> · {Math.round(scope.encryptedShare * 100)}% of records encrypted{scope.anyEstimate ? ' · some counts are estimates (~)' : ''}</p>
          <div className="sev" aria-live="polite">
            <span className="se">SE {Math.round(sev.se * 100) / 100}</span><span className={`band ${sev.band}`}>{sev.band.replace('-', ' ')}</span>
            <ul>{sev.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <section className="flips" aria-labelledby="flips-h" tabIndex={0}>
            <h3 id="flips-h">What would change the band</h3>
            {flips.length === 0 ? (
              <p>No single change to a circumstance factor, the context adjustment (one step) or the highest data class would move the band from {sev.band.replace('-', ' ')}.</p>
            ) : (
              <ul>
                {flips.map((f) => (
                  <li key={`${f.field}:${f.to}`}>
                    {FLIP_LABEL[f.field] ?? f.field} {flipValue(f.from)} → {flipValue(f.to)}: {f.bandFrom.replace('-', ' ')} → {f.bandTo.replace('-', ' ')} <span className="delta">(SE {f.seDelta > 0 ? '+' : '−'}{Math.abs(f.seDelta)})</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flips-note">Each line changes one field of the current bundle and re-runs the same formula; combinations are not explored.</p>
          </section>
          <div className="factors">
            <label>Ease of identification (EI)
              <select value={b.circumstances.easeOfIdentification} onChange={(e) => setCirc('easeOfIdentification', e.target.value as Circumstances['easeOfIdentification'])}>
                <option value="negligible">negligible (0.25)</option><option value="limited">limited (0.5)</option><option value="significant">significant (0.75)</option><option value="maximum">maximum (1)</option>
              </select>
            </label>
            <div className="form-row">
              <label>Confidentiality loss<select value={b.circumstances.confidentialityLoss} onChange={(e) => setCirc('confidentialityLoss', e.target.value as Circumstances['confidentialityLoss'])}><option value="none">none (0)</option><option value="known-recipients">known recipients (+0.25)</option><option value="unknown-recipients">unknown recipients (+0.5)</option></select></label>
              <label>Integrity loss<select value={b.circumstances.integrityLoss} onChange={(e) => setCirc('integrityLoss', e.target.value as Circumstances['integrityLoss'])}><option value="none">none (0)</option><option value="recoverable">recoverable (+0.25)</option><option value="unrecoverable">unrecoverable (+0.5)</option></select></label>
              <label>Availability loss<select value={b.circumstances.availabilityLoss} onChange={(e) => setCirc('availabilityLoss', e.target.value as Circumstances['availabilityLoss'])}><option value="none">none (0)</option><option value="temporary">temporary (+0.25)</option><option value="permanent">permanent (+0.5)</option></select></label>
            </div>
            <div className="switchrow"><label htmlFor="mal">Malicious intent (+0.5)</label><Switch.Root id="mal" className="switch" checked={b.circumstances.maliciousIntent} onCheckedChange={(v) => setCirc('maliciousIntent', v)}><Switch.Thumb className="switch-thumb" /></Switch.Root></div>
            <div className="form-row">
              <label>Context adjustment to DPC (−3..+3)<input type="number" min={-3} max={3} value={b.circumstances.dpcAdjustment} onChange={(e) => setCirc('dpcAdjustment', Math.max(-3, Math.min(3, Number(e.target.value) || 0)))} /></label>
              <label>Justification{b.circumstances.dpcAdjustment !== 0 && !b.circumstances.dpcJustification.trim() && <span className="warn"> required for a non-zero adjustment</span>}<textarea rows={2} value={b.circumstances.dpcJustification} onChange={(e) => setCirc('dpcJustification', e.target.value)} /></label>
            </div>
          </div>
        </section>

        <section className="col" aria-labelledby="rd-h">
          <h2 id="rd-h">Notification-readiness packet <span className="count">{ready.requiredPresent}/{ready.requiredTotal} required facts</span></h2>
          <div className="meter" aria-hidden="true"><span style={{ width: `${Math.round(ready.completeness * 100)}%` }} /></div>
          <p className="sr-only">Completeness {Math.round(ready.completeness * 100)} percent.</p>
          <ul className="ready">
            {ready.items.map((i) => (
              <li key={i.key}>
                <span className={i.present ? 'tick' : 'cross'} aria-label={i.present ? 'present' : 'missing'}>{i.present ? '✓' : '✗'}</span>
                <span>{i.label}</span>
                <span className="opt">{i.required ? 'required' : 'optional'}</span>
                {i.note && <span className="note">{i.note}</span>}
              </li>
            ))}
          </ul>
          <div className="facts">
            {FACTS.map((f) => (
              <label key={f.key}>{f.label}{f.required ? '' : ' (optional)'}
                <textarea className={f.required && !b.facts[f.key]?.trim() ? 'missing' : ''} value={b.facts[f.key] ?? ''} onChange={(e) => setFact(f.key, e.target.value)} />
              </label>
            ))}
          </div>
          <div className="switchrow" style={{ marginTop: 12 }}><label htmlFor="red">Redaction preview (mask names and emails)</label><Switch.Root id="red" className="switch" checked={redacted} onCheckedChange={setRedacted}><Switch.Thumb className="switch-thumb" /></Switch.Root></div>
          <pre className="preview" tabIndex={0} aria-label={`Packet preview, ${redacted ? 'redacted' : 'full'}`}>{JSON.stringify({ incident: packet.incident, anchors: packet.timeline.anchors, severity: { se: packet.severity.se, band: packet.severity.band }, facts: packet.facts, readiness: { completeness: Math.round(packet.readiness.completeness * 100) / 100, missing: packet.readiness.missing } }, null, 2)}</pre>
        </section>
      </div>

      <section className="tasks" aria-labelledby="ct-h">
        <h2 id="ct-h">Containment checklist · {b.containment.filter((c) => c.status === 'done').length} of {b.containment.filter((c) => c.status !== 'not-applicable').length} applicable tasks done</h2>
        <div className="scroll" tabIndex={0} role="region" aria-label="Containment tasks table">
          <table>
            <thead><tr><th scope="col">Task</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {b.containment.map((t) => <TaskRow key={t.id} task={t} redacted={redacted} tokens={b.personalTokens} onDone={(ref) => { try { setB(completeTask(b, t.id, ref)); setStatus(`${t.id} marked done with evidence.`); } catch (e) { setStatus((e as Error).message); } }} onStatus={(st) => setB({ ...b, containment: b.containment.map((c) => (c.id === t.id ? { ...c, status: st } : c)) })} />)}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="statusline">
        <span role="status" aria-live="polite">{status}</span>
        <span>Source: {source === 'demo' ? 'bundled synthetic fixture' : 'imported (in memory)'} · {b.events.length} events · no storage APIs, no network</span>
      </footer>
    </>
  );
}

function TaskRow({ task, redacted, tokens, onDone, onStatus }: { task: IncidentBundle['containment'][number]; redacted: boolean; tokens: string[]; onDone: (ref: string) => void; onStatus: (s: IncidentBundle['containment'][number]['status']) => void }) {
  const [ref, setRef] = useState('');
  return (
    <tr>
      <td>{task.title}<br /><span className="mono" style={{ color: 'var(--mute)', fontSize: 11 }}>{task.id}</span></td>
      <td>{task.owner ?? '—'}</td>
      <td><span className={`task-status ${task.status}`}>{task.status}</span></td>
      <td>{task.evidenceRef ? (redacted ? redactText(task.evidenceRef, tokens) : task.evidenceRef) : <span className="warn">none</span>}</td>
      <td>
        {task.status === 'done' || task.status === 'not-applicable' ? (
          <button type="button" className="btn btn-sm" onClick={() => onStatus('open')}>Reopen</button>
        ) : (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); onDone(ref); setRef(''); }}>
            <label className="sr-only" htmlFor={`ref-${task.id}`}>Evidence reference for {task.title}</label>
            <input id={`ref-${task.id}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="evidence reference (required)" />
            <button type="submit" className="btn btn-sm" disabled={!ref.trim()}>Mark done</button>
            {task.status === 'open' && <button type="button" className="btn btn-sm" onClick={() => onStatus('in-progress')}>Start</button>}
          </form>
        )}
      </td>
    </tr>
  );
}

function AddEvent({ onAdd, nextId, defaultAt }: { onAdd: (e: IncidentEvent) => void; nextId: string; defaultAt: string }) {
  const [kind, setKind] = useState<IncidentEvent['kind']>('evidence');
  const [at, setAt] = useState(defaultAt);
  const [summary, setSummary] = useState('');
  const [source, setSource] = useState('');
  const [personal, setPersonal] = useState(false);
  const valid = summary.trim() && !Number.isNaN(Date.parse(at));
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (!valid) return; onAdd({ id: nextId, at: new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z'), kind, source: source.trim() || 'analyst', summary: summary.trim(), ...(personal ? { personal: true } : {}) }); setSummary(''); setSource(''); setPersonal(false); }} aria-label="Add an event">
      <fieldset className="form">
        <legend>Add an event</legend>
        <div className="form-row">
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value as IncidentEvent['kind'])}>{['occurred', 'detected', 'aware', 'escalated', 'contained', 'evidence', 'note'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>At (ISO UTC)<input className="mono" value={at} onChange={(e) => setAt(e.target.value)} aria-invalid={Number.isNaN(Date.parse(at))} /></label>
        </div>
        <label>Summary<input value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
        <div className="form-row">
          <label>Source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="analyst" /></label>
          <label style={{ alignSelf: 'end' }}><span className="switchrow" style={{ justifyContent: 'flex-start', gap: 8 }}><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> contains personal detail</span></label>
        </div>
        <div><button type="submit" className="btn btn-sm" disabled={!valid}>Add event</button></div>
      </fieldset>
    </form>
  );
}

function ImportDialog({ onImport }: { onImport: (b: IncidentBundle, warnings: string[]) => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  function attempt(src: string) {
    const r = parseBundle(src);
    if (r.ok) { onImport(r.bundle, r.warnings); setText(''); setErrors([]); setOpen(false); } else setErrors(r.errors);
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors([]); }}>
      <Dialog.Trigger asChild><button type="button" className="btn">Import bundle</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby="imp-desc">
          <Dialog.Title asChild><h2>Import an incident bundle</h2></Dialog.Title>
          <Dialog.Description id="imp-desc" className="desc">JSON with schema <code>firstlight.incident</code> v1. Limits: {DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')} bytes, depth {DEFAULT_LIMITS.maxDepth}, {DEFAULT_LIMITS.maxEvents.toLocaleString('en-US')} events. Read in this tab only; replaces the current session.</Dialog.Description>
          <div className="form">
            <label>Choose a .json file<input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > DEFAULT_LIMITS.maxBytes) { setErrors([`File is ${f.size.toLocaleString('en-US')} bytes; the limit is ${DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')}.`]); return; } attempt(await f.text()); e.target.value = ''; }} /></label>
            <label>Or paste JSON<textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
            <div className="dialog-actions">
              <button type="button" className="btn btn-amber" disabled={!text.trim()} onClick={() => attempt(text)}>Validate and import</button>
              <Dialog.Close asChild><button type="button" className="btn">Cancel</button></Dialog.Close>
            </div>
          </div>
          {errors.length > 0 && <div className="issue" role="alert" style={{ marginTop: 10 }}><strong>Import rejected.</strong> {errors.slice(0, 8).join(' · ')}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const DATA_CLASSES: DataClass[] = ['simple', 'behavioural', 'financial', 'sensitive'];

/** Human labels for the engine's flip field keys (the engine stays label-free). */
const FLIP_LABEL: Record<string, string> = {
  confidentialityLoss: 'Confidentiality loss',
  integrityLoss: 'Integrity loss',
  availabilityLoss: 'Availability loss',
  easeOfIdentification: 'Ease of identification',
  maliciousIntent: 'Malicious intent',
  dpcAdjustment: 'Context adjustment',
  'dataScope.highestClass': 'Highest data class',
};

const flipValue = (v: string): string => (v === 'true' ? 'yes' : v === 'false' ? 'no' : v);
