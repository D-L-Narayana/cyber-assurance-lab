import { useMemo, useRef, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { BUILDS, LAB_ROUTES, LIMITS, makeMarker, validateLabRequest } from './engine/lab';
import type { Build, LabRequest, Session } from './engine/lab';
import { ORACLES, evaluateOracle, suggestOracles } from './engine/oracles';
import type { OracleSpec } from './engine/oracles';
import { CATALOG } from './engine/catalog';
import { createNotebook, rateSeverity } from './engine/notebook';
import type { Finding, Level, NotebookState, Observation } from './engine/notebook';
import { buildReport, reportToMarkdown } from './engine/report';

const SCOPE = 'Ledgerly lab — deterministic application simulated in this browser tab';
const LEVELS: Level[] = ['high', 'medium', 'low'];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
const fmtReq = (r: LabRequest) => `${r.method} ${r.path}${r.query && Object.keys(r.query).length ? '?' + new URLSearchParams(r.query).toString() : ''}`;

export default function App() {
  const notebook = useRef(createNotebook()).current;
  const [state, setState] = useState<NotebookState>(notebook.state());
  const [build, setBuild] = useState<Build>('v1');
  const [routeIdx, setRouteIdx] = useState(0);
  const [params, setParams] = useState<Record<string, string>>({ q: makeMarker('manual-probe'), id: 'r-200', user: 'alice' });
  const [session, setSession] = useState<Session | ''>('alice');
  const [note, setNote] = useState('');
  const [benchError, setBenchError] = useState('');
  const [benchNotice, setBenchNotice] = useState('Demo data: nothing here touches a network. Pick a route, send, then record what the oracle says.');
  const [currentObs, setCurrentObs] = useState<Observation | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [wontFixNote, setWontFixNote] = useState('');
  const [pageError, setPageError] = useState('');

  const refresh = () => setState(notebook.state());
  const route = LAB_ROUTES[routeIdx];

  const composed: LabRequest = useMemo(() => {
    const path = route.path.replace('{id}', (params.id ?? '').trim() || 'r-100');
    const req: LabRequest = { method: route.method, path };
    if (route.method === 'GET' && route.params.includes('q' as never)) req.query = { q: params.q ?? '' };
    if (route.method === 'POST') req.body = { user: params.user ?? '' };
    if (session) req.session = session;
    return req;
  }, [route, params, session]);
  const composedValid = validateLabRequest(composed);

  async function send() {
    setBenchError('');
    if (!composedValid.ok) { setBenchError(composedValid.error); return; }
    try {
      const obs = await notebook.observe(build, composed, note || `manual: ${fmtReq(composed)}`);
      setCurrentObs(obs); refresh();
      setBenchNotice(`Observation ${obs.id} recorded on ${build} (HTTP ${obs.response.status}).`);
    } catch (e) { setBenchError((e as Error).message); }
  }
  function record(obs: Observation, oracle: OracleSpec) {
    const def = ORACLES[oracle.kind];
    const r = notebook.recordFinding(obs.id, oracle, { impact: def.defaultImpact, likelihood: def.defaultLikelihood });
    if (!r.ok) { setBenchError(r.error); return; }
    refresh(); setSelectedFinding(r.finding.id);
    setBenchNotice(r.merged ? `Evidence merged into existing ${r.finding.id} (same endpoint and weakness).` : `New finding ${r.finding.id} opened.`);
  }
  async function runCatalog() {
    setBenchError('');
    try {
      const s = await notebook.runCatalog(build);
      refresh();
      setBenchNotice(`Catalog on ${build}: ${s.executed} cases executed, ${s.recorded} new finding(s), ${s.merged} merged, ${s.clean.length} clean (${s.clean.join(', ') || 'none'}).`);
      const last = notebook.state().observations.at(-1) ?? null; setCurrentObs(last);
    } catch (e) { setBenchError((e as Error).message); }
  }
  function exportReport(kind: 'json' | 'md') {
    const report = buildReport(notebook.state(), { scope: SCOPE });
    if (kind === 'json') download('assaynotebook-report.json', JSON.stringify(report, null, 2), 'application/json');
    else download('assaynotebook-report.md', reportToMarkdown(report), 'text/markdown');
  }
  function resetNotebook() {
    // In-memory only: a fresh notebook is a new engine instance.
    window.location.reload();
  }

  const finding = state.findings.find((f) => f.id === selectedFinding) ?? state.findings[0];
  const obsById = useMemo(() => new Map(state.observations.map((o) => [o.id, o])), [state]);
  const suggestions = currentObs ? suggestOracles(currentObs.request, currentObs.response) : [];

  return (
    <div>
      <header className="masthead">
        <h1>Assay Notebook<small>web assessment notebook with an in-tab lab</small></h1>
        <span className="badge">educational · simulated target · not a penetration test</span>
        <div className="right">
          <span className="hint">Lab build</span>
          <ToggleGroup.Root type="single" value={build} onValueChange={(v) => v && setBuild(v as Build)} className="toggle-group" aria-label="Lab build">
            {BUILDS.map((b) => <ToggleGroup.Item key={b.id} value={b.id} className="toggle-item" title={b.label}>{b.id}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
          <button className="btn primary" onClick={() => void runCatalog()}>Run catalog ({CATALOG.length} cases) on {build}</button>
          <button className="btn" onClick={() => exportReport('md')} disabled={state.findings.length === 0}>Export write-up (.md)</button>
          <button className="btn" onClick={() => exportReport('json')} disabled={state.observations.length === 0}>Export notebook (.json)</button>
          <button className="btn small" onClick={resetNotebook}>Reset</button>
        </div>
      </header>

      <main className="spread">
        <section className="leaf" aria-labelledby="bench-h">
          <h2 id="bench-h">Bench · {BUILDS.find((b) => b.id === build)?.label}</h2>
          <p>Compose a request against the lab application. Only the four lab routes exist; absolute URLs are refused.</p>
          <div className="composer">
            <div className="field">
              <label htmlFor="route">Route</label>
              <select id="route" value={routeIdx} onChange={(e) => setRouteIdx(Number(e.target.value))}>
                {LAB_ROUTES.map((r, i) => <option key={r.path} value={i}>{r.method} {r.path}</option>)}
              </select>
              <span className="hint">{route.description}</span>
            </div>
            {route.params.map((p) => (
              <div className="field" key={p}>
                <label htmlFor={`param-${p}`}>{p}{p === 'q' ? ' (search term; the probe marker is harmless)' : p === 'id' ? ' (alice owns r-100, r-101; bob owns r-200)' : ''}</label>
                <input id={`param-${p}`} value={params[p] ?? ''} maxLength={LIMITS.maxParamLength} onChange={(e) => setParams({ ...params, [p]: e.target.value })} />
              </div>
            ))}
            <div className="field">
              <label htmlFor="session">Session</label>
              <select id="session" value={session} onChange={(e) => setSession(e.target.value as Session | '')}>
                <option value="">none (anonymous)</option><option value="alice">alice</option><option value="bob">bob</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="note">Observation note</label>
              <input id="note" value={note} maxLength={200} placeholder="why you are sending this" onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <code>{fmtReq(composed)}</code>
              <span className="spacer" />
              <button className="btn primary" onClick={() => void send()} disabled={!composedValid.ok}>Send to {build}</button>
            </div>
            {!composedValid.ok && <p className="error" role="alert">{composedValid.error}</p>}
            {benchError && <p className="error" role="alert">{benchError}</p>}
            {benchNotice && !benchError && <p className="notice" role="status">{benchNotice}</p>}
          </div>

          {currentObs && (
            <div className="exchange" aria-live="polite">
              <div className="status"><span className="label">{currentObs.id} · {currentObs.build}</span><b className={`s${Math.floor(currentObs.response.status / 100)}`}>HTTP {currentObs.response.status}</b><span className="specimen">sha256 {currentObs.hash.slice(0, 16)}…</span></div>
              <div><div className="label">Request</div><pre tabIndex={0}>{`${fmtReq(currentObs.request)}${currentObs.request.session ? `\nCookie: sid=[session:${currentObs.request.session}]` : ''}${currentObs.request.body ? `\n\n${new URLSearchParams(currentObs.request.body).toString()}` : ''}`}</pre></div>
              <div><div className="label">Response headers</div><pre tabIndex={0}>{Object.entries(currentObs.response.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre></div>
              <div><div className="label">Response body (shown as text, never rendered)</div><pre tabIndex={0}>{currentObs.response.body || '(empty)'}</pre></div>
              <div className="suggest">
                <div className="label">Oracles for this exchange</div>
                {suggestions.length === 0 && <span className="quiet">No oracle applies to this route/response.</span>}
                {suggestions.map((s) => {
                  const v = evaluateOracle(s, currentObs.request, currentObs.response);
                  return (
                    <div className="item" key={s.kind}>
                      <span className={v.vulnerable ? 'fired' : 'quiet'}>{v.vulnerable ? 'fired' : 'quiet'}</span>
                      <span>{ORACLES[s.kind].title} <code>{ORACLES[s.kind].cwe}</code> — {v.evidence}</span>
                      {v.vulnerable && <button className="btn small" onClick={() => record(currentObs, s)}>Record as finding</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="obslog">
            <h2>Observations ({state.observations.length})</h2>
            {state.observations.length === 0 && <p className="empty">Nothing observed yet. Send a request or run the catalog.</p>}
            <ol>
              {[...state.observations].reverse().map((o) => (
                <li key={o.id}><button aria-pressed={currentObs?.id === o.id} onClick={() => setCurrentObs(o)}><span>{o.id} · {o.build} · {fmtReq(o.request)} → {o.response.status}</span><span className="tag">{o.hash.slice(0, 8)}</span></button></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="leaf" aria-labelledby="nb-h">
          <h2 id="nb-h">Notebook · {state.findings.length} finding{state.findings.length === 1 ? '' : 's'}</h2>
          {state.findings.length === 0 && <p className="empty">Findings appear here once an oracle fires and you record it. Each finding keeps its evidence hashes, a severity rationale and a retest trail. Duplicate observations of the same weakness on the same endpoint merge into one finding.</p>}
          <div className="pages">
            {state.findings.map((f) => (
              <button key={f.id} aria-pressed={finding?.id === f.id} onClick={() => { setSelectedFinding(f.id); setPageError(''); }}>
                <span className="fid">{f.id}</span><span className="ttl">{f.title}<br /><span className="hint">{f.cwe} · {f.endpoint} · {f.status.replace(/-/g, ' ')}</span></span><span className={`sev sev-${f.severity}`}>{f.severity}</span>
              </button>
            ))}
          </div>
          {finding && <FindingPage key={finding.id} finding={finding} obsById={obsById} build={build} notebook={notebook} refresh={refresh} wontFixNote={wontFixNote} setWontFixNote={setWontFixNote} pageError={pageError} setPageError={setPageError} />}
        </section>
      </main>
      <footer className="foot">
        The target is a pure function inside this page: three builds of a fictional expense app with five seeded weaknesses. Oracles are declarative checks on the exchange; "fixed" and "still open" can only be reached by an automated retest that replays the original request. Nothing leaves the tab; state resets on refresh, so export the notebook to keep it.
      </footer>
    </div>
  );
}

function FindingPage(props: { finding: Finding; obsById: Map<string, Observation>; build: Build; notebook: ReturnType<typeof createNotebook>; refresh: () => void; wontFixNote: string; setWontFixNote: (s: string) => void; pageError: string; setPageError: (s: string) => void }) {
  const { finding: f, obsById, build, notebook, refresh, wontFixNote, setWontFixNote, pageError, setPageError } = props;
  const act = (r: { ok: boolean; error?: string }) => { if (!r.ok) setPageError(r.error ?? 'Action refused.'); else setPageError(''); refresh(); };
  const first = obsById.get(f.evidence[0]?.observationId);
  return (
    <article className="page" aria-labelledby={`f-${f.id}`}>
      <span className={`stamp st-${f.status}`} aria-label={`status ${f.status}`}>{f.status === 'fixed' ? `fixed · retest ${f.retests.at(-1)?.build}` : f.status.replace(/-/g, ' ')}</span>
      <h3 id={`f-${f.id}`}>{f.id} — {f.title}</h3>
      <div className="map">{f.cwe} {f.cweName} · {f.owasp2021} · <code>{f.endpoint}</code></div>
      <dl>
        <dt>reproduce</dt><dd>{first ? <code>{fmtReq(first.request)}{first.request.session ? ` (session ${first.request.session})` : ''}</code> : '—'}{CATALOG.find((c) => c.oracle.kind === f.oracle.kind) && <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 14 }}>{CATALOG.find((c) => c.oracle.kind === f.oracle.kind)!.steps.map((s) => <li key={s}>{s}</li>)}</ol>}</dd>
        <dt>severity</dt>
        <dd>
          <div className="rubric">
            <span><span className="lbl">impact</span>
              <ToggleGroup.Root type="single" value={f.impact} className="toggle-group" aria-label="Impact" onValueChange={(v) => v && act(notebook.rerate(f.id, v as Level, f.likelihood))}>{LEVELS.map((l) => <ToggleGroup.Item key={l} value={l} className="toggle-item small">{l}</ToggleGroup.Item>)}</ToggleGroup.Root></span>
            <span><span className="lbl">likelihood</span>
              <ToggleGroup.Root type="single" value={f.likelihood} className="toggle-group" aria-label="Likelihood" onValueChange={(v) => v && act(notebook.rerate(f.id, f.impact, v as Level))}>{LEVELS.map((l) => <ToggleGroup.Item key={l} value={l} className="toggle-item small">{l}</ToggleGroup.Item>)}</ToggleGroup.Root></span>
            <span className={`sev sev-${f.severity}`}>{rateSeverity(f.impact, f.likelihood)}</span>
          </div>
        </dd>
        <dt>rationale</dt>
        <dd><textarea aria-label="Severity rationale" defaultValue={f.rationale} maxLength={1000} onBlur={(e) => act(notebook.rerate(f.id, f.impact, f.likelihood, e.target.value))} /></dd>
        <dt>evidence</dt>
        <dd><ul className="evidence">{f.evidence.map((e) => <li key={e.observationId}><span className="specimen">{e.observationId} · {e.hash.slice(0, 12)}</span><span>{e.detail} <span className="hint">({obsById.get(e.observationId)?.build})</span></span></li>)}</ul></dd>
        <dt>remediation</dt><dd>{f.remediation}</dd>
        {f.retests.length > 0 && <><dt>retests</dt><dd><ul className="evidence">{f.retests.map((t) => <li key={t.observationId}><span className="specimen">{t.build} · {t.outcome}</span><span>{t.evidence}</span></li>)}</ul></dd></>}
      </dl>
      <div className="actions">
        {(f.status === 'open' || f.status === 'still-open' || f.status === 'fixed' || f.status === 'wont-fix') && <button className="btn" onClick={() => act(notebook.requestRetest(f.id))}>Request retest</button>}
        {f.status === 'retest-requested' && <button className="btn primary" onClick={() => void notebook.retest(f.id, build).then(act)}>Retest now on {build}</button>}
        {(f.status === 'open' || f.status === 'still-open') && (
          <>
            <input aria-label="Won't-fix rationale" placeholder="won't-fix rationale (10+ chars)" value={wontFixNote} maxLength={300} onChange={(e) => setWontFixNote(e.target.value)} style={{ padding: '5px 8px', border: '1px solid var(--rule)', borderRadius: 4, minWidth: 220 }} />
            <button className="btn small" onClick={() => act(notebook.transition(f.id, 'wont-fix', wontFixNote))}>Mark won't fix</button>
          </>
        )}
        <span className="hint">"fixed" and "still open" are set only by a retest.</span>
      </div>
      {pageError && <p className="error" role="alert">{pageError}</p>}
      <ul className="history" aria-label="Status history">{f.history.map((h, i) => <li key={i}>{h.at.slice(11, 19)} {h.from ?? '·'} → {h.to}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
    </article>
  );
}
