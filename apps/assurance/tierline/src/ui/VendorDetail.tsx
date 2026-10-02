import { useState } from 'react';
import { EVIDENCE_LABELS, QUESTIONS, REQUIREMENTS, REVIEW_MONTHS } from '../engine/model';
import { EVIDENCE_TYPES, type EvidenceItem, type EvidenceType, type Exception, type Vendor, type VendorAssessment } from '../engine/types';

interface Props {
  vendor: Vendor;
  a: VendorAssessment;
  asOf: string;
  onChange: (fn: (v: Vendor) => Vendor, label: string) => void;
  onRemove: () => void;
}

const optLabel = (qid: string, oid: string) => QUESTIONS.find((q) => q.id === qid)?.options.find((o) => o.id === oid)?.label ?? oid;

export function VendorDetail({ vendor, a, asOf, onChange, onRemove }: Props) {
  return (
    <article className="vd">
      <header className="vd__head">
        <div className="vd__title">
          <span className={`tierbadge t${a.tier}`}>Tier {a.tier}</span>
          <h2>{vendor.name}</h2>
          <p className="muted">{vendor.service || <em>service not described</em>} · owner {vendor.owner || <em>none</em>} · <span className="mono">{vendor.id}</span></p>
        </div>
        <div className="vd__scores">
          <Score label="inherent" value={a.inherent} />
          <Score label="coverage" value={Math.round(a.coverage * 100)} suffix="%" />
          <Score label="residual" value={a.residual} />
        </div>
      </header>

      <div className="vd__grid">
        <section aria-labelledby="qs-h" className="panel">
          <h3 id="qs-h">Inherent-risk questionnaire</h3>
          <ol className="qs">
            {QUESTIONS.map((q) => {
              const c = a.contributions.find((x) => x.questionId === q.id)!;
              const unanswered = a.unanswered.includes(q.id);
              return (
                <li key={q.id} className={unanswered ? 'q q--unanswered' : 'q'}>
                  <label>
                    <span className="q__dim">
                      {q.dimension} <span className="muted small">weight {q.weight}</span>
                      <span className={`q__contrib mono ${unanswered ? 'bad' : ''}`}>+{c.contribution}</span>
                    </span>
                    <span className="q__prompt small">{q.prompt}</span>
                    <select value={vendor.answers[q.id] ?? ''} onChange={(e) => onChange((v) => ({ ...v, answers: { ...v.answers, [q.id]: e.target.value } }), `Answered ${q.dimension}`)}>
                      <option value="" disabled>— unanswered (scored at maximum) —</option>
                      {q.options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.points})</option>)}
                    </select>
                  </label>
                </li>
              );
            })}
          </ol>
          <div className="bar" aria-hidden="true">
            {a.contributions.map((c) => <span key={c.questionId} className="bar__seg" style={{ width: `${c.contribution}%` }} title={`${c.dimension} ${c.contribution}`} />)}
          </div>
          <ul className="reasons">
            {a.tierReasons.map((r, i) => <li key={i}>{r}</li>)}
            {a.hardTriggers.map((t, i) => <li key={'h' + i} className="bad">{t}</li>)}
          </ul>
        </section>

        <section aria-labelledby="sens-h" className="panel">
          <h3 id="sens-h">Sensitivity: one answer away</h3>
          <p className="small muted">
            {a.distanceToNextTierUp !== null && <>Needs <strong>{a.distanceToNextTierUp}</strong> more points to reach tier {a.tier - 1}. </>}
            {a.distanceToTierDown !== null && <><strong>{a.distanceToTierDown}</strong> points above the tier {a.tier + 1} boundary{a.distanceToTierDown === 0 ? ' — any decrease moves it down' : ''}. </>}
            {a.distanceToTierDown === null && a.tier < 3 && <>Held at tier {a.tier} by a hard trigger; only removing the trigger can lower it. </>}
          </p>
          {a.flips.length === 0 ? <p className="empty">No single answer change moves this vendor's tier.</p> : (
            <ul className="flips">
              {a.flips.slice(0, 8).map((f, i) => (
                <li key={i} className={`flip flip--${f.direction}`}>
                  <span className={`arrow`} aria-hidden="true">{f.direction === 'up' ? '▲' : '▼'}</span>
                  <span>
                    <strong>{QUESTIONS.find((q) => q.id === f.questionId)!.dimension}</strong>: "{optLabel(f.questionId, f.fromOptionId)}" → "{optLabel(f.questionId, f.toOptionId)}" would make it <strong>tier {f.newTier}</strong>
                    <span className="mono small muted"> ({f.deltaScore > 0 ? '+' : ''}{f.deltaScore})</span>
                  </span>
                </li>
              ))}
              {a.flips.length > 8 && <li className="muted small">…and {a.flips.length - 8} more</li>}
            </ul>
          )}
        </section>

        <section aria-labelledby="ev-h" className="panel panel--wide">
          <h3 id="ev-h">Assurance evidence required at tier {a.tier}</h3>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Evidence requirements table"><table className="reqs">
            <thead><tr><th scope="col">Requirement</th><th scope="col">State</th><th scope="col">Evidence / exception</th><th scope="col">Expires</th><th scope="col">Credit</th></tr></thead>
            <tbody>
              {a.requirements.map((r) => (
                <tr key={r.type} className={`req req--${r.state}`}>
                  <td>{EVIDENCE_LABELS[r.type]} <span className="muted small">({REQUIREMENTS[a.tier].find((x) => x.type === r.type)!.validMonths} mo)</span></td>
                  <td><span className={`state state--${r.state}`}>{r.state}</span></td>
                  <td className="mono">{r.evidenceId ?? r.exceptionId ?? '—'}</td>
                  <td className="mono">{r.expiresOn ?? '—'}{r.daysLeft !== undefined && <span className="muted small"> ({r.daysLeft} d)</span>}</td>
                  <td className="mono">{r.credit}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="small muted">
            Periodic review every {REVIEW_MONTHS[a.tier]} months at tier {a.tier}: {vendor.lastReviewOn ? <>last {vendor.lastReviewOn}, due {a.reviewDueOn}</> : 'no review recorded'} —{' '}
            <strong className={a.reviewOverdue ? 'bad' : ''}>{a.reviewOverdue ? 'overdue' : 'on schedule'}</strong>.
            <button type="button" className="ghost small" onClick={() => onChange((v) => ({ ...v, lastReviewOn: asOf, recordedTier: a.tier }), `Recorded review on ${asOf} at tier ${a.tier}`)}>Record review today</button>
          </p>
          <details>
            <summary>All evidence on file ({vendor.evidence.length}) and exceptions ({vendor.exceptions.length})</summary>
            <ul className="evlist">
              {vendor.evidence.map((e) => (
                <li key={e.id}><span className="mono">{e.id}</span> {e.title} · {e.type} · issued {e.issuedOn} · {e.validMonths} mo{e.note && <> · <em>{e.note}</em></>}
                  <button type="button" className="ghost small" onClick={() => onChange((v) => ({ ...v, evidence: v.evidence.filter((x) => x.id !== e.id) }), `Removed ${e.id}`)}>Remove</button></li>
              ))}
              {vendor.exceptions.map((x) => (
                <li key={x.id} className="exc"><span className="mono">{x.id}</span> exception for {x.evidenceType} · approved by {x.approvedBy} · expires {x.expiresOn} · <em>{x.rationale}</em>
                  <button type="button" className="ghost small" onClick={() => onChange((v) => ({ ...v, exceptions: v.exceptions.filter((y) => y.id !== x.id) }), `Removed ${x.id}`)}>Remove</button></li>
              ))}
            </ul>
          </details>
          <div className="forms">
            <AddEvidence vendor={vendor} asOf={asOf} onChange={onChange} />
            <AddException vendor={vendor} asOf={asOf} onChange={onChange} />
          </div>
        </section>
      </div>

      <div className="vd__foot">
        <label className="inline"><span>Name</span><input value={vendor.name} maxLength={160} onChange={(e) => onChange((v) => ({ ...v, name: e.target.value }), 'Renamed vendor')} /></label>
        <label className="inline"><span>Service</span><input value={vendor.service} maxLength={160} onChange={(e) => onChange((v) => ({ ...v, service: e.target.value }), 'Updated service')} /></label>
        <label className="inline"><span>Owner</span><input value={vendor.owner} maxLength={80} onChange={(e) => onChange((v) => ({ ...v, owner: e.target.value }), 'Updated owner')} /></label>
        <button type="button" className="ghost danger" onClick={onRemove}>Remove vendor</button>
      </div>
    </article>
  );
}

function Score({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="score">
      <span className="score__v mono">{value}{suffix}</span>
      <span className="score__l">{label}</span>
    </div>
  );
}

function AddEvidence({ vendor, asOf, onChange }: { vendor: Vendor; asOf: string; onChange: Props['onChange'] }) {
  const [type, setType] = useState<EvidenceType>('questionnaire');
  const [title, setTitle] = useState('');
  const [issuedOn, setIssuedOn] = useState(asOf);
  const [validMonths, setValidMonths] = useState(12);
  return (
    <form className="addform" onSubmit={(e) => {
      e.preventDefault();
      const item: EvidenceItem = { id: `E-${vendor.id}-${vendor.evidence.length + 1}`, type, title: title.trim(), issuedOn, validMonths };
      onChange((v) => ({ ...v, evidence: [...v.evidence, item] }), `Added ${item.id}`);
      setTitle('');
    }}>
      <h4>Add evidence</h4>
      <label><span>Type</span><select value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label><span>Title</span><input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label><span>Issued on</span><input type="date" required value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>
      <label><span>Valid (months, 1–60)</span><input type="number" min={1} max={60} required value={validMonths} onChange={(e) => setValidMonths(Number(e.target.value))} /></label>
      <button type="submit">Add evidence</button>
    </form>
  );
}

function AddException({ vendor, asOf, onChange }: { vendor: Vendor; asOf: string; onChange: Props['onChange'] }) {
  const [evidenceType, setType] = useState<EvidenceType>('assurance-report');
  const [approvedBy, setApprovedBy] = useState('');
  const [rationale, setRationale] = useState('');
  const [expiresOn, setExpiresOn] = useState(asOf);
  return (
    <form className="addform" onSubmit={(e) => {
      e.preventDefault();
      const x: Exception = { id: `X-${vendor.id}-${vendor.exceptions.length + 1}`, evidenceType, approvedBy: approvedBy.trim(), rationale: rationale.trim(), expiresOn };
      onChange((v) => ({ ...v, exceptions: [...v.exceptions, x] }), `Added exception ${x.id}`);
      setRationale('');
    }}>
      <h4>Add exception <span className="muted small">(counts half; no credit beyond 180 days)</span></h4>
      <label><span>For evidence type</span><select value={evidenceType} onChange={(e) => setType(e.target.value as EvidenceType)}>{EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label><span>Approved by</span><input required maxLength={80} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></label>
      <label><span>Rationale</span><input required maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      <label><span>Expires on</span><input type="date" required value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label>
      <button type="submit">Add exception</button>
    </form>
  );
}
