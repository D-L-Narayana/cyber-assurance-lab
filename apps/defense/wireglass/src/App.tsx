import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { parseLogs, DEFAULT_LIMITS } from './engine/parse';
import { runRules, correlateAlerts, DEFAULT_RULE_CONFIG, RULE_CATALOG, type RuleConfig } from './engine/rules';
import { createTriage, transitionAlert, type TriageState, type Disposition, type Status } from './engine/triage';
import { buildReport } from './engine/report';
import { generateScenario, SCENARIOS, type ScenarioId } from './engine/scenario';
import type { Alert } from './engine/types';
import { Timeline } from './ui/Timeline';

type Filter = 'all' | Status;
const fmt = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

const PRIMER: Record<string, { title: string; fields: [string, string][]; triage: string }> = {
  dns: { title: 'DNS — name resolution (UDP/TCP 53)', fields: [['qtype', 'Record type requested: A (IPv4), AAAA (IPv6), TXT (free text, abused for tunnelling).'], ['qname', 'The name asked for. Labels are dot-separated; each label max 63 chars, whole name max 253.'], ['rcode', 'Server answer code. NOERROR = found, NXDOMAIN = no such name, SERVFAIL = server problem.']], triage: 'Ask: who else resolved this domain? Is the label human-readable? Does the host also show HTTP to the same destination?' },
  http: { title: 'HTTP — web requests (TCP 80/443)', fields: [['method', 'GET reads, POST/PUT send data. Large POST/PUT bodies are the natural place for exfiltration.'], ['status', '2xx success, 3xx redirect, 401 unauthenticated, 403 forbidden, 5xx server error.'], ['user agent', 'Self-declared client string. Easy to forge, but scripted defaults (curl, python-requests) are a cheap signal.']], triage: 'Ask: is the destination internal (RFC 1918) or external? Is the cadence machine-regular? Did a failure burst end with a 200?' },
  smtp: { title: 'SMTP — mail submission and relay (TCP 25/587)', fields: [['from / to', 'Envelope sender and recipient. The recipient domain tells you whether mail leaves the organisation.'], ['server', 'Which mail server accepted the message.'], ['status', 'sent, deferred or bounced.']], triage: 'Ask: is the sending host a registered relay? How many distinct recipient domains in ten minutes? Does the sender address match the host owner?' },
};

