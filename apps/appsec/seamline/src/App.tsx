import { useMemo, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import fixture from './fixtures/brewline-scenario.json';
import { LIMITS, parseScenario, validateScenario } from './engine/scenario';
import { runScenario } from './engine/simulate';
import { buildReport, reportToMarkdown } from './engine/report';
import type { Message, Mode, OrderItem, Scenario, StepResult } from './engine/types';

const DEMO: Scenario = (() => { const r = validateScenario(fixture); if (!r.ok) throw new Error(r.errors.join('\n')); return r.scenario; })();

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
/** Flatten a payload to the same keys used by fieldOrigins. */
function flatten(m: Message): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(m.payload)) {
    if (k === 'items' && Array.isArray(v)) (v as OrderItem[]).forEach((it, i) => { out.push([`items[${i}].sku`, it.sku]); out.push([`items[${i}].qty`, String(it.qty)]); out.push([`items[${i}].unitPrice`, it.unitPrice.toFixed(2)]); });
    else out.push([k, typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)]);
  }
  return out;
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(DEMO);
  const [mode, setMode] = useState<Mode>('trusting');
  const [index, setIndex] = useState(1);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('Demo scenario loaded. Everything runs inside this tab.');

  const runs = useMemo(() => ({ trusting: runScenario(scenario, 'trusting'), enforcing: runScenario(scenario, 'enforcing') }), [scenario]);
  const run = runs[mode];
  const step: StepResult = run.steps[Math.min(index, run.steps.length - 1)];
  const sentFlat = flatten(step.sent);
  const recvFlat = new Map(flatten(step.received));
  const changed = new Set(step.changedFields);

  function applyImport() {
    const r = parseScenario(draft);
    if (!r.ok) { setErrors(r.errors); return; }
    setScenario(r.scenario); setErrors([]); setIndex(0);
    setNotice(`Loaded "${r.scenario.name}" with ${r.scenario.steps.length} steps.`);
  }
  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.maxBytes) { setErrors([`File is ${file.size} bytes; the limit is ${LIMITS.maxBytes}.`]); return; }
    setDraft(await file.text()); setErrors([]);
  }
  function exportReport(kind: 'json' | 'md') {
    const report = buildReport(scenario, runs);
    if (kind === 'json') download('seamline-report.json', JSON.stringify(report, null, 2), 'application/json');
    else download('seamline-review.md', reportToMarkdown(report), 'text/markdown');
  }

  const user = scenario.users.find((u) => u.id === step.sent.user)!;
  const recvKeys = [...recvFlat.keys()];
  const addedKeys = recvKeys.filter((k) => !sentFlat.some(([sk]) => sk === k));

  return (
    <div>
      <header className="masthead">
        <div className="brand">Seamline<small>client / server trust-boundary simulator · {scenario.name}</small></div>
        <span className="badge">educational · scripted scenario, modelled server · not discovery, not a mobile or API pentest</span>
        <div className="right">
          <label className="mode" htmlFor="mode">
            <span className={`lbl${mode === 'trusting' ? ' on' : ''}`} style={mode === 'trusting' ? { color: 'var(--tamper)' } : undefined}>trusting server</span>
            <Switch.Root id="mode" className="switch" checked={mode === 'enforcing'} onCheckedChange={(v) => setMode(v ? 'enforcing' : 'trusting')} aria-label="Server mode: enforcing when on, trusting when off">
              <Switch.Thumb className="thumb" />
            </Switch.Root>
            <span className={`lbl${mode === 'enforcing' ? ' on' : ''}`}>enforcing server</span>
          </label>
          <button className="btn" onClick={() => exportReport('md')}>Export review (.md)</button>
          <button className="btn primary" onClick={() => exportReport('json')}>Export report (.json)</button>
        </div>
      </header>

      <section className="diagram" aria-label="Trust boundary">
        <div className="zone client">
          <h2>Client — untrusted</h2>
          <p className="sub">Anything here can be edited by the person holding the device. The tamper layer edits it in transit.</p>
          <div className="device">
            <div className="who">{user.label} <span>· session <code>[token:{user.id}]</code> · {step.sent.event}</span></div>
            <div className="sub" style={{ marginBottom: 6 }}>nonce <code>{step.sent.nonce}</code> · ts <code>{step.sent.ts.slice(11, 19)}</code></div>
          </div>
          <ul className="fields" aria-label="Message as composed by the client">
            {sentFlat.map(([k, v]) => <li key={k} className="o-client-controlled"><span className="k">{k} <span className="v">{v}</span></span><span className="origin">as composed</span></li>)}
          </ul>
        </div>

        <div className="seam" aria-hidden>
          <span className={`arrow${step.tamper ? ' tampered' : ''}`}>{step.tamper ? '✂' : '→'}</span>
          <span className="lbl">trust boundary</span>
        </div>

        <div className="zone server">
          <h2>Server — {mode === 'enforcing' ? 'server-authoritative' : 'client-authoritative'}</h2>
          <p className="sub">{mode === 'enforcing' ? 'Recomputes prices, discounts, points and roles from its own state; checks nonce, freshness, ownership and quantity bounds.' : 'Believes the message as received. Fields keep the values the client (or the tamperer) chose.'}</p>
          <ul className="fields" aria-label="Message as received, with the origin of each value">
            {[...sentFlat.map(([k]) => k), ...addedKeys].map((k) => {
              const origin = step.fieldOrigins[k] ?? 'client-controlled';
              const before = sentFlat.find(([sk]) => sk === k)?.[1];
              const after = recvFlat.get(k) ?? '';
              const isChanged = changed.has(k) || (before !== undefined && before !== after) || addedKeys.includes(k);
              return (
                <li key={k} className={`o-${origin}${isChanged ? ' changed' : ''}`}>
                  <span className="k">{k} <span className="v">{isChanged && before !== undefined ? <><s>{before}</s><b>{after}</b></> : isChanged ? <b>{after} (added)</b> : after}</span></span>
                  <span className="origin">{isChanged ? 'tampered · ' : ''}{origin.replace('-', ' ')}</span>
                </li>
              );
            })}
            {changed.has('nonce') && <li className="o-client-controlled changed"><span className="k">nonce <span className="v"><s>{step.sent.nonce}</s><b>{step.received.nonce}</b></span></span><span className="origin">tampered · replayed</span></li>}
            {changed.has('ts') && <li className="o-client-controlled changed"><span className="k">ts <span className="v"><s>{step.sent.ts.slice(11, 19)}</s><b>{step.received.ts.slice(11, 19)}</b></span></span><span className="origin">tampered · backdated</span></li>}
          </ul>
          {step.tamper && <p className="tamper-note"><b>{step.tamper.kind}</b>{scenarioTamperNote(step)}</p>}
          <h2 style={{ marginTop: 14 }}>Checks</h2>
          <ul className="checks">
            {step.checks.map((c) => (
              <li key={c.name} className={!c.ran ? 'skipped' : c.passed ? 'ran-pass' : 'ran-fail'}>
                <span className="mark" aria-label={!c.ran ? 'not run' : c.passed ? 'passed' : 'failed'}>{!c.ran ? '–' : c.passed ? '✓' : '✕'}</span>
                <span><span className="n">{c.name}</span> <span className="d">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <h2 style={{ marginTop: 14 }}>Claims vs server truth</h2>
          {step.divergences.length === 0 ? <p className="sub">Every security-relevant claim in this message matches what the server can establish itself.</p> : (
            <ul className="checks" aria-label="Divergent claims">
              {step.divergences.map((d) => <li key={d.invariant} className="ran-fail"><span className="mark" aria-label="diverges">≠</span><span><span className="n">{d.invariant}</span> <span className="d">claimed {d.claimed}; server truth {d.truth}</span></span></li>)}
            </ul>
          )}
          <p className="narrative"><span className={`decision d-${step.decision}`}>{step.decision}</span> <b>{step.narrative}</b></p>
          <ul className="serverview" aria-label="Server view after the step">{Object.entries(step.serverView).map(([k, v]) => <li key={k}>{k} = {String(v)}</li>)}</ul>
          {step.finding && (
            <div className="finding" role="note">
              <h3>{step.finding.title}</h3>
              <div className="map">{step.finding.cwe} {step.finding.cweName} · {step.finding.severity}</div>
              <p>{step.finding.detail}</p>
              <p>What the enforcing model does instead: {runs.enforcing.steps.find((s) => s.stepId === step.stepId)?.narrative}</p>
            </div>
          )}
        </div>
      </section>

      <section className="scrubber" aria-label="Event scrubber">
        <div className="top">
          <button className="btn small" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>◀ Prev</button>
          <button className="btn small" onClick={() => setIndex((i) => Math.min(run.steps.length - 1, i + 1))} disabled={index >= run.steps.length - 1}>Next ▶</button>
          <span className="label">{step.stepId} <span>· {step.label}</span></span>
          <span className="summary" style={{ marginLeft: 'auto' }}><span>{run.summary.steps} events</span><span>accepted <b>{run.summary.accepted}</b></span><span>neutralized <b>{run.summary.neutralized}</b></span><span>rejected <b>{run.summary.rejected}</b></span><span>findings <b>{run.summary.findings}</b></span></span>
        </div>
        <Slider.Root className="slider" min={0} max={run.steps.length - 1} step={1} value={[index]} onValueChange={([v]) => setIndex(v)}>
          <Slider.Track className="track"><Slider.Range className="range" /></Slider.Track>
          <Slider.Thumb className="thumb" aria-label="Step" aria-valuetext={`${step.stepId}: ${step.label}`} />
        </Slider.Root>
        <div className="marks" style={{ gridTemplateColumns: `repeat(${run.steps.length}, 1fr)` }}>
          {run.steps.map((s, i) => <button key={s.stepId} className={`m-${s.decision}${s.tamper ? ' tam' : ''}`} aria-current={i === index} aria-label={`${s.stepId} ${s.decision}${s.tamper ? `, tampered: ${s.tamper.kind}` : ''}`} onClick={() => setIndex(i)}><i /></button>)}
        </div>
        <p className="legend"><span><i style={{ background: 'var(--ok)' }} />accepted</span><span><i style={{ background: 'var(--warn)' }} />neutralized (client values overridden)</span><span><i style={{ background: 'var(--tamper)' }} />rejected</span><span><i style={{ boxShadow: '0 0 0 2px var(--tamper)', background: 'transparent' }} />ring = script marks this step as tampered (annotation only; findings come from claim ≠ truth)</span><span><i style={{ background: 'var(--client)' }} />client-controlled</span><span><i style={{ background: 'var(--server)' }} />server-derived</span><span><i style={{ background: 'var(--session)' }} />session-derived</span></p>
      </section>

      <section className="compare" aria-label="Both servers compared" tabIndex={0}>
        <h2>Same events, both servers</h2>
        <table>
          <thead><tr><th>Step</th><th>Event</th><th>Tamper</th><th>Trusting server</th><th>Enforcing server</th><th>Weakness when trusted</th></tr></thead>
          <tbody>
            {scenario.steps.map((s, i) => {
              const t = runs.trusting.steps[i]; const e = runs.enforcing.steps[i];
              return (
                <tr key={s.id} aria-selected={i === index} onClick={() => setIndex(i)} tabIndex={0} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setIndex(i); } }}>
                  <td><code>{s.id}</code></td><td>{s.label}</td><td>{s.tamper ? <span className="tam-chip">{s.tamper.kind}</span> : '—'}</td>
                  <td><span className={`decision d-${t.decision}`}>{t.decision}</span></td><td><span className={`decision d-${e.decision}`}>{e.decision}</span></td>
                  <td>{t.finding ? `${t.finding.cwe} · ${t.finding.title}` : e.finding ? `${e.finding.cwe} (enforcing!)` : t.divergences.length ? 'claims diverge but step not accepted' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <details className="import">
        <summary>Import a scenario (synthetic JSON, max {Math.round(LIMITS.maxBytes / 1024)} KB, {LIMITS.maxSteps} steps)</summary>
        <label className="sr-only" htmlFor="scenario-json">Scenario JSON</label>
        <textarea id="scenario-json" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} placeholder="Paste a seamline.scenario/1 document, or load the demo to edit it." />
        <div className="row">
          <button className="btn small" onClick={() => { setDraft(JSON.stringify(fixture, null, 2)); setErrors([]); }}>Load demo into editor</button>
          <label className="btn small" htmlFor="scenario-file">Choose file…<input id="scenario-file" type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <button className="btn small primary" onClick={applyImport}>Validate and load</button>
          <span className="notice" role="status">{notice}</span>
        </div>
        {errors.length > 0 && <ul className="errors" role="alert">{errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </details>

      <footer className="foot">
        Seamline replays a scripted sequence of client events through a tamper layer into one of two server models. A finding is raised only when a server <em>accepts</em> a message whose security-relevant claims (price, discount, points, role, object owner, nonce, timestamp, line quantity) differ from what the server can establish itself or allow; the script's tamper labels are annotations, not the oracle. The scenario is scripted — the tool illustrates known weakness classes (CWE-602, CWE-294, CWE-269, CWE-639, CWE-20), it does not discover arbitrary flaws. No device, network or real backend is involved; state resets on refresh.
      </footer>
    </div>
  );
}

function scenarioTamperNote(step: StepResult): string {
  const notes: Record<string, string> = {
    'price-rewrite': 'Unit prices and total rewritten before transmission.',
    'coupon-inflate': 'Discount percent inflated while keeping the real code.',
    'points-inflate': 'Points cost lowered.',
    'role-escalate': 'A role field the client never legitimately sends was added.',
    'other-user-object': 'orderId swapped for another user\u2019s order.',
    backdate: 'Timestamp moved ten minutes into the past.',
    replay: `Nonce and payload copied from ${step.tamper?.of}; only the timestamp is new.`,
    'quantity-rewrite': `Quantity of the first order line rewritten to ${step.tamper?.value ?? -1}; the total is recomputed from the client’s own unit prices, so only the quantity bound is violated.`,
  };
  return notes[step.tamper?.kind ?? ''] ?? '';
}
