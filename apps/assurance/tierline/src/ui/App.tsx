import { useEffect, useMemo, useRef, useState } from 'react';
import { assessVendor, buildQueue, queueToCsvRows, toCsv, SCORING_NOTE } from '../engine/assess';
import { MAX_REGISTER_BYTES, validateRegister, validateRegisterObject } from '../engine/validate';
import type { Register, Vendor, VendorAssessment } from '../engine/types';
import demo from '../fixtures/harbourline-register.json';
import { downloadText, readTextFile } from './files';
import { Quadrant } from './Quadrant';
import { VendorDetail } from './VendorDetail';
import { Queue } from './Queue';

export type Notice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] } | null;

function loadDemo(): Register {
  const r = validateRegisterObject(demo);
  if (!r.ok) throw new Error('Bundled register invalid: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.register;
}

function readHash(): string | null {
  const m = /^#\/([A-Za-z0-9_-]{1,64})$/.exec(location.hash);
  return m ? m[1] : null;
}

export default function App() {
  const [register, setRegister] = useState<Register>(loadDemo);
  const [selected, setSelected] = useState<string | null>(() => readHash() ?? 'V-08');
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded 15 synthetic vendors (Harbourline Logistics). Every name, person and document is fictional.' });
  const fileRef = useRef<HTMLInputElement>(null);

  const assessments = useMemo(() => new Map(register.vendors.map((v) => [v.id, assessVendor(v, register.asOf)])), [register]);
  const queue = useMemo(() => buildQueue(register), [register]);
  const sorted = useMemo(
    () => [...register.vendors].sort((a, b) => assessments.get(b.id)!.residual - assessments.get(a.id)!.residual || a.name.localeCompare(b.name)),
    [register.vendors, assessments],
  );

  useEffect(() => {
    const onHash = () => setSelected(readHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  function select(id: string | null) {
    setSelected(id);
    const target = id ? '#/' + id : '#';
    if (location.hash !== target) history.replaceState(null, '', target);
  }

  function updateVendor(id: string, fn: (v: Vendor) => Vendor, label: string) {
    const next = { ...register, vendors: register.vendors.map((v) => (v.id === id ? fn(v) : v)) };
    const check = validateRegisterObject(next);
    if (!check.ok) {
      setNotice({ kind: 'error', text: `${label} rejected.`, details: check.issues.map((i) => `${i.path}: ${i.message}`) });
      return;
    }
    setRegister(check.register);
    setNotice({ kind: 'success', text: label + '.' });
  }

  function addVendor() {
    const n = register.vendors.length + 1;
    const id = `V-${String(n).padStart(2, '0')}-new`;
    const v: Vendor = { id, name: `New vendor ${n} (synthetic)`, service: '', owner: '', answers: {}, evidence: [], exceptions: [] };
    setRegister({ ...register, vendors: [...register.vendors, v] });
    select(id);
    setNotice({ kind: 'info', text: `Added ${id}. All eight questions are unanswered and therefore scored at maximum until you answer them.` });
  }

  function removeVendor(id: string) {
    setRegister({ ...register, vendors: register.vendors.filter((v) => v.id !== id) });
    select(null);
    setNotice({ kind: 'info', text: `Removed ${id}.` });
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_REGISTER_BYTES);
      const r = validateRegister(text);
      if (!r.ok) {
        setNotice({ kind: 'error', text: `Import rejected: ${r.issues.length} issue(s). Nothing changed.`, details: r.issues.map((i) => `${i.path || 'register'} — ${i.message}`) });
        return;
      }
      setRegister(r.register);
      select(r.register.vendors[0]?.id ?? null);
      setNotice({ kind: 'success', text: `Imported ${r.register.vendors.length} vendors as of ${r.register.asOf}.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const vendor = selected ? register.vendors.find((v) => v.id === selected) : undefined;
  const assessment: VendorAssessment | undefined = vendor ? assessments.get(vendor.id) : undefined;
  const stamp = register.asOf.replace(/-/g, '');
  const tierCounts = [1, 2, 3].map((t) => register.vendors.filter((v) => assessments.get(v.id)!.tier === t).length);

  return (
    <div className="app">
      <a className="skip" href="#detail">Skip to vendor detail</a>
      <header className="top">
        <div className="brand">
          <h1>Tierline</h1>
          <p className="brand__sub">Third-party risk segmentation and review queue. Educational prototype on synthetic vendors; a custom heuristic, not a regulatory classification.</p>
        </div>
        <div className="controls">
          <label>
            <span>Assess as of</span>
            <input type="date" value={register.asOf} onChange={(e) => e.target.value && setRegister({ ...register, asOf: e.target.value })} />
          </label>
          <div className="btns" role="group" aria-label="Register actions">
            <button type="button" onClick={() => { setRegister(loadDemo()); select('V-08'); setNotice({ kind: 'info', text: 'Reloaded the synthetic register.' }); }}>Load demo register</button>
            <button type="button" onClick={addVendor}>Add vendor</button>
            <button type="button" onClick={() => fileRef.current?.click()}>Import register</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
            <button type="button" onClick={() => downloadText(`tierline-register-${stamp}.json`, JSON.stringify(register, null, 2))}>Export register</button>
            <button type="button" onClick={() => downloadText(`tierline-assessment-${stamp}.json`, JSON.stringify({ schema: 'tierline.assessment/1', asOf: register.asOf, scoringNote: SCORING_NOTE, vendors: [...assessments.values()], queue }, null, 2))}>Export assessment JSON</button>
            <button type="button" onClick={() => downloadText(`tierline-queue-${stamp}.csv`, toCsv(queueToCsvRows(queue)), 'text/csv')}>Export queue CSV</button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.text}</p>
          {notice.details && <ul>{notice.details.slice(0, 12).map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}

      <div className="layout">
        <nav className="roster" aria-label="Vendors by residual exposure">
          <div className="roster__head">
            <h2>Vendors</h2>
            <p className="small muted">
              <span className="t t1">{tierCounts[0]} tier 1</span> · <span className="t t2">{tierCounts[1]} tier 2</span> · <span className="t t3">{tierCounts[2]} tier 3</span>
            </p>
          </div>
          {register.vendors.length === 0 ? <p className="empty">No vendors. Add one or import a register.</p> : (
            <ol className="roster__list">
              {sorted.map((v) => {
                const a = assessments.get(v.id)!;
                const n = queue.filter((q) => q.vendorId === v.id).length;
                return (
                  <li key={v.id}>
                    <button type="button" className={`row ${selected === v.id ? 'is-selected' : ''}`} aria-pressed={selected === v.id} onClick={() => select(v.id)}>
                      <span className={`tierdot t${a.tier}`} aria-label={`tier ${a.tier}`}>{a.tier}</span>
                      <span className="row__name">{v.name}</span>
                      <span className="row__nums mono">
                        <span title="inherent">{a.inherent.toFixed(0)}</span> → <span title="residual">{a.residual.toFixed(0)}</span>
                      </span>
                      <span className="row__meta small muted">
                        coverage {Math.round(a.coverage * 100)}% · {n === 0 ? 'queue clear' : `${n} queue item${n === 1 ? '' : 's'}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </nav>

        <main className="main">
          <section className="quad" aria-labelledby="quad-h">
            <div className="pane-head">
              <h2 id="quad-h">Portfolio: inherent risk vs assurance coverage</h2>
              <p className="small muted">Each dot is a vendor; colour = tier. Hollow dots show where one changed answer would move the selected vendor.</p>
            </div>
            <Quadrant vendors={register.vendors} assessments={assessments} selected={selected} onSelect={select} />
          </section>

          <section className="detail" id="detail" aria-live="polite">
            {vendor && assessment ? (
              <VendorDetail
                key={vendor.id}
                vendor={vendor}
                a={assessment}
                asOf={register.asOf}
                onChange={(fn, label) => updateVendor(vendor.id, fn, label)}
                onRemove={() => removeVendor(vendor.id)}
              />
            ) : (
              <div className="empty-detail">
                <h2>No vendor selected</h2>
                <p>Pick a vendor from the roster or the quadrant to see the questionnaire, the scoring trace, sensitivity flips and evidence status.</p>
              </div>
            )}
          </section>
        </main>
      </div>

      <Queue queue={queue} onJump={select} selected={selected} />

      <footer className="foot">
        <p>{SCORING_NOTE} Session state is memory-only; export to keep it. "SOC 2" and "ISO/IEC 27001" appear only as examples of assurance-report types.</p>
      </footer>
    </div>
  );
}