export function App() {
  const [scenario, setScenario] = useState<ScenarioId>('mixed-day');
  const [seed, setSeed] = useState(7);
  const [rawLog, setRawLog] = useState(() => generateScenario('mixed-day', 7));
  const [config, setConfig] = useState<RuleConfig>(DEFAULT_RULE_CONFIG);
  const [triage, setTriage] = useState<TriageState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [pivotSrc, setPivotSrc] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [dispo, setDispo] = useState<Disposition>('true_positive');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const parsed = useMemo(() => parseLogs(rawLog), [rawLog]);
  const alerts = useMemo(() => runRules(parsed.events, config), [parsed, config]);
  const chains = useMemo(() => correlateAlerts(alerts, 30 * 60_000), [alerts]);
  const tri = useMemo<TriageState>(() => {
    const base = createTriage(alerts.map(a => a.id));
    if (!triage) return base;
    for (const id of Object.keys(base)) if (triage[id]) base[id] = triage[id];
    return base;
  }, [alerts, triage]);

  const visible = alerts.filter(a => filter === 'all' || tri[a.id].status === filter).filter(a => !pivotSrc || a.src === pivotSrc);
  const current: Alert | null = alerts.find(a => a.id === selected) ?? null;
  const currentEvents = current ? parsed.events.filter(e => current.eventIds.includes(e.id)) : [];
  const pivotEvents = pivotSrc ? parsed.events.filter(e => e.src === pivotSrc) : [];
  const counts = { new: 0, investigating: 0, closed: 0 };
  for (const a of alerts) counts[tri[a.id].status]++;

  function regenerate(nextScenario = scenario, nextSeed = seed) {
    setRawLog(generateScenario(nextScenario, nextSeed));
    setTriage(null); setSelected(null); setPivotSrc(null);
    setStatus(`Generated "${nextScenario}" with seed ${nextSeed}.`);
  }
  function applyPaste() {
    if (pasteText.length > DEFAULT_LIMITS.maxBytes) { setPasteError(`Paste is ${pasteText.length.toLocaleString()} characters; the limit is ${DEFAULT_LIMITS.maxBytes.toLocaleString()}.`); return; }
    const test = parseLogs(pasteText);
    if (!test.events.length) { setPasteError(test.errors[0] ? `No events parsed. Line ${test.errors[0].line}: ${test.errors[0].reason}` : 'No events parsed. Paste at least one line in the documented format.'); return; }
    setRawLog(pasteText); setTriage(null); setSelected(null); setPivotSrc(null); setPasteOpen(false); setPasteError(null);
    setStatus(`Parsed ${test.events.length} events from pasted text${test.truncated ? ' (input truncated at the limit)' : ''}.`);
  }
  function move(to: Status) {
    if (!current) return;
    const res = transitionAlert(tri, current.id, { to, disposition: to === 'closed' ? dispo : undefined, note: note || undefined, at: Date.now() });
    if (!res.ok) { setFormError(res.reason); return; }
    setFormError(null); setTriage(res.state); setNote('');
    setStatus(`Alert ${current.ruleId} marked ${to}.`);
  }
  function exportReport() {
    const report = buildReport({ events: parsed.events, alerts, triage: tri, config, generatedAt: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `wireglass-report-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported report with ${alerts.length} alerts.`);
  }
  const num = (k: keyof RuleConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v >= 0 && v <= 1e9) setConfig(c => ({ ...c, [k]: v }));
  };
  const list = (k: 'dnsSuffixAllowlist' | 'smtpRelayAllowlist' | 'scriptedUaPatterns') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig(c => ({ ...c, [k]: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50) }));

  return (
    <div className="app">
      <a className="skip" href="#queue">Skip to alert queue</a>
      <header className="bench-head">
        <div className="brand">
          <h1>Wireglass</h1>
          <p className="tagline">Synthetic DNS · HTTP · SMTP detection workbench — educational prototype, nothing leaves this browser.</p>
        </div>
        <form className="controls" onSubmit={e => { e.preventDefault(); regenerate(); }}>
          <label>Scenario
            <select value={scenario} onChange={e => { const s = e.target.value as ScenarioId; setScenario(s); regenerate(s, seed); }}>
              {Object.keys(SCENARIOS).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>Seed
            <input type="number" min={0} max={9999} value={seed} onChange={e => setSeed(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))} />
          </label>
          <button type="submit" className="btn">Regenerate</button>
          <Dialog.Root open={pasteOpen} onOpenChange={setPasteOpen}>
            <Dialog.Trigger asChild><button type="button" className="btn btn-quiet">Paste logs</button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dlg-overlay" />
              <Dialog.Content className="dlg" aria-describedby="paste-desc">
                <Dialog.Title>Paste synthetic log lines</Dialog.Title>
                <Dialog.Description id="paste-desc">One event per line, up to {DEFAULT_LIMITS.maxLines.toLocaleString()} lines / {DEFAULT_LIMITS.maxBytes.toLocaleString()} characters. Formats: <code>ts DNS src query qtype qname rcode</code>, <code>ts HTTP src dst method path status bytes "ua"</code>, <code>ts SMTP src server from=&lt;a&gt; to=&lt;b&gt; status=s</code>. Paste only synthetic or sanitised data.</Dialog.Description>
                <label className="visually-hidden" htmlFor="paste-area">Log text</label>
                <textarea id="paste-area" rows={10} value={pasteText} onChange={e => setPasteText(e.target.value)} spellCheck={false} />
                {pasteError && <p role="alert" className="error">{pasteError}</p>}
                <div className="dlg-actions">
                  <Dialog.Close asChild><button type="button" className="btn btn-quiet">Cancel</button></Dialog.Close>
                  <button type="button" className="btn" onClick={applyPaste}>Parse and replace</button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <button type="button" className="btn btn-quiet" onClick={exportReport} disabled={!alerts.length}>Export JSON</button>
        </form>
      </header>
      <p className="scenario-note">{SCENARIOS[scenario]}</p>
      <p className="status" role="status" aria-live="polite">{status}</p>

      <section className="lanes" aria-label="Protocol timeline">
        <Timeline events={parsed.events} alerts={alerts} selectedAlertId={selected} pivotSrc={pivotSrc} onSelectAlert={id => { setSelected(id); setFormError(null); }} />
        <div className="lane-stats">
          <span>{parsed.events.length.toLocaleString()} events</span>
          <span>{parsed.errors.length} parse errors</span>
          <span>{alerts.length} alerts</span>
          <span>{chains.length} multi-protocol chains</span>
          {parsed.truncated && <span className="warn">input truncated at limit</span>}
          {pivotSrc && <button type="button" className="chip chip-pivot" onClick={() => setPivotSrc(null)}>Pivot: {pivotSrc} ✕</button>}
        </div>
      </section>

      <main className="bench">
        <section className="queue" id="queue" aria-labelledby="queue-h">
          <div className="queue-head">
            <h2 id="queue-h">Alert queue</h2>
            <ToggleGroup.Root type="single" value={filter} onValueChange={v => v && setFilter(v as Filter)} aria-label="Filter alerts by status" className="toggle">
              <ToggleGroup.Item value="all">All {alerts.length}</ToggleGroup.Item>
              <ToggleGroup.Item value="new">New {counts.new}</ToggleGroup.Item>
              <ToggleGroup.Item value="investigating">Working {counts.investigating}</ToggleGroup.Item>
              <ToggleGroup.Item value="closed">Closed {counts.closed}</ToggleGroup.Item>
            </ToggleGroup.Root>
          </div>
          {visible.length === 0 ? (
            <p className="empty">{alerts.length === 0 ? 'No alerts for this input. Either the traffic is benign or the thresholds are too loose — compare with the "mixed-day" scenario.' : 'No alerts match this filter.'}</p>
          ) : (
            <ul className="alert-list">
              {visible.map(a => (
                <li key={a.id}>
                  <button type="button" className={`alert-row sev-${a.severity} ${a.id === selected ? 'is-selected' : ''}`} onClick={() => { setSelected(a.id); setFormError(null); }} aria-pressed={a.id === selected}>
                    <span className={`proto lane-${a.proto}`}>{a.proto.toUpperCase()}</span>
                    <span className="rule">{a.ruleId}</span>
                    <span className="name">{a.ruleName}</span>
                    <span className="src mono">{a.src}</span>
                    <span className={`state state-${tri[a.id].status}`}>{tri[a.id].status}{tri[a.id].disposition ? ` · ${tri[a.id].disposition!.replace('_', ' ')}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chains.length > 0 && (
            <div className="chains">
              <h3>Correlated chains (same source, ≥ 2 protocols, 30 min)</h3>
              {chains.map(c => (
                <button type="button" key={c.id} className="chain" onClick={() => setPivotSrc(c.src)}>
                  <span className="mono">{c.src}</span> · {c.protocols.map(p => p.toUpperCase()).join(' + ')} · {c.alertIds.length} alerts · {fmt(c.firstTs).slice(11)}–{fmt(c.lastTs).slice(11)}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="detail" aria-labelledby="detail-h">
          <h2 id="detail-h">{current ? `${current.ruleId} · ${current.ruleName}` : 'Alert detail'}</h2>
          {!current ? (
            <p className="empty">Select an alert in the queue or click a bracket on the timeline. The detail pane shows why the rule fired, the exact events, and the triage form.</p>
          ) : (
            <>
              <dl className="facts">
                <div><dt>Severity</dt><dd className={`sev-text sev-${current.severity}`}>{current.severity}</dd></div>
                <div><dt>Source</dt><dd><button type="button" className="chip" onClick={() => setPivotSrc(current.src)} title="Show every event from this host">{current.src} · pivot</button></dd></div>
                <div><dt>Destination</dt><dd className="mono">{current.dst ?? '—'}</dd></div>
                <div><dt>Window</dt><dd className="mono">{fmt(current.firstTs)} → {fmt(current.lastTs).slice(11)}</dd></div>
                <div><dt>Events</dt><dd>{current.eventIds.length}</dd></div>
              </dl>
              <p className="explain">{current.explanation}</p>
              <h3>Why it fired</h3>
              <ul className="evidence">{current.evidence.map((e, i) => <li key={i} className="mono">{e}</li>)}</ul>
              <h3>Matched events</h3>
              <div className="table-wrap" tabIndex={0} aria-label="Matched events table, scrollable">
                <table className="events">
                  <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Proto</th><th scope="col">Source</th><th scope="col">Summary</th></tr></thead>
                  <tbody>{currentEvents.slice(0, 40).map(e => <tr key={e.id}><td className="mono">{fmt(e.ts).slice(11)}</td><td><span className={`proto lane-${e.proto}`}>{e.proto.toUpperCase()}</span></td><td className="mono">{e.src}</td><td className="mono">{e.summary}</td></tr>)}</tbody>
                </table>
                {currentEvents.length > 40 && <p className="muted">Showing 40 of {currentEvents.length} events.</p>}
              </div>
              <h3>Triage</h3>
              <div className="triage">
                <p>Status: <strong>{tri[current.id].status}</strong>{tri[current.id].disposition && <> · disposition <strong>{tri[current.id].disposition}</strong></>}</p>
                <label>Evidence note
                  <input type="text" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="What did you check? Required to close." />
                </label>
                <label>Disposition
                  <select value={dispo} onChange={e => setDispo(e.target.value as Disposition)}>
                    <option value="true_positive">True positive — needs action</option>
                    <option value="false_positive">False positive — rule needs tuning</option>
                    <option value="benign_expected">Benign / expected — document and close</option>
                  </select>
                </label>
                <div className="triage-actions">
                  <button type="button" className="btn btn-quiet" onClick={() => move('investigating')} disabled={tri[current.id].status === 'investigating'}>Start investigating</button>
                  <button type="button" className="btn" onClick={() => move('closed')} disabled={tri[current.id].status !== 'investigating'}>Close with evidence</button>
                  <button type="button" className="btn btn-quiet" onClick={() => move('new')} disabled={tri[current.id].status !== 'investigating'}>Back to new</button>
                </div>
                {formError && <p role="alert" className="error">{formError}</p>}
                {tri[current.id].history.length > 0 && (
                  <ol className="history">{tri[current.id].history.map((h, i) => <li key={i}><span className="mono">{new Date(h.at).toISOString().slice(11, 19)}</span> {h.from} → {h.to}{h.note ? ` — ${h.note}` : ''}</li>)}</ol>
                )}
              </div>
            </>
          )}
          {pivotSrc && (
            <>
              <h3>Pivot: all {pivotEvents.length} events from {pivotSrc}</h3>
              <div className="table-wrap">
                <table className="events">
                  <thead><tr><th scope="col">Time</th><th scope="col">Proto</th><th scope="col">Summary</th></tr></thead>
                  <tbody>{pivotEvents.slice(0, 60).map(e => <tr key={e.id}><td className="mono">{fmt(e.ts).slice(11)}</td><td><span className={`proto lane-${e.proto}`}>{e.proto.toUpperCase()}</span></td><td className="mono">{e.summary}</td></tr>)}</tbody>
                </table>
                {pivotEvents.length > 60 && <p className="muted">Showing 60 of {pivotEvents.length}.</p>}
              </div>
            </>
          )}
        </section>

        <aside className="side">
          <Tabs.Root defaultValue="rules">
            <Tabs.List aria-label="Reference panels" className="tabs">
              <Tabs.Trigger value="rules">Rules</Tabs.Trigger>
              <Tabs.Trigger value="primer">Protocol primer</Tabs.Trigger>
              <Tabs.Trigger value="errors">Parse errors ({parsed.errors.length})</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="rules" className="tab-body">
              <p className="muted">Thresholds re-run instantly. Closed alerts keep their notes while the alert id is stable.</p>
              <fieldset><legend>DNS-001 label analysis</legend>
                <label>Long-label length <input type="number" min={10} max={63} value={config.dnsLongLabel} onChange={num('dnsLongLabel')} /></label>
                <label>Entropy threshold (bits/char) <input type="number" step={0.1} min={1} max={6} value={config.dnsEntropyThreshold} onChange={num('dnsEntropyThreshold')} /></label>
                <label>Allowlisted suffixes <input type="text" value={config.dnsSuffixAllowlist.join(', ')} onChange={list('dnsSuffixAllowlist')} /></label>
              </fieldset>
              <fieldset><legend>DNS-002 NXDOMAIN burst</legend>
                <label>Count <input type="number" min={2} max={1000} value={config.nxdomainBurst} onChange={num('nxdomainBurst')} /></label>
                <label>Window (s) <input type="number" min={1} max={86400} value={config.nxdomainWindowSec} onChange={num('nxdomainWindowSec')} /></label>
              </fieldset>
              <fieldset><legend>HTTP-001 auth failures</legend>
                <label>Count <input type="number" min={2} max={1000} value={config.authFailBurst} onChange={num('authFailBurst')} /></label>
                <label>Window (s) <input type="number" min={1} max={86400} value={config.authFailWindowSec} onChange={num('authFailWindowSec')} /></label>
              </fieldset>
              <fieldset><legend>HTTP-002 scripted upload</legend>
                <label>Bytes <input type="number" min={1} max={1e12} value={config.uploadBytes} onChange={num('uploadBytes')} /></label>
                <label>Scripted UA patterns <input type="text" value={config.scriptedUaPatterns.join(', ')} onChange={list('scriptedUaPatterns')} /></label>
              </fieldset>
              <fieldset><legend>SMTP-001 mail fan-out</legend>
                <label>Distinct domains <input type="number" min={2} max={1000} value={config.smtpDistinctDomains} onChange={num('smtpDistinctDomains')} /></label>
                <label>Window (s) <input type="number" min={1} max={86400} value={config.smtpWindowSec} onChange={num('smtpWindowSec')} /></label>
                <label>Relay allowlist (IPs) <input type="text" value={config.smtpRelayAllowlist.join(', ')} onChange={list('smtpRelayAllowlist')} /></label>
              </fieldset>
              <button type="button" className="btn btn-quiet" onClick={() => setConfig(DEFAULT_RULE_CONFIG)}>Reset thresholds</button>
              <h3>Rule catalogue</h3>
              {RULE_CATALOG.map(r => (
                <details key={r.id} className="rule-card">
                  <summary><span className={`proto lane-${r.proto}`}>{r.proto.toUpperCase()}</span> {r.id} · {r.name}</summary>
                  <p>{r.what}</p>
                  <p><strong>Known false positives:</strong> {r.falsePositives}</p>
                </details>
              ))}
            </Tabs.Content>
            <Tabs.Content value="primer" className="tab-body">
              {Object.entries(PRIMER).map(([k, p]) => (
                <section key={k} className="primer">
                  <h3 className={`lane-${k}`}>{p.title}</h3>
                  <dl>{p.fields.map(([f, d]) => <div key={f}><dt>{f}</dt><dd>{d}</dd></div>)}</dl>
                  <p><strong>Triage questions:</strong> {p.triage}</p>
                </section>
              ))}
            </Tabs.Content>
            <Tabs.Content value="errors" className="tab-body">
              {parsed.errors.length === 0 ? <p className="empty">Every line parsed.</p> : (
                <ul className="errors">{parsed.errors.slice(0, 50).map(e => <li key={e.line}><span className="mono">line {e.line}</span>: {e.reason}<br /><code>{e.raw}</code></li>)}</ul>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </main>
      <footer className="foot">
        <p>Educational prototype. Deterministic rules over synthetic logs; not an IDS, not a security certification. State lives in memory and resets on refresh — export JSON to keep it.</p>
      </footer>
    </div>
  );
}
