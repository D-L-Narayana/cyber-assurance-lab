import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import * as Dialog from '@radix-ui/react-dialog';
import demoJson from './fixtures/demo-workspace.json';
import type { AgeBand, ConsentRecord, ConsentStatus, ProcessingEvent, Regime, Subject, Workspace } from './engine/types';
import { evaluate, RULES } from './engine/evaluate';
import { evaluateAll, exportDecisions, ruleCoverage, runExpectations } from './engine/analysis';
import { DEFAULT_LIMITS, parseWorkspace, serializeWorkspace } from './engine/workspace';
import { Ladder } from './ui/Ladder';

function loadDemo(): Workspace {
  const r = parseWorkspace(JSON.stringify(demoJson));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.workspace;
}

type WhatIf = 'none' | 'gpc' | 'child' | 'california' | 'eu' | 'later' | 'withdrawn';

const WHAT_IFS: Array<{ id: WhatIf; label: string }> = [
  { id: 'none', label: 'No comparison' },
  { id: 'gpc', label: 'Flip GPC signal' },
  { id: 'child', label: 'Subject is 13–15' },
  { id: 'california', label: 'Regime → California' },
  { id: 'eu', label: 'Regime → EU GDPR' },
  { id: 'later', label: 'Event +400 days' },
  { id: 'withdrawn', label: 'Consent withdrawn yesterday' },
];

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function App() {
  const [ws, setWs] = useState<Workspace>(loadDemo);
  const [subjectId, setSubjectId] = useState('sub-eu-anouk');
  const [purposeId, setPurposeId] = useState('marketing-email');
  const [occurredAt, setOccurredAt] = useState('2026-09-15T10:00:00Z');
  const [gpcOverride, setGpcOverride] = useState<boolean | null>(null);
  const [ageOverride, setAgeOverride] = useState<AgeBand | ''>('');
  const [whatIf, setWhatIf] = useState<WhatIf>('none');
  const [status, setStatus] = useState('Demo workspace loaded. Synthetic data; in-memory only; refresh resets.');
  const [source, setSource] = useState<'demo' | 'imported'>('demo');

  const baseSubject = ws.subjects.find((s) => s.id === subjectId) ?? ws.subjects[0]!;
  const subject: Subject = { ...baseSubject, ...(gpcOverride !== null ? { gpcSignal: gpcOverride } : {}), ...(ageOverride ? { ageBand: ageOverride } : {}) };
  const purpose = ws.purposes.find((p) => p.id === purposeId);
  const timeValid = !Number.isNaN(Date.parse(occurredAt));
  const event: ProcessingEvent = { id: 'scenario', subjectId: subject.id, purposeId, occurredAt: timeValid ? occurredAt : '2026-09-15T10:00:00Z', channel: 'simulator' };

  const decision = useMemo(() => evaluate(event, { subject, purposes: ws.purposes, records: ws.records, policy: ws.policy }), [event.occurredAt, event.purposeId, subject.id, subject.gpcSignal, subject.ageBand, subject.regime, ws]);

  const variant = useMemo((): { subject: Subject; event: ProcessingEvent; records: ConsentRecord[]; label: string } | null => {
    if (whatIf === 'none') return null;
    let s = { ...subject };
    let e = { ...event, id: 'scenario-variant' };
    let records = ws.records;
    let label = '';
    switch (whatIf) {
      case 'gpc': s = { ...s, gpcSignal: !s.gpcSignal }; label = `GPC ${s.gpcSignal ? 'on' : 'off'}`; break;
      case 'child': s = { ...s, ageBand: '13-15' }; label = 'age band 13–15'; break;
      case 'california': s = { ...s, regime: 'US-CA-CCPA' as Regime }; label = 'regime US-CA-CCPA'; break;
      case 'eu': s = { ...s, regime: 'EU-GDPR' as Regime }; label = 'regime EU-GDPR'; break;
      case 'later': e = { ...e, occurredAt: shiftDays(e.occurredAt, 400) }; label = `event at ${e.occurredAt}`; break;
      case 'withdrawn': {
        const at = shiftDays(e.occurredAt, -1);
        records = [...ws.records, { id: 'whatif-withdrawal', subjectId: s.id, purposeId, status: 'withdrawn', at, policyVersion: purpose?.policyVersion ?? 1, mechanism: 'preference-centre', regime: s.regime, proofRef: 'what-if' }];
        label = `withdrawal recorded ${at}`;
        break;
      }
    }
    return { subject: s, event: e, records, label };
  }, [whatIf, subject, event, ws.records, purposeId, purpose?.policyVersion]);

  const variantDecision = variant ? evaluate(variant.event, { subject: variant.subject, purposes: ws.purposes, records: variant.records, policy: ws.policy }) : null;

  const ledger = ws.records.filter((r) => r.subjectId === subject.id && r.purposeId === purposeId).sort((a, b) => a.at.localeCompare(b.at));
  const batch = useMemo(() => evaluateAll(ws), [ws]);
  const coverage = useMemo(() => ruleCoverage(ws), [ws]);
  const suite = useMemo(() => runExpectations(ws), [ws]);

  function addRecord(statusValue: ConsentStatus, at: string, policyVersion: number) {
    const rec: ConsentRecord = { id: `rec-${String(ws.records.length + 1).padStart(3, '0')}`, subjectId: subject.id, purposeId, status: statusValue, at, policyVersion, mechanism: 'preference-centre', regime: baseSubject.regime, proofRef: `session-${ws.records.length + 1}` };
    setWs({ ...ws, records: [...ws.records, rec] });
    setStatus(`Recorded ${statusValue} for ${subject.label} / ${purpose?.name ?? purposeId} at ${at}.`);
  }

  function toggleRule(ruleId: string) {
    const disabled = ws.policy.disabledRules.includes(ruleId) ? ws.policy.disabledRules.filter((r) => r !== ruleId) : [...ws.policy.disabledRules, ruleId];
    setWs({ ...ws, policy: { ...ws.policy, disabledRules: disabled } });
    setStatus(`${ruleId} ${disabled.includes(ruleId) ? 'disabled' : 're-enabled'} for what-if analysis. The regression suite below shows the effect.`);
  }

  function pickEvent(e: ProcessingEvent) {
    setSubjectId(e.subjectId); setPurposeId(e.purposeId); setOccurredAt(e.occurredAt); setGpcOverride(null); setAgeOverride('');
    window.scrollTo({ top: 0, behavior: 'auto' });
    setStatus(`Loaded ${e.id} into the simulator.`);
  }

  return (
    <>
      <header className="topbar">
        <h1>Consentry <small>consent &amp; preference decision engine</small> <span className="policy">{ws.policy.id} v{ws.policy.version}{ws.policy.disabledRules.length ? ` · ${ws.policy.disabledRules.length} rule(s) disabled` : ''}</span></h1>
        <div className="right" role="toolbar" aria-label="Workspace controls">
          <ImportDialog onImport={(next, warnings) => { setWs(next); setSource('imported'); setSubjectId(next.subjects[0]?.id ?? ''); setPurposeId(next.purposes[0]?.id ?? ''); setStatus(`Imported ${next.events.length} events, ${next.records.length} records.${warnings.length ? ` ${warnings.length} warning(s): ${warnings.slice(0, 3).join(' · ')}${warnings.length > 3 ? ' …' : ''}` : ''}`); }} />
          <button type="button" className="btn btn-quiet" onClick={() => downloadJson('consentry-workspace.json', JSON.parse(serializeWorkspace(ws)))}>Export workspace</button>
          <button type="button" className="btn btn-quiet" onClick={() => downloadJson('consentry-decisions.json', exportDecisions(ws, batch, new Date().toISOString()))}>Export decisions</button>
          <button type="button" className="btn btn-quiet" onClick={() => { setWs(loadDemo()); setSource('demo'); setSubjectId('sub-eu-anouk'); setPurposeId('marketing-email'); setOccurredAt('2026-09-15T10:00:00Z'); setGpcOverride(null); setAgeOverride(''); setWhatIf('none'); setStatus('Demo workspace reloaded.'); }}>Reset demo</button>
        </div>
      </header>
      <p className="disclaimer">Educational prototype: a table-driven policy evaluator over synthetic purposes, subjects and consent records. It explains a decision; it does not deploy cookies, track visitors, or constitute legal advice.</p>

      <div className="grid">
        <section className="col" aria-labelledby="scenario-h">
          <h2 id="scenario-h">Scenario</h2>
          <div className="field">
            <label htmlFor="subject">Subject</label>
            <select id="subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setGpcOverride(null); setAgeOverride(''); }}>
              {ws.subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="purpose">Purpose</label>
            <select id="purpose" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
              {ws.purposes.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category}</option>)}
              <option value="retired-purpose">(unregistered purpose id)</option>
            </select>
            {purpose && <span className="help">{purpose.description} Basis: {Object.entries(purpose.basisByRegime).map(([k, v]) => `${k}=${v}`).join(', ') || 'none configured'} · notice v{purpose.policyVersion}{purpose.reconsentOnVersionChange ? ' (re-consent on change)' : ''}</span>}
          </div>
          <div className="field">
            <label htmlFor="when">Event time (ISO, UTC)</label>
            <input id="when" className="mono" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} aria-invalid={!timeValid} aria-describedby="when-help" />
            <span id="when-help" className="help">{timeValid ? 'Only records at or before this instant count.' : 'Not a valid timestamp; using 2026-09-15T10:00:00Z.'}</span>
          </div>
          <div className="switch-row">
            <label htmlFor="gpc">Opt-out preference signal (GPC)</label>
            <Switch.Root id="gpc" className="switch" checked={subject.gpcSignal} onCheckedChange={(v) => setGpcOverride(v)}><Switch.Thumb className="switch-thumb" /></Switch.Root>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="age">Age band</label>
            <select id="age" value={subject.ageBand} onChange={(e) => setAgeOverride(e.target.value as AgeBand)}>
              {(['under-13', '13-15', '16-17', 'adult', 'unknown'] as AgeBand[]).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="subject-facts">
            <span>Regime <b>{subject.regime}</b></span>
            <span>Child threshold <b>{subject.regime === 'unknown' ? '—' : ws.policy.childAgeThreshold[subject.regime]}</b></span>
            <span>Consent max age <b>{ws.policy.consentMaxAgeDays} days</b></span>
          </div>
        </section>

        <section className="col ladder-wrap" aria-labelledby="trace-h">
          <h2 id="trace-h">Decision trace</h2>
          <div className="whatif" role="group" aria-label="Compare with a what-if variant">
            <span className="label">Compare:</span>
            {WHAT_IFS.map((w) => <button key={w.id} type="button" className="chip" aria-pressed={whatIf === w.id} onClick={() => setWhatIf(w.id)}>{w.label}</button>)}
          </div>
          <div className={`ladders${variantDecision ? ' compare' : ''}`}>
            <Ladder title={`${subject.label} → ${purpose?.name ?? purposeId}`} decision={decision} {...(variantDecision ? { against: variantDecision } : {})} />
            {variantDecision && variant && <Ladder title={`What if: ${variant.label}`} decision={variantDecision} against={decision} />}
          </div>
        </section>

        <section className="col" aria-labelledby="ledger-h">
          <h2 id="ledger-h">Consent ledger · {subject.label}</h2>
          {ledger.length === 0 ? <p className="ledger-empty">No records for this subject and purpose. Add one below to see the trace change.</p> : (
            <ol className="ledger">
              {ledger.map((r) => {
                const future = Date.parse(r.at) > Date.parse(event.occurredAt);
                const used = decision.recordId === r.id;
                return (
                  <li key={r.id} className={`${used ? 'used' : ''}${future ? ' future' : ''}`}>
                    <span className={`st st-${r.status}`}>{r.status}</span>
                    <span>
                      <span className="mono">{r.id}</span>{used && <span className="badge-used">USED</span>}{future && <span className="badge-used" style={{ color: 'var(--mute)' }}>AFTER EVENT</span>}
                      <br /><span className="meta">{r.at} · v{r.policyVersion} · {r.mechanism}{r.expiresAt ? ` · expires ${r.expiresAt}` : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <AddRecordForm defaultAt={shiftDays(event.occurredAt, -1)} defaultVersion={purpose?.policyVersion ?? 1} onAdd={addRecord} />
        </section>
      </div>

      <Tabs.Root defaultValue="batch" className="tabs">
        <Tabs.List className="tablist" aria-label="Analysis views">
          <Tabs.Trigger className="tab" value="batch">Batch decisions ({batch.length})</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="coverage">Rule coverage</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="suite">Policy regression suite ({suite.passed}/{suite.total})</Tabs.Trigger>
          <Tabs.Trigger className="tab" value="rules">Rule table</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="batch" className="tabpanel">
          <h2>Every fixture event, decided with the current policy</h2>
          <p className="lead">Click an event to load it into the simulator. Export produces a JSON audit trail with the full trace per event.</p>
          <div className="summary">
            {(['allow', 'deny', 'review'] as const).map((k) => <span key={k}><span className={`pill pill-${k}`}>{k}</span> <b>{batch.filter((d) => d.decision === k).length}</b></span>)}
          </div>
          <div className="scroll" tabIndex={0} role="region" aria-label="Batch decisions table">
            <table>
              <thead><tr><th scope="col">Event</th><th scope="col">Subject</th><th scope="col">Purpose</th><th scope="col">Occurred</th><th scope="col">Decision</th><th scope="col">Reason</th><th scope="col">Rule</th></tr></thead>
              <tbody>
                {batch.map((d, i) => {
                  const e = ws.events[i]!;
                  return (
                    <tr key={d.eventId}>
                      <td><button type="button" className="rowbtn mono" onClick={() => pickEvent(e)}>{d.eventId}</button></td>
                      <td>{ws.subjects.find((s) => s.id === d.subjectId)?.label ?? d.subjectId}</td>
                      <td>{ws.purposes.find((p) => p.id === d.purposeId)?.name ?? <span className="mono">{d.purposeId}</span>}</td>
                      <td className="mono">{e.occurredAt}</td>
                      <td><span className={`pill pill-${d.decision}`}>{d.decision}</span></td>
                      <td className="mono">{d.reasonCode}</td>
                      <td className="mono">{d.ruleId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="coverage" className="tabpanel">
          <h2>Which rules do the fixtures actually exercise?</h2>
          <p className="lead">Each rule is disabled in turn and every fixture event is re-decided. A rule that changes no decision is unexercised: a regression in it would go unnoticed. Tick a rule to disable it in the live policy and watch the suite below react.</p>
          <div className="scroll" tabIndex={0} role="region" aria-label="Rule coverage table">
            <table>
              <thead><tr><th scope="col">Live</th><th scope="col">Rule</th><th scope="col">Terminal for</th><th scope="col">Decisions changed if disabled</th><th scope="col">Exercised</th><th scope="col">Changed events</th></tr></thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.ruleId}>
                    <td>{c.ruleId === 'R99-fallback' ? <span className="mono" aria-label="fallback cannot be disabled">—</span> : <input type="checkbox" aria-label={`Enable ${c.ruleId}`} checked={!ws.policy.disabledRules.includes(c.ruleId)} onChange={() => toggleRule(c.ruleId)} />}</td>
                    <td><span className="mono">{c.ruleId}</span><br />{c.title}</td>
                    <td className="mono">{c.terminalFor}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="cov-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (c.decisionsChanged / Math.max(1, batch.length)) * 100)}%` }} /></div><span className="mono">{c.decisionsChanged}</span></div></td>
                    <td>{c.ruleId === 'R99-fallback' ? <span className="pill pill-ok">never reached</span> : c.exercised ? <span className="pill pill-ok">yes</span> : <span className="pill pill-warn">no — add a fixture</span>}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{c.changedEventIds.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="suite" className="tabpanel">
          <h2>Policy regression suite</h2>
          <p className="lead">Stored expectations (event → expected decision and reason) replayed against the live policy table. Disable a rule in the coverage tab to see which expectations break.</p>
          {suite.failed.length === 0 ? <div className="notice green" role="status">All {suite.total} expectations pass with the current policy.</div> : (
            <div className="notice red" role="status">
              <strong>{suite.failed.length} of {suite.total} expectations fail.</strong>
              <ul>{suite.failed.map((f) => <li key={f.eventId}><span className="mono">{f.eventId}</span>: expected {f.expected}{f.expectedReason ? ` (${f.expectedReason})` : ''}, observed {f.observed}{f.observedReason ? ` (${f.observedReason})` : ''}</li>)}</ul>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="rules" className="tabpanel">
          <h2>The rule table, in evaluation order</h2>
          <p className="lead">The first matching rule is terminal. Sources are listed in the README; thresholds are policy fixtures, not hidden constants.</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            {RULES.map((r) => <li key={r.id}><span className="mono">{r.id}</span> — <strong>{r.title}.</strong> {r.statement}</li>)}
          </ol>
        </Tabs.Content>
      </Tabs.Root>

      <footer className="statusline">
        <span role="status" aria-live="polite">{status}</span>
        <span>Source: {source === 'demo' ? 'bundled synthetic fixture' : 'imported (in memory)'} · {ws.records.length} records · {ws.events.length} events · no storage APIs, no network</span>
      </footer>
    </>
  );
}

function AddRecordForm({ defaultAt, defaultVersion, onAdd }: { defaultAt: string; defaultVersion: number; onAdd: (status: ConsentStatus, at: string, policyVersion: number) => void }) {
  const [statusValue, setStatusValue] = useState<ConsentStatus>('granted');
  const [at, setAt] = useState(defaultAt);
  const [version, setVersion] = useState(defaultVersion);
  const valid = !Number.isNaN(Date.parse(at));
  return (
    <form className="field" onSubmit={(e) => { e.preventDefault(); if (valid) onAdd(statusValue, new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z'), version); }} aria-label="Add a consent record">
      <span className="label">Add a record for this subject and purpose</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="sr-only" htmlFor="rec-status">Status</label>
        <select id="rec-status" value={statusValue} onChange={(e) => setStatusValue(e.target.value as ConsentStatus)}>
          <option value="granted">granted</option><option value="withdrawn">withdrawn</option><option value="objected">objected</option><option value="opted-out">opted-out</option>
        </select>
        <label className="sr-only" htmlFor="rec-version">Policy version</label>
        <input id="rec-version" type="number" min={1} max={999} value={version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Policy version captured under" />
      </div>
      <label className="sr-only" htmlFor="rec-at">Effective at (ISO)</label>
      <input id="rec-at" className="mono" value={at} onChange={(e) => setAt(e.target.value)} aria-invalid={!valid} />
      <button type="submit" className="btn btn-sm" disabled={!valid}>Add record</button>
    </form>
  );
}

function ImportDialog({ onImport }: { onImport: (ws: Workspace, warnings: string[]) => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  function attempt(src: string) {
    const r = parseWorkspace(src);
    if (r.ok) { onImport(r.workspace, r.warnings); setText(''); setErrors([]); setOpen(false); } else setErrors(r.errors);
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors([]); }}>
      <Dialog.Trigger asChild><button type="button" className="btn btn-quiet">Import workspace</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby="imp-desc">
          <Dialog.Title asChild><h2>Import a workspace</h2></Dialog.Title>
          <Dialog.Description id="imp-desc" className="desc">JSON with schema <code>consentry.workspace</code> v1. Limits: {DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')} bytes, depth {DEFAULT_LIMITS.maxDepth}, {DEFAULT_LIMITS.maxEvents.toLocaleString('en-US')} events, {DEFAULT_LIMITS.maxRecords.toLocaleString('en-US')} records. Read in this tab only; replaces the current session.</Dialog.Description>
          <div className="field">
            <label htmlFor="imp-file">Choose a .json file</label>
            <input id="imp-file" type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > DEFAULT_LIMITS.maxBytes) { setErrors([`File is ${f.size.toLocaleString('en-US')} bytes; the limit is ${DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')}.`]); return; } attempt(await f.text()); e.target.value = ''; }} />
          </div>
          <div className="field">
            <label htmlFor="imp-text">Or paste JSON</label>
            <textarea id="imp-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => attempt(text)}>Validate and import</button>
            <Dialog.Close asChild><button type="button" className="btn btn-quiet">Cancel</button></Dialog.Close>
          </div>
          {errors.length > 0 && <div className="notice red" role="alert" style={{ marginTop: 12 }}><strong>Import rejected.</strong><ul>{errors.slice(0, 12).map((er, i) => <li key={i}>{er}</li>)}</ul></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
