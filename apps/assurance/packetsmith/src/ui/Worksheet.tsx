import { useState } from 'react';
import { METHODS } from '../engine/catalog';
import { controlStatus } from '../engine/packet';
import type { Blocker, Control, DeterminationResult, Finding, Method, Packet, Step } from '../engine/types';

interface Props {
  control: Control;
  packet: Packet;
  inScope: boolean;
  editable: boolean;
  integrity: Map<string, boolean>;
  blockers: Blocker[];
  onScope: (on: boolean) => void;
  onStep: (s: Step) => void;
  onRemoveStep: (id: string) => void;
  onResult: (r: DeterminationResult) => void;
  onFinding: (f: Finding) => void;
  onRemoveFinding: (id: string) => void;
}

export function Worksheet({ control, packet, inScope, editable, integrity, blockers, onScope, onStep, onRemoveStep, onResult, onFinding, onRemoveFinding }: Props) {
  const steps = packet.steps.filter((s) => s.controlId === control.id);
  const status = controlStatus(packet, control.id);
  const allAssessed = control.determinations.every((d) => {
    const r = packet.determinations.find((x) => x.determinationId === d.id);
    return r && r.result !== 'not-assessed';
  });

  return (
    <article className="ws" aria-labelledby="ws-h">
      <header className="ws__head">
        <div>
          <p className="eyebrow">{control.family}</p>
          <h2 id="ws-h">
            <span className="mono">{control.id}</span> {control.title}
          </h2>
          <p className="ws__summary">{control.summary}</p>
        </div>
        <div className="ws__right">
          {inScope && allAssessed && <div className={`stamp stamp--${status}`} aria-label={`Control result: ${status}`}>{status.replace(/-/g, ' ')}</div>}
          {inScope && !allAssessed && <div className="stamp stamp--pending" aria-label={`Control result: ${status}`}>{status.replace(/-/g, ' ')}</div>}
          <label className="scope">
            <input type="checkbox" checked={inScope} disabled={!editable} onChange={(e) => onScope(e.target.checked)} /> In scope for this packet
          </label>
        </div>
      </header>

      {!inScope && <p className="empty">This control is not in scope. Tick “In scope” to add it to the packet; the gate will then require performed steps and results.</p>}

      {inScope && blockers.length > 0 && (
        <div className="blockers" role="status">
          <strong>{blockers.length} blocker{blockers.length === 1 ? '' : 's'} on this control</strong>
          <ul>{blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
        </div>
      )}

      <section aria-labelledby="det-h" className="dets">
        <h3 id="det-h">Determination statements <span className="muted small">(paraphrased)</span></h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Determination statements table"><table className="dettable">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Statement</th>
              <th scope="col">Result</th>
              <th scope="col">Supporting steps</th>
            </tr>
          </thead>
          <tbody>
            {control.determinations.map((d) => {
              const r = packet.determinations.find((x) => x.determinationId === d.id);
              return (
                <DeterminationRow key={d.id} controlId={control.id} det={d} result={r} steps={steps} editable={editable && inScope} onResult={onResult} />
              );
            })}
          </tbody>
        </table></div>
      </section>

      <section aria-labelledby="steps-h" className="steps">
        <h3 id="steps-h">Procedure steps <span className="muted small">(examine · interview · test)</span></h3>
        {steps.length === 0 ? <p className="empty">No steps yet. Add one per method you intend to use.</p> : (
          <ul className="steplist">
            {steps.map((s) => (
              <li key={s.id} className={`step step--${s.status}`}>
                <div className="step__row">
                  <span className="mono step__id">{s.id}</span>
                  <span className={`method method--${s.method}`}>{s.method}</span>
                  <span className="step__obj">{s.object}</span>
                  <label className="inline">
                    <span className="sr">Status for {s.id}</span>
                    <select value={s.status} disabled={!editable} onChange={(e) => onStep({ ...s, status: e.target.value as Step['status'] })}>
                      <option value="planned">planned</option>
                      <option value="performed">performed</option>
                      <option value="skipped">skipped</option>
                    </select>
                  </label>
                  {editable && <button type="button" className="ghost small" onClick={() => onRemoveStep(s.id)}>Remove</button>}
                </div>
                <div className="step__meta">
                  Evidence:{' '}
                  {s.evidenceIds.length === 0 ? <em>none</em> : s.evidenceIds.map((e) => (
                    <span key={e} className={`chip ${integrity.get(e) === false ? 'chip--bad' : integrity.has(e) ? 'chip--ok' : 'chip--missing'}`}>
                      {e}{integrity.get(e) === false ? ' · hash mismatch' : integrity.has(e) ? '' : ' · unknown'}
                    </span>
                  ))}
                  {editable && <AttachEvidence step={s} packet={packet} onStep={onStep} />}
                </div>
                {s.status === 'skipped' && (
                  <label className="field">
                    <span>Skip reason (required, ≥ 10 characters)</span>
                    <input value={s.skipReason ?? ''} maxLength={2000} disabled={!editable} onChange={(e) => onStep({ ...s, skipReason: e.target.value })} />
                  </label>
                )}
                {s.notes && <p className="small muted">{s.notes}</p>}
              </li>
            ))}
          </ul>
        )}
        {editable && inScope && <AddStep control={control} nextIndex={packet.steps.length + 1} onStep={onStep} />}
      </section>

      <section aria-labelledby="find-h" className="findings">
        <h3 id="find-h">Findings and corrective actions</h3>
        {packet.findings.filter((f) => f.controlId === control.id).length === 0 ? <p className="empty">No findings for this control.</p> : (
          <ul className="findlist">
            {packet.findings.filter((f) => f.controlId === control.id).map((f) => (
              <li key={f.id} className={`finding sev--${f.severity}`}>
                <div className="finding__head">
                  <span className="mono">{f.id}</span> → <span className="mono">{f.determinationId}</span> <span className={`chip sevchip--${f.severity}`}>{f.severity}</span>
                  {editable && <button type="button" className="ghost small" onClick={() => onRemoveFinding(f.id)}>Remove</button>}
                </div>
                <p>{f.description}</p>
                <div className="finding__action">
                  <strong>Action:</strong> {f.action.description || <em>none</em>} · owner <strong>{f.action.owner || <em className="bad">missing</em>}</strong> · due{' '}
                  <strong className={f.action.status !== 'completed' && f.action.dueOn < packet.meta.asOf ? 'bad' : ''}>{f.action.dueOn}</strong> · {f.action.status}
                </div>
                {editable && (
                  <div className="grid3">
                    <label><span>Owner</span><input value={f.action.owner} maxLength={80} onChange={(e) => onFinding({ ...f, action: { ...f.action, owner: e.target.value } })} /></label>
                    <label><span>Due</span><input type="date" value={f.action.dueOn} onChange={(e) => e.target.value && onFinding({ ...f, action: { ...f.action, dueOn: e.target.value } })} /></label>
                    <label><span>Action status</span>
                      <select value={f.action.status} onChange={(e) => onFinding({ ...f, action: { ...f.action, status: e.target.value as Finding['action']['status'] } })}>
                        <option value="open">open</option><option value="in-progress">in-progress</option><option value="completed">completed</option>
                      </select>
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && inScope && <AddFinding control={control} packet={packet} onFinding={onFinding} />}
      </section>
    </article>
  );
}

function DeterminationRow({ controlId, det, result, steps, editable, onResult }: { controlId: string; det: Control['determinations'][number]; result?: DeterminationResult; steps: Step[]; editable: boolean; onResult: (r: DeterminationResult) => void }) {
  const current: DeterminationResult = result ?? { controlId, determinationId: det.id, result: 'not-assessed', stepIds: [], rationale: '' };
  const name = `res-${det.id}`;
  return (
    <tr>
      <th scope="row" className="mono">{det.id}</th>
      <td>
        {det.text}
        <label className="field">
          <span>Rationale</span>
          <input value={current.rationale} maxLength={2000} disabled={!editable} onChange={(e) => onResult({ ...current, rationale: e.target.value })} />
        </label>
      </td>
      <td>
        <fieldset className="results" disabled={!editable}>
          <legend className="sr">Result for {det.id}</legend>
          {(['satisfied', 'other-than-satisfied', 'not-assessed'] as const).map((v) => (
            <label key={v} className={`res res--${v} ${current.result === v ? 'is-on' : ''}`}>
              <input type="radio" name={name} value={v} checked={current.result === v} onChange={() => onResult({ ...current, result: v })} />
              {v === 'other-than-satisfied' ? 'other than satisfied' : v.replace('-', ' ')}
            </label>
          ))}
        </fieldset>
      </td>
      <td>
        {steps.length === 0 ? <em className="muted small">add steps first</em> : (
          <fieldset className="cites" disabled={!editable}>
            <legend className="sr">Steps supporting {det.id}</legend>
            {steps.map((s) => (
              <label key={s.id} className={`cite ${s.status !== 'performed' ? 'cite--weak' : ''}`}>
                <input type="checkbox" checked={current.stepIds.includes(s.id)} onChange={(e) => onResult({ ...current, stepIds: e.target.checked ? [...current.stepIds, s.id] : current.stepIds.filter((x) => x !== s.id) })} />
                <span className="mono">{s.id}</span> <span className="muted small">{s.method}{s.status !== 'performed' ? ` (${s.status})` : ''}</span>
              </label>
            ))}
          </fieldset>
        )}
      </td>
    </tr>
  );
}

function AttachEvidence({ step, packet, onStep }: { step: Step; packet: Packet; onStep: (s: Step) => void }) {
  const available = packet.artifacts.filter((a) => !step.evidenceIds.includes(a.id));
  if (available.length === 0) return null;
  return (
    <label className="inline attach">
      <span className="sr">Attach artifact to {step.id}</span>
      <select value="" onChange={(e) => e.target.value && onStep({ ...step, evidenceIds: [...step.evidenceIds, e.target.value] })}>
        <option value="">attach artifact…</option>
        {available.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.name}</option>)}
      </select>
    </label>
  );
}

function AddStep({ control, nextIndex, onStep }: { control: Control; nextIndex: number; onStep: (s: Step) => void }) {
  const [method, setMethod] = useState<Method>('examine');
  const [object, setObject] = useState(control.objects.examine[0]);
  return (
    <form className="addform" onSubmit={(e) => { e.preventDefault(); onStep({ id: `S-${String(nextIndex).padStart(2, '0')}`, controlId: control.id, method, object: object.trim(), status: 'planned', evidenceIds: [], notes: '' }); }}>
      <h4>Add a step for {control.id}</h4>
      <div className="grid3">
        <label><span>Method</span>
          <select value={method} onChange={(e) => { const m = e.target.value as Method; setMethod(m); setObject(control.objects[m][0]); }}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label><span>Assessment object</span>
          <input list={`obj-${control.id}-${method}`} required maxLength={200} value={object} onChange={(e) => setObject(e.target.value)} />
          <datalist id={`obj-${control.id}-${method}`}>{control.objects[method].map((o) => <option key={o} value={o} />)}</datalist>
        </label>
        <div className="align-end"><button type="submit">Add step</button></div>
      </div>
    </form>
  );
}

function AddFinding({ control, packet, onFinding }: { control: Control; packet: Packet; onFinding: (f: Finding) => void }) {
  const [determinationId, setDet] = useState(control.determinations[0].id);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Finding['severity']>('moderate');
  const [owner, setOwner] = useState('');
  const [dueOn, setDueOn] = useState(packet.meta.asOf);
  const [action, setAction] = useState('');
  return (
    <form className="addform" onSubmit={(e) => {
      e.preventDefault();
      onFinding({ id: `F-${String(packet.findings.length + 1).padStart(2, '0')}`, controlId: control.id, determinationId, description: description.trim(), severity, action: { description: action.trim(), owner: owner.trim(), dueOn, status: 'open' } });
      setDescription(''); setAction('');
    }}>
      <h4>Add a finding for {control.id}</h4>
      <div className="grid3">
        <label><span>Determination</span>
          <select value={determinationId} onChange={(e) => setDet(e.target.value)}>{control.determinations.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}</select>
        </label>
        <label><span>Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Finding['severity'])}><option value="low">low</option><option value="moderate">moderate</option><option value="high">high</option></select>
        </label>
        <label><span>Owner</span><input required maxLength={80} value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
        <label className="span2"><span>Description</span><input required maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label><span>Due</span><input type="date" required value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
        <label className="span2"><span>Corrective action</span><input required maxLength={2000} value={action} onChange={(e) => setAction(e.target.value)} /></label>
        <div className="align-end"><button type="submit">Add finding</button></div>
      </div>
    </form>
  );
}
