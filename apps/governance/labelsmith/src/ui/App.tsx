import { useMemo, useState } from 'react';
import demoJson from '../fixtures/demo.json';
import {
  ALL_CLASSES, BUILT_IN_RULES, addKeywordRule, classifyField, effectiveLabels, exportCatalog, policyFor, validateException, validateFixture,
} from '../engine/classify';
import type { DataClass, Exception, Field, Fixture, NameMatchMode, Rule } from '../engine/types';
import { parseBoundedJson } from '../engine/safe';
import { downloadText } from './download';

const CLASS_LABEL: Record<DataClass, string> = {
  public: 'Public', internal: 'Internal', confidential: 'Confidential', 'restricted-pii': 'Restricted · PII',
  'restricted-financial': 'Restricted · Financial', 'restricted-health': 'Restricted · Health', 'secret-credential': 'Secret · Credential', unknown: 'Unknown',
};

export function App() {
  const initial = useMemo(() => { const v = validateFixture(demoJson); if (!v.ok) throw new Error(v.errors.join('; ')); return v.fixture; }, []);
  const [fixture, setFixture] = useState<Fixture>(initial);
  const [rules, setRules] = useState<Rule[]>(BUILT_IN_RULES);
  const [selectedId, setSelectedId] = useState<string>(initial.fields[2]!.id);
  const [draft, setDraft] = useState<Field | null>(null);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [kw, setKw] = useState({ id: '', tokens: '', class: 'confidential' as DataClass, weight: '0.7', match: 'token' as NameMatchMode });
  const [exc, setExc] = useState({ toClass: 'confidential' as DataClass, justification: '', approvedBy: '', expiresOn: '' });

  const labels = useMemo(() => effectiveLabels(fixture, rules), [fixture, rules]);
  const stored = fixture.fields.find((f) => f.id === selectedId) ?? fixture.fields[0]!;
  const field = draft && draft.id === stored.id ? draft : stored;
  const live = useMemo(() => classifyField(field, rules, fixture.asOf), [field, rules, fixture.asOf]);
  const label = labels.find((l) => l.fieldId === stored.id)!;
  const isDirty = draft !== null && draft.id === stored.id && JSON.stringify(draft) !== JSON.stringify(stored);
  const effective = isDirty ? live.computedClass : label.effectiveClass;
  const policy = policyFor(effective);

  const counts = useMemo(() => { const c = Object.fromEntries(ALL_CLASSES.map((k) => [k, 0])) as Record<DataClass, number>; for (const l of labels) c[l.effectiveClass]++; return c; }, [labels]);
  const needsReview = labels.filter((l) => l.classification.needsReview).length;
  const systems = useMemo(() => {
    const map = new Map<string, Map<string, Field[]>>();
    for (const f of fixture.fields) {
      if (filter && !`${f.name} ${f.table} ${f.system}`.toLowerCase().includes(filter.toLowerCase())) continue;
      const t = map.get(f.system) ?? new Map<string, Field[]>(); const list = t.get(f.table) ?? []; list.push(f); t.set(f.table, list); map.set(f.system, t);
    }
    return map;
  }, [fixture, filter]);

  const edit = (patch: Partial<Field>) => setDraft({ ...field, ...patch });
  const commit = () => { if (!draft) return; setFixture({ ...fixture, fields: fixture.fields.map((f) => f.id === draft.id ? draft : f) }); setDraft(null); setNotice({ tone: 'ok', text: `Saved changes to ${draft.name}; catalog re-labelled.` }); };
  const addRule = () => {
    const r = addKeywordRule(rules, { id: kw.id.trim() || `kw-${rules.length + 1}`, name: kw.id.trim() || 'Keyword rule', tokens: kw.tokens.split(',').map((t) => t.trim()), class: kw.class, weight: Number(kw.weight), match: kw.match });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setRules(r.rules); setKw({ id: '', tokens: '', class: 'confidential', weight: '0.7', match: 'token' }); setNotice({ tone: 'ok', text: `Rule added (${kw.match === 'substring' ? 'substring' : 'whole-token'} match). ${r.rules.length} rules now evaluate every field.` });
  };
  const addException = () => {
    const x: Exception = { id: `exc-${String((fixture.exceptions?.length ?? 0) + 1).padStart(3, '0')}`, fieldId: stored.id, fromClass: label.computedClass, toClass: exc.toClass, justification: exc.justification, approvedBy: exc.approvedBy, grantedOn: fixture.asOf, expiresOn: exc.expiresOn };
    const v = validateException(x, label.computedClass, fixture.asOf);
    if (!v.ok) { setNotice({ tone: 'error', text: v.errors.join(' ') }); return; }
    setFixture({ ...fixture, exceptions: [...(fixture.exceptions ?? []).filter((e) => e.fieldId !== stored.id), x] });
    setExc({ toClass: 'confidential', justification: '', approvedBy: '', expiresOn: '' });
    setNotice({ tone: 'ok', text: `Exception ${x.id} recorded: ${x.fromClass} → ${x.toClass} until ${x.expiresOn}.` });
  };
  const onImport = async (file?: File) => {
    if (!file) return;
    const p = parseBoundedJson(await file.text());
    if (!p.ok) { setNotice({ tone: 'error', text: p.error }); return; }
    const v = validateFixture(p.value);
    if (!v.ok) { setNotice({ tone: 'error', text: 'Fixture rejected: ' + v.errors.slice(0, 5).join(' · ') }); return; }
    setFixture(v.fixture); setDraft(null); setSelectedId(v.fixture.fields[0]?.id ?? ''); setNotice({ tone: 'ok', text: `Loaded “${v.fixture.label}” with ${v.fixture.fields.length} fields.` });
  };
  const doExport = (kind: 'json' | 'csv') => {
    const out = exportCatalog(fixture, labels, rules);
    if (kind === 'json') downloadText('labelsmith-catalog.json', JSON.stringify(out.json, null, 2), 'application/json'); else downloadText('labelsmith-catalog.csv', out.csv, 'text/csv');
    setNotice({ tone: 'ok', text: `Exported ${kind.toUpperCase()}: ${out.json.summary.total} fields, ${out.json.summary.needsReview} need review.` });
  };

  const total = labels.length || 1;
  return (
    <>
      <header className="top">
        <div className="top-row">
          <h1>Label<em>smith</em></h1>
          <p className="sub">Data-classification and handling-policy engine. Rules propose a class, show every rule they considered, and hand you the handling policy. Synthetic catalog · educational prototype · not a legal classification.</p>
          <div className="actions">
            <label className="btn ghost">Load fixture<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onImport(e.target.files?.[0])} /></label>
            <button className="btn ghost" onClick={() => doExport('csv')}>Export CSV</button>
            <button className="btn" onClick={() => doExport('json')}>Export catalog JSON</button>
          </div>
        </div>
        <div className="ladder" role="img" aria-label={`Effective classes: ${ALL_CLASSES.map((c) => `${CLASS_LABEL[c]} ${counts[c]}`).join(', ')}`}>
          {ALL_CLASSES.filter((c) => counts[c] > 0).map((c) => <span key={c} className={`cls-${c}`} style={{ width: `${(counts[c] / total) * 100}%` }}>{counts[c]}</span>)}
        </div>
        <div className="ladder-legend">
          {ALL_CLASSES.map((c) => <span key={c}><i className={`cls-${c}`} />{CLASS_LABEL[c]} {counts[c]}</span>)}
          <span><strong>{needsReview}</strong> of {labels.length} need human review · {rules.length} rules · as of <span className="mono">{fixture.asOf}</span></span>
        </div>
        {notice && <p className={`notice ${notice.tone}`} role="status">{notice.text}</p>}
      </header>

      <div className="bench">
        <nav className="catalog" aria-label="Catalog">
          <h2>Catalog · {fixture.label}</h2>
          <input className="filter mono" placeholder="Filter fields" aria-label="Filter fields" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {systems.size === 0 && <p className="notice">No fields match “{filter}”.</p>}
          {[...systems.entries()].map(([system, tables]) => (
            <details key={system} open>
              <summary>{system}</summary>
              {[...tables.entries()].map(([table, fields]) => (
                <div key={table}>
                  <div className="table-name">{table}</div>
                  <ul>
                    {fields.map((f) => { const l = labels.find((x) => x.fieldId === f.id)!; return (
                      <li key={f.id}><button aria-current={f.id === stored.id} onClick={() => { setSelectedId(f.id); setDraft(null); }}>
                        <i className={`cls-${l.effectiveClass}`} aria-hidden="true" /><span>{f.name}</span>{l.classification.needsReview && <span className="flag" aria-label="needs review">review</span>}
                      </button></li>); })}
                  </ul>
                </div>
              ))}
            </details>
          ))}
        </nav>

        <main className="specimen" aria-labelledby="spec-h">
          <h2 id="spec-h">Specimen under test</h2>
          <section className="card">
            <div className="form-grid">
              <label className="field">Field name<input value={field.name} onChange={(e) => edit({ name: e.target.value.slice(0, 120) })} /></label>
              <label className="field">Type<select value={field.type} onChange={(e) => edit({ type: e.target.value as Field['type'] })}>{['string', 'number', 'date', 'boolean'].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="field">Declared class (optional)<select value={field.declaredClass ?? ''} onChange={(e) => edit({ declaredClass: (e.target.value || undefined) as DataClass | undefined })}><option value="">none</option>{ALL_CLASSES.filter((c) => c !== 'unknown').map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select></label>
              <label className="field">Location<input value={`${field.system} · ${field.table}`} readOnly aria-readonly="true" /></label>
              <label className="field wide">Synthetic sample values (one per line, max 50)<textarea value={field.samples.join('\n')} onChange={(e) => edit({ samples: e.target.value.split('\n').slice(0, 50).map((s) => s.slice(0, 200)) })} /></label>
            </div>
            {field.description && <p className="sub" style={{ margin: '10px 0 0', fontSize: 13 }}>{field.description}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn violet" onClick={commit} disabled={!isDirty}>Save to catalog</button>
              <button className="btn ghost" onClick={() => setDraft(null)} disabled={!isDirty}>Discard edits</button>
              {isDirty && <span className="pill">unsaved — label below is the live preview</span>}
            </div>
          </section>

          <h2>Proposed label</h2>
          <section className="label-tag" aria-live="polite">
            <div className={`swatch cls-${live.computedClass}`} aria-hidden="true" />
            <div className="body">
              <div className="name">{CLASS_LABEL[live.computedClass]}</div>
              <div className="effective">
                {!isDirty && label.exception === null && label.effectiveClass !== label.computedClass && <>Effective class <strong>{CLASS_LABEL[label.effectiveClass]}</strong> — the stricter declared class is kept pending review. </>}
                {!isDirty && label.exception?.status === 'active' && <>Effective class <strong>{CLASS_LABEL[label.effectiveClass]}</strong> via exception <span className="mono">{label.exception.id}</span> until <span className="mono">{label.exception.expiresOn}</span>. </>}
                {!isDirty && label.exception?.status === 'expired' && <span className="pill warn">exception {label.exception.id} expired {label.exception.expiresOn} — computed class applies</span>}
                {isDirty && 'Live preview from the edited specimen.'}
              </div>
              <div><span className="mono">confidence {live.confidence.toFixed(2)}</span><div className="meter" aria-hidden="true"><span style={{ width: `${live.confidence * 100}%` }} /></div></div>
              {live.needsReview ? <ul className="reasons">{live.reviewReasons.map((r) => <li key={r}>{r}</li>)}</ul> : <span className="pill ok">no review flags</span>}
            </div>
          </section>

          <details className="more card">
            <summary>Record a downgrade exception for this field</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="field">Downgrade to<select value={exc.toClass} onChange={(e) => setExc({ ...exc, toClass: e.target.value as DataClass })}>{ALL_CLASSES.filter((c) => c !== 'unknown').map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select></label>
              <label className="field">Approved by<input value={exc.approvedBy} onChange={(e) => setExc({ ...exc, approvedBy: e.target.value })} placeholder="role@example.test" /></label>
              <label className="field">Expires on (≤ 365 days)<input type="date" value={exc.expiresOn} onChange={(e) => setExc({ ...exc, expiresOn: e.target.value })} /></label>
              <label className="field wide">Justification (≥ 20 chars)<textarea style={{ minHeight: 60 }} value={exc.justification} onChange={(e) => setExc({ ...exc, justification: e.target.value })} /></label>
            </div>
            <button className="btn" style={{ marginTop: 10 }} onClick={addException}>Record exception</button>
          </details>

          <details className="more card">
            <summary>Add a keyword rule (plain text, no regex)</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="field">Rule id<input value={kw.id} onChange={(e) => setKw({ ...kw, id: e.target.value })} placeholder="kw-codename" /></label>
              <label className="field">Keywords, comma separated<input value={kw.tokens} onChange={(e) => setKw({ ...kw, tokens: e.target.value })} placeholder="codename, project_alias" /></label>
              <label className="field">Class<select value={kw.class} onChange={(e) => setKw({ ...kw, class: e.target.value as DataClass })}>{ALL_CLASSES.filter((c) => c !== 'unknown').map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select></label>
              <label className="field">Weight (0–1)<input value={kw.weight} onChange={(e) => setKw({ ...kw, weight: e.target.value })} inputMode="decimal" /></label>
              <label className="field">Match mode<select value={kw.match} onChange={(e) => setKw({ ...kw, match: e.target.value as NameMatchMode })}><option value="token">Whole token or token sequence (default)</option><option value="substring">Substring (legacy, broader)</option></select></label>
            </div>
            <p className="sub" style={{ margin: '8px 0 0', fontSize: 12 }}>Whole-token: <span className="mono">codename</span> matches <span className="mono">project_codename</span> and <span className="mono">projectCodename</span> but not <span className="mono">projectcodename</span>; substring also matches the glued form. Allow-listed metadata tokens (version, status, count…) discount sensitive keyword hits in whole-token mode.</p>
            <button className="btn" style={{ marginTop: 10 }} onClick={addRule}>Add rule</button>
          </details>
        </main>

        <aside className="aside" aria-labelledby="why-h">
          <section>
            <h2 id="why-h">Why this label · {rules.length} rules in precedence order</h2>
            <ol className="waterfall">
              {live.trace.map((t) => (
                <li key={t.ruleId} className={t.outcome}>
                  <i className={`cls-${t.class}`} aria-hidden="true" />
                  <div><div className="rname">{t.name} <span className="mono" style={{ color: 'var(--slate)' }}>→ {CLASS_LABEL[t.class]}</span></div><div className="rreason">{t.outcome === 'matched' ? 'Matched: ' : t.outcome === 'skipped' ? 'Skipped: ' : t.outcome === 'suppressed' ? 'Suppressed: ' : ''}{t.reason}</div></div>
                  <div><span className="mono">{t.outcome === 'matched' ? `w ${t.weight}` : t.outcome}</span><div className="w" aria-hidden="true"><span style={{ width: `${t.outcome === 'matched' ? t.weight * 100 : 0}%` }} /></div></div>
                </li>
              ))}
            </ol>
          </section>
          <section className="policy card">
            <h2>Handling policy · {CLASS_LABEL[effective]}</h2>
            <p className="summary">{policy.summary}</p>
            <dl>
              <dt>Encryption at rest</dt><dd>{policy.encryptionAtRest}</dd>
              <dt>Mask in logs</dt><dd>{policy.maskInLogs ? 'yes' : 'no'}</dd>
              <dt>Mask in UI</dt><dd>{policy.maskInUi ? 'yes' : 'no'}</dd>
              <dt>External sharing</dt><dd>{policy.externalSharing}</dd>
              <dt>Max retention</dt><dd>{policy.retentionMaxMonths === null ? 'per schedule' : `${policy.retentionMaxMonths} months`}</dd>
              <dt>Access review</dt><dd>{policy.accessReviewDays === null ? 'n/a' : `every ${policy.accessReviewDays} days`}</dd>
              <dt>Approved stores</dt><dd>{policy.approvedStores.join(', ') || 'none until classified'}</dd>
            </dl>
          </section>
        </aside>
      </div>
      <p className="foot">Labelsmith proposes labels from field names and synthetic sample shapes using transparent rules; it is not automated legal classification and does not touch real data. State is in memory only and resets on refresh — export the catalog to keep it.</p>
    </>
  );
}
