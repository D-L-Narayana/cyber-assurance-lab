import { useMemo, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import { buildBaselines, scoreRecords, applyFeedback, removeFeedback, DEFAULT_CONFIG, FEATURES, type ActivityRecord, type Config, type ReasonCode, type ScoredDay } from './engine/ueba';
import { generateActivity, type Injected } from './engine/synth';
import { evaluateDetections } from './engine/evaluate';
import { parseRecords, LIMITS } from './engine/validate';
import { buildReport, type Disposition } from './engine/report';
import { BandChart } from './ui/BandChart';

const SPLIT = '2026-09-22';
const GLOSSARY: Record<ReasonCode, string> = {
  LOGIN_SPIKE: 'Logins far above this user\'s own median for the same day type.',
  UPLOAD_SPIKE: 'Upload volume far above this user\'s own median.',
  HOST_SPREAD: 'Distinct hosts touched far above this user\'s own median — a lateral-movement shape.',
  AFTER_HOURS: 'Share of after-hours activity far above this user\'s own median.',
  PEER_DEVIATION: 'Normal for this user, but this user\'s normal is far from the department\'s typical user.',
  NO_BASELINE: 'Not enough active history to compare against. Unknown, not suspicious.',
};
const key = (s: { user: string; day: string }) => `${s.user}|${s.day}`;

export function App() {
  const [seed, setSeed] = useState(11);
  const [dataset, setDataset] = useState<{ records: ActivityRecord[]; injected: Injected[]; source: string }>(() => ({ ...generateActivity(11), source: 'synthetic seed 11' }));
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNormal, setShowNormal] = useState(false);
  const [dispositions, setDispositions] = useState<Record<string, { disposition: Disposition; note: string }>>({});
  const [dispo, setDispo] = useState<Disposition>('true_positive');
  const [dispoNote, setDispoNote] = useState('');
  const [feedbackFor, setFeedbackFor] = useState<ReasonCode | null>(null);
  const [rationale, setRationale] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const training = useMemo(() => dataset.records.filter(r => r.day < SPLIT), [dataset]);
  const scoringRows = useMemo(() => dataset.records.filter(r => r.day >= SPLIT), [dataset]);
  const baselines = useMemo(() => buildBaselines(training, config), [training, config]);
  const scored = useMemo(() => scoreRecords(scoringRows, baselines, config), [scoringRows, baselines, config]);
  const alerts = scored.filter(s => s.state === 'alert');
  const unscored = scored.filter(s => s.state === 'unscored');
  const evaluation = useMemo(() => dataset.injected.length ? evaluateDetections(alerts.map(a => ({ user: a.user, day: a.day })), dataset.injected) : null, [alerts, dataset]);
  const queue = (showNormal ? scored.filter(s => s.state !== 'unscored') : alerts).slice().sort((a, b) => b.score - a.score || a.day.localeCompare(b.day));
  const current: ScoredDay | null = scored.find(s => key(s) === selected) ?? null;
  const userRecords = current ? dataset.records.filter(r => r.user === current.user) : [];
  const userBase = current ? baselines.user.get(current.user) : undefined;
  const userSuppressions = current ? config.suppressions.filter(s => s.user === current.user) : [];

  function regenerate() {
    setDataset({ ...generateActivity(seed), source: `synthetic seed ${seed}` });
    setSelected(null); setDispositions({}); setConfig(c => ({ ...c, suppressions: [] }));
    setStatus(`Generated 30 users × 28 days with seed ${seed}.`);
  }
  function doImport() {
    // parseRecords enforces the UTF-8 byte cap before JSON.parse, scans depth/value counts iteratively and applies
    // every row rule (strict calendar days, printable names, finite numbers, no duplicate (user, day) rows);
    // it never throws and reports path-addressed errors (at most LIMITS.maxErrors).
    const v = parseRecords(importText);
    if (!v.ok) { setImportErrors(v.errors); return; }
    setDataset({ records: v.records, injected: [], source: `imported JSON (${v.records.length} records)` });
    setImportErrors([]); setImportOpen(false); setSelected(null); setDispositions({});
    setStatus(`Loaded ${v.records.length} records. No labels, so precision/recall are not shown.`);
  }
  function exportReport() {
    const report = buildReport({ scored, config, dispositions, evaluation: evaluation ?? undefined, generatedAt: new Date().toISOString() });
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `peerline-report-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    setStatus(`Exported ${alerts.length} alerts and ${Object.keys(dispositions).length} dispositions.`);
  }
  function applySuppression() {
    if (!current || !feedbackFor) return;
    if (rationale.trim().length < 3) { setStatus('A rationale is required before suppressing a reason.'); return; }
    setConfig(c => applyFeedback(c, { user: current.user, code: feedbackFor, rationale }));
    setStatus(`Suppressed ${feedbackFor} for ${current.user}; scores recomputed.`);
    setFeedbackFor(null); setRationale('');
  }
  function recordDisposition() {
    if (!current) return;
    setDispositions(d => ({ ...d, [key(current)]: { disposition: dispo, note: dispoNote.trim().slice(0, 300) } }));
    setStatus(`Recorded ${dispo.replace('_', ' ')} for ${current.user} on ${current.day}.`);
    setDispoNote('');
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="page">
        <a className="skip" href="#queue">Skip to anomaly queue</a>
        <header className="masthead">
          <div>
            <p className="eyebrow">Explainable UEBA · educational prototype · synthetic identities only</p>
            <h1>Peerline</h1>
            <p className="lede">Every anomaly comes with the sentence that justifies it: the value, the user's own robust baseline, the measured z-score, and the peer comparison. No opaque model — median and MAD, per day type, with analyst feedback that visibly changes the score.</p>
          </div>
          <div className="masthead-controls">
            <label>Seed <input type="number" min={0} max={9999} value={seed} onChange={e => setSeed(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))} /></label>
            <button type="button" className="btn" onClick={regenerate}>Regenerate population</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setImportOpen(true); setImportErrors([]); }}>Import JSON</button>
            <button type="button" className="btn btn-quiet" onClick={exportReport}>Export JSON</button>
          </div>
        </header>
        <p className="status" role="status" aria-live="polite">{status}</p>

        <section className="strip" aria-label="Scoring configuration and measured evaluation">
          <div className="strip-cell">
            <span className="label">Data</span>
            <strong>{dataset.source}</strong>
            <span className="muted">train {baselines.trainingDays.from} → {baselines.trainingDays.to} · score {SPLIT} → 2026-09-28</span>
          </div>
          <div className="strip-cell slider-cell">
            <label id="threshold-label" className="label">Alert threshold <span id="threshold-value" className="mono">{config.alertThreshold}</span></label>
            <Slider.Root className="slider" min={1} max={20} step={0.5} value={[config.alertThreshold]} onValueChange={([v]) => setConfig(c => ({ ...c, alertThreshold: v }))} aria-labelledby="threshold-label">
              <Slider.Track className="slider-track"><Slider.Range className="slider-range" /></Slider.Track>
              <Slider.Thumb className="slider-thumb" aria-label="Alert threshold" />
            </Slider.Root>
            <label id="z-label" className="label">Spike z-threshold <span className="mono">{config.zThreshold}</span></label>
            <Slider.Root className="slider" min={2} max={6} step={0.5} value={[config.zThreshold]} onValueChange={([v]) => setConfig(c => ({ ...c, zThreshold: v, peerZThreshold: v }))} aria-labelledby="z-label">
              <Slider.Track className="slider-track"><Slider.Range className="slider-range" /></Slider.Track>
              <Slider.Thumb className="slider-thumb" aria-label="Spike z-threshold" />
            </Slider.Root>
          </div>
          <div className="strip-cell">
            <span className="label">Queue</span>
            <strong>{alerts.length} alerts</strong>
            <span className="muted">{scored.length} scored user-days · {unscored.length} unscored (no baseline)</span>
          </div>
          <div className="strip-cell">
            <span className="label">Measured against injected labels</span>
            {evaluation ? (
              <>
                <strong>precision {(evaluation.precision * 100).toFixed(0)}% · recall {(evaluation.recall * 100).toFixed(0)}%</strong>
                <span className="muted">{evaluation.tp} true · {evaluation.fp} false · {evaluation.fn} missed, on this synthetic seed only</span>
              </>
            ) : <strong className="muted">no labels for imported data</strong>}
          </div>
        </section>

        <main className="columns">
          <section className="queue" id="queue" aria-labelledby="queue-h">
            <div className="queue-head">
              <h2 id="queue-h">Anomaly queue</h2>
              <label className="switch-label">
                <Switch.Root className="switch" checked={showNormal} onCheckedChange={setShowNormal} aria-label="Show normal days too"><Switch.Thumb className="switch-thumb" /></Switch.Root>
                show normal days
              </label>
            </div>
            {queue.length === 0 && <p className="empty">Nothing crosses the threshold. Lower the alert threshold or regenerate.</p>}
            <ol className="cards">
              {queue.slice(0, 80).map(s => {
                const k = key(s); const d = dispositions[k];
                return (
                  <li key={k}>
                    <button type="button" className={`card ${s.state} ${k === selected ? 'is-selected' : ''}`} aria-pressed={k === selected} onClick={() => { setSelected(k); setFeedbackFor(null); }}>
                      <span className="card-top"><span className="mono">{s.day}</span><span className="score">{s.score.toFixed(1)}</span></span>
                      <span className="card-user">{s.user} <span className="muted">· {s.dept}</span></span>
                      <span className="codes">{s.reasons.map(r => <span key={r.code + r.feature} className={`code code-${r.code}`}>{r.code.replace('_', ' ').toLowerCase()}</span>)}{s.reasons.length === 0 && <span className="code code-none">within band</span>}</span>
                      {d && <span className="dispo">{d.disposition.replace('_', ' ')}</span>}
                      <span className="visually-hidden">Open</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="detail" aria-labelledby="detail-h">
            {!current ? (
              <>
                <h2 id="detail-h">Pick an anomaly</h2>
                <p className="empty">The detail view draws the user's 28-day series for all four features with the baseline band, lists each reason as a full sentence, and lets you suppress a reason with a rationale or record a disposition.</p>
                <h3>Reason codes</h3>
                <dl className="glossary">{(Object.keys(GLOSSARY) as ReasonCode[]).map(c => <div key={c}><dt className={`code code-${c}`}>{c.replace('_', ' ').toLowerCase()}</dt><dd>{GLOSSARY[c]}</dd></div>)}</dl>
              </>
            ) : (
              <>
                <h2 id="detail-h">{current.user} <span className="muted">· {current.dept} · {current.day} ({current.dayType})</span></h2>
                <p className="verdict">Score <strong>{current.score.toFixed(1)}</strong> against threshold {config.alertThreshold} → <strong className={`state-${current.state}`}>{current.state}</strong>{current.baselineNote && <span className="note"> · {current.baselineNote}</span>}</p>
                <div className="bands">
                  {FEATURES.map(f => <BandChart key={f} records={userRecords} feature={f} stats={userBase ? userBase[current.dayType][f].n >= config.minBaselineDays ? userBase[current.dayType][f] : userBase[current.dayType === 'weekday' ? 'weekend' : 'weekday'][f] : null} madFloor={config.madFloor[f]} zThreshold={config.zThreshold} splitDay={SPLIT} highlightDay={current.day} />)}
                </div>
                <h3>Why</h3>
                {current.reasons.length === 0 && <p className="muted">Every feature sits inside the user's band{current.suppressed.length ? ' once suppressed reasons are removed' : ''}.</p>}
                <ol className="reasons">
                  {current.reasons.map(r => (
                    <li key={r.code + r.feature} className="reason">
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild><span className={`code code-${r.code}`} tabIndex={0}>{r.code.replace('_', ' ').toLowerCase()}</span></Tooltip.Trigger>
                        <Tooltip.Portal><Tooltip.Content className="tip" sideOffset={6}>{GLOSSARY[r.code]}<Tooltip.Arrow className="tip-arrow" /></Tooltip.Content></Tooltip.Portal>
                      </Tooltip.Root>
                      <p>{r.text}</p>
                      <p className="mono muted">weight {r.weight} × min(3, z/threshold {Math.min(3, r.z / (r.code === 'PEER_DEVIATION' ? config.peerZThreshold : config.zThreshold)).toFixed(2)}) = {(r.weight * Math.min(3, r.z / (r.code === 'PEER_DEVIATION' ? config.peerZThreshold : config.zThreshold))).toFixed(2)}</p>
                      {r.code !== 'NO_BASELINE' && <button type="button" className="link" onClick={() => setFeedbackFor(r.code)}>Suppress this reason for the user</button>}
                    </li>
                  ))}
                </ol>
                {current.suppressed.length > 0 && (
                  <div className="suppressed">
                    <h3>Suppressed for this user</h3>
                    <ul>{userSuppressions.map(s => <li key={s.code}><span className={`code code-${s.code}`}>{s.code.replace('_', ' ').toLowerCase()}</span> — {s.rationale} <button type="button" className="link" onClick={() => setConfig(c => removeFeedback(c, s.user, s.code))}>undo</button></li>)}</ul>
                  </div>
                )}
                {feedbackFor && (
                  <form className="feedback" onSubmit={e => { e.preventDefault(); applySuppression(); }}>
                    <label>Rationale <input type="text" maxLength={300} value={rationale} onChange={e => setRationale(e.target.value)} placeholder={`Why is ${feedbackFor.replace('_', ' ').toLowerCase()} expected for ${current.user}?`} /></label>
                    <div className="row"><button type="submit" className="btn">Apply suppression</button><button type="button" className="btn btn-quiet" onClick={() => setFeedbackFor(null)}>Cancel</button></div>
                  </form>
                )}
                <h3>Disposition</h3>
                <form className="dispo-form" onSubmit={e => { e.preventDefault(); recordDisposition(); }}>
                  <label>Disposition
                    <select value={dispo} onChange={e => setDispo(e.target.value as Disposition)}>
                      <option value="true_positive">True positive — escalate</option>
                      <option value="false_positive">False positive — threshold or data issue</option>
                      <option value="benign_explained">Benign — explained by business context</option>
                    </select>
                  </label>
                  <label>Note <input type="text" maxLength={300} value={dispoNote} onChange={e => setDispoNote(e.target.value)} placeholder="Optional context for the report" /></label>
                  <button type="submit" className="btn">Record disposition</button>
                  {dispositions[key(current)] && <p className="muted">Recorded: {dispositions[key(current)].disposition.replace('_', ' ')}{dispositions[key(current)].note ? ` — ${dispositions[key(current)].note}` : ''}</p>}
                </form>
              </>
            )}
          </section>

          <aside className="population" aria-labelledby="pop-h">
            <h2 id="pop-h">Population table</h2>
            <p className="muted">Accessible equivalent of the charts: weekday medians per user from the training window.</p>
            <div className="table-wrap" tabIndex={0} aria-label="Population table, scrollable">
              <table>
                <thead><tr><th scope="col">User</th><th scope="col">Dept</th><th scope="col">Logins</th><th scope="col">MB</th><th scope="col">Hosts</th><th scope="col">After-hrs</th><th scope="col">Alerts</th></tr></thead>
                <tbody>
                  {[...baselines.user.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([u, b]) => (
                    <tr key={u} className={current?.user === u ? 'is-current' : ''}>
                      <th scope="row">{u}</th><td>{baselines.deptOfUser.get(u)}</td>
                      <td className="num">{b.weekday.logins.median}</td><td className="num">{b.weekday.uploadMB.median.toFixed(0)}</td><td className="num">{b.weekday.distinctHosts.median}</td><td className="num">{Math.round(b.weekday.afterHoursPct.median * 100)}%</td>
                      <td className="num">{alerts.filter(a => a.user === u).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dataset.injected.length > 0 && (
              <>
                <h3>Injected labels (answer key)</h3>
                <ul className="labels">{dataset.injected.map(i => <li key={i.user + i.day}><span className="mono">{i.day}</span> {i.user}: {i.description}</li>)}</ul>
              </>
            )}
          </aside>
        </main>

        {importOpen && (
          <div className="modal-backdrop" role="presentation" onClick={() => setImportOpen(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-h" onClick={e => e.stopPropagation()}>
              <h2 id="import-h">Import activity records</h2>
              <p className="muted">JSON array of <code>{'{user, dept, day, logins, uploadMB, distinctHosts, afterHoursPct}'}</code>. Up to {LIMITS.maxRecords.toLocaleString()} records and {LIMITS.maxBytes.toLocaleString()} bytes; one row per (user, day); <code>day</code> must be a real calendar date; names printable, ≤ {LIMITS.maxName} characters. Errors are reported by path (at most {LIMITS.maxErrors}). Use synthetic or aggregated data only — this tool is not for monitoring real people.</p>
              <label htmlFor="import-area" className="visually-hidden">Records JSON</label>
              <textarea id="import-area" rows={10} value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false} />
              {importErrors.length > 0 && <ul role="alert" className="errors">{importErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <div className="row end"><button type="button" className="btn btn-quiet" onClick={() => setImportOpen(false)}>Cancel</button><button type="button" className="btn" onClick={doImport}>Validate and load</button></div>
            </div>
          </div>
        )}
        <footer className="foot">Educational prototype: deterministic robust statistics over synthetic activity. Not a UEBA product, not employee monitoring, not a security certification. In-memory state resets on refresh; export JSON to keep it.</footer>
      </div>
    </Tooltip.Provider>
  );
}
