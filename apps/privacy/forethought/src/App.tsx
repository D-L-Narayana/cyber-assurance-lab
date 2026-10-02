import { useEffect, useMemo, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Dialog from '@radix-ui/react-dialog';
import demoJson from './fixtures/recommendation-feature.json';
import lowJson from './fixtures/calibration-low.json';
import vhJson from './fixtures/calibration-very-high.json';
import type { AppliedMitigation, ApproverRole, Assessment, DataFlow, Theme } from './engine/types';
import { THEME_LABEL } from './engine/types';
import { MITIGATIONS, QUESTIONS } from './engine/rubric';
import { score, visibleQuestions } from './engine/scoring';
import { applyAnswer, contentHash, signOff, SignOffError, signOffBlockers, snapshot } from './engine/approval';
import { executiveSummary } from './engine/narrative';
import { DEFAULT_LIMITS, parseAssessment, serializeAssessment } from './engine/assessmentIO';
import { Constellation, THEME_SHORT } from './ui/Constellation';

type Audience = 'analyst' | 'manager' | 'executive';

const FIXTURES: Record<string, { label: string; json: unknown }> = {
  demo: { label: 'Recommendation feature (demo)', json: demoJson },
  low: { label: 'Calibration: internal roster tool (low)', json: lowJson },
  vh: { label: 'Calibration: kids learning app (very high)', json: vhJson },
};

function load(json: unknown): Assessment {
  const r = parseAssessment(JSON.stringify(json));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.assessment;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function App() {
  const [a, setA] = useState<Assessment>(() => load(demoJson));
  const [audience, setAudience] = useState<Audience>('analyst');
  const [status, setStatus] = useState('Demo assessment loaded (synthetic). In-memory only; refresh resets.');
  const [hash, setHash] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState<ApproverRole>('product-owner');
  const [signError, setSignError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const card = useMemo(() => score(a), [a]);
  const blockers = useMemo(() => signOffBlockers(a), [a]);
  const visible = useMemo(() => visibleQuestions(a), [a]);
  const summary = useMemo(() => executiveSummary(a, card), [a, card]);

  useEffect(() => { let alive = true; contentHash(a).then((h) => { if (alive) setHash(h); }); return () => { alive = false; }; }, [a]);

  function setMitigation(id: string, patch: Partial<AppliedMitigation> | null) {
    const existing = a.mitigations.find((m) => m.mitigationId === id);
    let next: AppliedMitigation[];
    if (patch === null) next = a.mitigations.filter((m) => m.mitigationId !== id);
    else if (existing) next = a.mitigations.map((m) => (m.mitigationId === id ? { ...m, ...patch } : m));
    else next = [...a.mitigations, { mitigationId: id, status: 'planned', ...patch }];
    setA({ ...a, mitigations: next });
  }

  async function doSign() {
    setSignError(null);
    try {
      const signed = await signOff(a, { role: signerRole, name: signerName.trim() || 'Unnamed signer', signedAt: nowIso() });
      setA(signed);
      setStatus(`Signed by ${signerRole} (${signerName.trim() || 'Unnamed signer'}); signature bound to content hash ${signed.signatures.at(-1)?.contentHash.slice(0, 12)}….`);
    } catch (e) {
      if (e instanceof SignOffError) setSignError(e.message); else throw e;
    }
  }

  async function doSnapshot() {
    const next = await snapshot(a, nowIso());
    setA(next);
    setStatus(`Version ${next.versions.at(-1)?.number} recorded.`);
  }

  function pick(key: string) {
    setA(load(FIXTURES[key]!.json));
    setSignError(null);
    setStatus(`${FIXTURES[key]!.label} loaded.`);
  }

  return (
    <>
      <header className="masthead">
        <h1>Forethought <small>privacy impact assessment workbench</small></h1>
        <div className="tools" role="toolbar" aria-label="Assessment controls">
          <label className="ui" style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>Load fixture
            <select aria-label="Load fixture" onChange={(e) => { if (e.target.value) pick(e.target.value); e.target.value = ''; }} defaultValue="">
              <option value="" disabled>Choose…</option>
              {Object.entries(FIXTURES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
          </label>
          <Dialog.Root open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportErrors([]); }}>
            <Dialog.Trigger asChild><button type="button" className="btn">Import JSON</button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog" aria-describedby="imp-desc">
                <Dialog.Title asChild><h2>Import an assessment</h2></Dialog.Title>
                <Dialog.Description id="imp-desc" className="desc">Schema <code>forethought.assessment</code> v1; limit {DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')} bytes, depth {DEFAULT_LIMITS.maxDepth}. Unknown question, option or mitigation ids are rejected. Read in this tab only; replaces the current session.</Dialog.Description>
                <div className="form">
                  <label>Choose a .json file<input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > DEFAULT_LIMITS.maxBytes) { setImportErrors([`File is ${f.size.toLocaleString('en-US')} bytes; the limit is ${DEFAULT_LIMITS.maxBytes.toLocaleString('en-US')}.`]); return; } const r = parseAssessment(await f.text()); if (r.ok) { setA(r.assessment); setImportErrors([]); setImportOpen(false); setStatus(`Imported ${r.assessment.id}.`); } else setImportErrors(r.errors); e.target.value = ''; }} /></label>
                  <label>Or paste assessment JSON<textarea rows={7} value={importText} onChange={(e) => setImportText(e.target.value)} spellCheck={false} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} /></label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-primary" disabled={!importText.trim()} onClick={() => { const r = parseAssessment(importText); if (r.ok) { setA(r.assessment); setImportErrors([]); setImportText(''); setImportOpen(false); setStatus(`Imported ${r.assessment.id}.`); } else setImportErrors(r.errors); }}>Validate and import</button>
                    <Dialog.Close asChild><button type="button" className="btn">Cancel</button></Dialog.Close>
                  </div>
                </div>
                {importErrors.length > 0 && <div className="blocker" role="alert" style={{ marginTop: 10 }}><strong>Import rejected.</strong> {importErrors.slice(0, 6).join(' · ')}</div>}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <button type="button" className="btn" onClick={() => download(`${a.id}.json`, serializeAssessment(a))}>Export JSON</button>
          <button type="button" className="btn" onClick={() => window.print()}>Print / PDF</button>
          <button type="button" className="btn" onClick={() => pick('demo')}>Reset demo</button>
        </div>
      </header>
      <p className="disclaimer">Educational prototype. A weighted questionnaire model on synthetic scenarios; it structures a privacy impact assessment and is not legal advice or a DPIA template endorsed by any authority.</p>

      <div className="workbench">
        <main className="worksheet">
          <header className="sheet-head">
            <span className="eyebrow">Assessment {a.id} · as of {a.asOf}</span>
            <h2><label className="sr-only" htmlFor="title">Title</label><input id="title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} /></h2>
            <label className="sr-only" htmlFor="desc">Description</label>
            <textarea id="desc" value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} />
            <div className="meta-row"><span>Owner: <input aria-label="Owner" value={a.owner} onChange={(e) => setA({ ...a, owner: e.target.value })} style={{ width: 'auto' }} /></span><span>Content hash <span className="mono">{hash.slice(0, 16) || '…'}</span></span><span>{visible.length} questions apply</span></div>
          </header>

          <section className="part" aria-labelledby="p-flows">
            <h3 id="p-flows">Data flow sketch</h3>
            <p className="lede">Where the data goes. A flow that leaves the origin region with no mechanism blocks sign-off.</p>
            <div className="flows-wrap" tabIndex={0} role="region" aria-label="Data flows table">
            <table className="flows">
              <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Data</th><th scope="col">Outside origin region</th><th scope="col">Mechanism</th><th scope="col"></th></tr></thead>
              <tbody>
                {a.flows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.from}</td><td>{f.to}</td><td>{f.dataCategories.join(', ')}</td>
                    <td><label className="check"><input type="checkbox" checked={f.outsideOriginRegion} onChange={(e) => setA({ ...a, flows: a.flows.map((x) => (x.id === f.id ? { ...x, outsideOriginRegion: e.target.checked } : x)) })} aria-label={`Flow ${f.id} leaves origin region`} /> {f.outsideOriginRegion ? 'yes' : 'no'}</label></td>
                    <td><select aria-label={`Mechanism for flow ${f.id}`} value={f.mechanism} onChange={(e) => setA({ ...a, flows: a.flows.map((x) => (x.id === f.id ? { ...x, mechanism: e.target.value as DataFlow['mechanism'] } : x)) })}>{['not-applicable', 'adequacy', 'standard-contractual-clauses', 'binding-corporate-rules', 'none'].map((m) => <option key={m} value={m}>{m}</option>)}</select></td>
                    <td><button type="button" className="btn btn-sm" onClick={() => setA({ ...a, flows: a.flows.filter((x) => x.id !== f.id) })} aria-label={`Remove flow ${f.id}`}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <FlowForm onAdd={(f) => setA({ ...a, flows: [...a.flows, { ...f, id: `f-${a.flows.length + 1}-${Date.now().toString(36)}` }] })} />
          </section>

          <section className="part" aria-labelledby="p-q">
            <h3 id="p-q">Questionnaire</h3>
            <p className="lede">Ten questions; follow-ups appear when an answer makes them relevant. Each option shows which risk themes it moves and by how much (L = likelihood, I = impact).</p>
            {QUESTIONS.map((q) => {
              const shown = visible.some((v) => v.id === q.id);
              if (!shown) return null;
              const answered = q.options.some((o) => o.id === a.answers[q.id]);
              return (
                <div className={`question${q.showIf ? ' followup' : ''}`} key={q.id}>
                  <fieldset>
                    <legend>{q.prompt} {!answered && <span className="unanswered">· unanswered</span>}</legend>
                    {q.help && <p className="help">{q.help}</p>}
                    <div className="options">
                      {q.options.map((o) => (
                        <label className="option" key={o.id}>
                          <input type="radio" name={q.id} value={o.id} checked={a.answers[q.id] === o.id} onChange={() => setA(applyAnswer(a, q.id, o.id))} />
                          <span>{o.label}</span>
                          <span className="effects">{o.effects.length === 0 ? 'neutral' : o.effects.map((e) => `${THEME_SHORT[e.theme]} ${e.likelihood ? `L${e.likelihood > 0 ? '+' : ''}${e.likelihood}` : ''}${e.likelihood && e.impact ? ' ' : ''}${e.impact ? `I${e.impact > 0 ? '+' : ''}${e.impact}` : ''}`).join(' · ')}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              );
            })}
          </section>

          <section className="part" aria-labelledby="p-m">
            <h3 id="p-m">Mitigations</h3>
            <p className="lede">Planned mitigations only change the projection. Implemented ones reduce residual risk; those marked "evidence required" count only when verified with a reference.</p>
            <div className="mit-list">
              {MITIGATIONS.map((m) => {
                const applied = a.mitigations.find((x) => x.mitigationId === m.id);
                const counts = applied && (m.requiresEvidence ? applied.status === 'verified' && Boolean(applied.evidenceRef?.trim()) : applied.status !== 'planned');
                return (
                  <div className={`mit${counts ? ' active' : applied ? ' planned' : ''}`} key={m.id}>
                    <div>
                      <div className="name">{m.name} <span className="themes">· {m.themes.map((t) => THEME_LABEL[t]).join(', ')} · −{m.by} {m.reduces}{m.requiresEvidence ? ' · evidence required' : ''}</span></div>
                      <div className="desc">{m.description}</div>
                    </div>
                    <div className="controls">
                      <label className="sr-only" htmlFor={`st-${m.id}`}>Status of {m.name}</label>
                      <select id={`st-${m.id}`} value={applied?.status ?? ''} onChange={(e) => setMitigation(m.id, e.target.value ? { status: e.target.value as AppliedMitigation['status'] } : null)}>
                        <option value="">not applied</option><option value="planned">planned</option><option value="implemented">implemented</option><option value="verified">verified</option>
                      </select>
                      {applied && m.requiresEvidence && <input aria-label={`Evidence reference for ${m.name}`} placeholder="evidence ref" value={applied.evidenceRef ?? ''} onChange={(e) => setMitigation(m.id, { evidenceRef: e.target.value })} />}
                    </div>
                    {applied && m.requiresEvidence && applied.status === 'verified' && !applied.evidenceRef?.trim() && <div className="evidence-warn">Marked verified without an evidence reference: does not count and blocks sign-off.</div>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="part" aria-labelledby="p-acc">
            <h3 id="p-acc">Risk acceptances and DPO consultation</h3>
            <p className="lede">A theme that stays high after mitigation needs a named acceptance with a rationale of at least 30 characters. Very-high themes can only be accepted by the data-protection lead.</p>
            <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={a.dpoConsulted} onChange={(e) => setA({ ...a, dpoConsulted: e.target.checked })} /> Data protection officer consulted</label>
            {a.acceptances.map((x) => (
              <div className="acceptance" key={x.theme}>
                <span className="who">{THEME_LABEL[x.theme]}</span> accepted by {x.acceptedByName} ({x.acceptedBy}) on {x.acceptedOn}<br />
                <span style={{ color: 'var(--mute)' }}>{x.rationale}</span>
                <div style={{ marginTop: 6 }}><button type="button" className="btn btn-sm" onClick={() => setA({ ...a, acceptances: a.acceptances.filter((y) => y.theme !== x.theme) })}>Withdraw acceptance</button></div>
              </div>
            ))}
            <AcceptanceForm themes={card.themes.filter((t) => (t.residual.band === 'high' || t.residual.band === 'very-high') && !t.acceptance).map((t) => t.theme)} asOf={a.asOf} onAdd={(x) => setA({ ...a, acceptances: [...a.acceptances.filter((y) => y.theme !== x.theme), x] })} />
          </section>
        </main>

        <aside className="riskpane" aria-labelledby="rp-h">
          <h2 id="rp-h">Risk constellation</h2>
          <div className="overall">
            <span>Inherent <b className={`bandtag ${card.overall.inherent}`}>{card.overall.inherent}</b></span>
            <span>Residual <b className={`bandtag ${card.overall.residual}`}>{card.overall.residual}</b></span>
            <span>If plans land <b className={`bandtag ${card.overall.projected}`}>{card.overall.projected}</b></span>
            {card.isDpiaScale && <span className="bandtag very-high">DPIA-scale</span>}
          </div>
          <Constellation card={card} />
          <div className="const-legend"><span><i style={{ border: '1.5px solid #cbbdd8' }} /> inherent</span><span><i style={{ background: '#fff' }} /> residual</span><span>arrow = effect of counted mitigations</span></div>

          <ToggleGroup.Root type="single" value={audience} onValueChange={(v) => { if (v) setAudience(v as Audience); }} className="audience" aria-label="Audience view">
            <ToggleGroup.Item value="analyst">Analyst</ToggleGroup.Item>
            <ToggleGroup.Item value="manager">Manager</ToggleGroup.Item>
            <ToggleGroup.Item value="executive">Executive</ToggleGroup.Item>
          </ToggleGroup.Root>

          {audience === 'analyst' && (
            <table className="pane-table">
              <thead><tr><th scope="col">Theme</th><th scope="col">Inherent</th><th scope="col">Residual</th><th scope="col">Drivers</th></tr></thead>
              <tbody>
                {card.themes.map((t) => (
                  <tr key={t.theme}>
                    <td>{THEME_SHORT[t.theme]} <span className="pane-note">{THEME_LABEL[t.theme]}</span></td>
                    <td className="num">{t.inherent.likelihood}×{t.inherent.impact}=<b>{t.inherent.score}</b></td>
                    <td className="num">{t.residual.likelihood}×{t.residual.impact}=<b>{t.residual.score}</b> <span className={`bandtag ${t.residual.band}`}>{t.residual.band}</span></td>
                    <td className="pane-note">{t.contributingAnswers.map((c) => `${c.optionId}`).join(', ') || '—'}{t.activeMitigations.length ? <><br />− {t.activeMitigations.join(', ')}</> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {audience === 'manager' && (
            <table className="pane-table">
              <thead><tr><th scope="col">Theme</th><th scope="col">Band</th><th scope="col">Controls</th><th scope="col">Owner decision</th></tr></thead>
              <tbody>
                {card.themes.filter((t) => t.inherent.band !== 'low' || t.activeMitigations.length).map((t) => (
                  <tr key={t.theme}>
                    <td>{THEME_LABEL[t.theme]}</td>
                    <td><span className={`bandtag ${t.inherent.band}`}>{t.inherent.band}</span>{t.inherent.band !== t.residual.band && <> → <span className={`bandtag ${t.residual.band}`}>{t.residual.band}</span></>}</td>
                    <td className="pane-note">{t.activeMitigations.map((id) => MITIGATIONS.find((m) => m.id === id)?.name).join('; ') || '—'}{t.plannedMitigations.length ? <><br />planned: {t.plannedMitigations.map((id) => MITIGATIONS.find((m) => m.id === id)?.name).join('; ')}</> : null}</td>
                    <td className="pane-note">{t.acceptance ? `Accepted by ${t.acceptance.acceptedByName}` : t.residual.band === 'high' || t.residual.band === 'very-high' ? 'Acceptance needed' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {audience === 'executive' && (
            <div className="exec"><p>{summary}</p></div>
          )}

          <h2 style={{ marginTop: 18 }}>Sign-off</h2>
          {blockers.length === 0 ? <div className="clear">No blockers. The assessment can be signed.</div> : (
            <div className="blockers" role="list" aria-label="Sign-off blockers">
              {blockers.map((b, i) => <div className="blocker" role="listitem" key={i}><code>{b.code}</code> {b.message}</div>)}
            </div>
          )}
          <div className="signrow">
            <label>Signer name<input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="e.g. Tamsin Reyes" /></label>
            <label>Role<select value={signerRole} onChange={(e) => setSignerRole(e.target.value as ApproverRole)}><option value="product-owner">product-owner</option><option value="data-protection-lead">data-protection-lead</option></select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-light" onClick={doSign}>Sign as {signerRole}</button>
            <button type="button" className="btn btn-outline" onClick={doSnapshot}>Record version</button>
          </div>
          {signError && <div className="blocker" role="alert" style={{ marginTop: 8 }}>{signError}</div>}
          {a.signatures.map((s) => {
            const current = s.contentHash === hash;
            return <div key={s.role} className={`sig${current ? '' : ' stale'}`}>{current ? 'Current' : 'Stale — content changed since signing'}: {s.role} {s.name} at {s.signedAt} · <span className="mono">{s.contentHash.slice(0, 12)}</span></div>;
          })}
          {a.versions.length > 0 && (
            <ol className="versions" aria-label="Version history">
              {[...a.versions].reverse().map((v) => <li key={v.number}><strong>v{v.number}</strong> · {v.at} · <span className="vh">{v.contentHash.slice(0, 12)}</span><br />{v.changeSummary.join('; ')}</li>)}
            </ol>
          )}
        </aside>
      </div>
      <footer className="statusline">
        <span role="status" aria-live="polite">{status}</span>
        <span>{a.signatures.length} signature(s) · {a.versions.length} version(s) · no storage APIs, no network</span>
      </footer>
    </>
  );
}

function FlowForm({ onAdd }: { onAdd: (f: Omit<DataFlow, 'id'>) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cats, setCats] = useState('');
  const [outside, setOutside] = useState(false);
  const [mechanism, setMechanism] = useState<DataFlow['mechanism']>('not-applicable');
  const valid = from.trim() && to.trim();
  return (
    <form className="form" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (!valid) return; onAdd({ from: from.trim(), to: to.trim(), dataCategories: cats.split(',').map((c) => c.trim()).filter(Boolean), outsideOriginRegion: outside, mechanism }); setFrom(''); setTo(''); setCats(''); setOutside(false); setMechanism('not-applicable'); }} aria-label="Add a data flow">
      <div className="form-row">
        <label>From<input value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Data categories (comma-separated)<input value={cats} onChange={(e) => setCats(e.target.value)} /></label>
        <label>Mechanism<select value={mechanism} onChange={(e) => setMechanism(e.target.value as DataFlow['mechanism'])}>{['not-applicable', 'adequacy', 'standard-contractual-clauses', 'binding-corporate-rules', 'none'].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      <label className="check" style={{ fontWeight: 400 }}><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> Destination is outside the origin region</label>
      <div><button type="submit" className="btn btn-sm" disabled={!valid}>Add flow</button></div>
    </form>
  );
}

function AcceptanceForm({ themes, asOf, onAdd }: { themes: Theme[]; asOf: string; onAdd: (x: Assessment['acceptances'][number]) => void }) {
  const [theme, setTheme] = useState<Theme | ''>('');
  const [role, setRole] = useState<ApproverRole>('data-protection-lead');
  const [name, setName] = useState('');
  const [rationale, setRationale] = useState('');
  const effectiveTheme = themes.includes(theme as Theme) ? (theme as Theme) : themes[0];
  if (!effectiveTheme) return <p className="lede" style={{ margin: 0 }}>No theme currently needs an acceptance.</p>;
  const valid = name.trim() && rationale.trim().length >= 30;
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (!valid) return; onAdd({ theme: effectiveTheme, acceptedBy: role, acceptedByName: name.trim(), rationale: rationale.trim(), acceptedOn: asOf }); setName(''); setRationale(''); }} aria-label="Record a risk acceptance">
      <div className="form-row">
        <label>Theme needing acceptance<select value={effectiveTheme} onChange={(e) => setTheme(e.target.value as Theme)}>{themes.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}</select></label>
        <label>Accepted by (role)<select value={role} onChange={(e) => setRole(e.target.value as ApproverRole)}><option value="data-protection-lead">data-protection-lead</option><option value="product-owner">product-owner</option></select></label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <label>Rationale (30+ characters)<textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      <div><button type="submit" className="btn btn-sm" disabled={!valid}>Record acceptance</button></div>
    </form>
  );
}
