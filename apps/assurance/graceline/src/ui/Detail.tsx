import { useState } from 'react';
import { ROLE_LABEL } from '../engine/lifecycle';
import { POLICY } from '../engine/policy';
import { RISK_LEVELS, ROLES, type Derived, type Event, type Exception, type Role } from '../engine/types';

interface Props {
  e: Exception;
  d: Derived;
  asOf: string;
  onEvent: (ev: Event) => void;
  onEdit: (patch: Partial<Exception>) => void;
  onJumpAway: () => void;
}

export function Detail({ e, d, asOf, onEvent, onEdit }: Props) {
  const [actor, setActor] = useState(e.state === 'draft' ? e.requester : 'risk.owner');
  const [role, setRole] = useState<Role>('risk-owner');
  const [note, setNote] = useState('');
  const [newExpiry, setNewExpiry] = useState(e.expiresOn);
  const [evidence, setEvidence] = useState('');
  const [remStatus, setRemStatus] = useState(e.remediation.status);
  const isDraft = e.state === 'draft';
  const live = e.state === 'active' || e.state === 'expired' || e.state === 'escalated';
  const deciding = e.state === 'under-review' || (live && !!e.pendingRenewal);

  return (
    <article className="dt">
      <header className="dt__head">
        <div>
          <p className="eyebrow"><span className="mono">{e.id}</span> · {e.policyRef} · <span className={`risk risk--${e.riskLevel}`}>{e.riskLevel}</span> · <span className={`st st--${e.state}`}>{d.expiring ? 'expiring' : e.state}</span></p>
          <h2>{e.title}</h2>
          <p className="muted">Requested by {e.requester} on {e.requestedOn} · risk owner {e.owner || <em>none</em>} · {e.startOn} → {e.expiresOn} ({Math.max(0, d.daysToExpiry)} days left{d.overdueDays ? `, ${d.overdueDays} overdue` : ''}) · renewals {e.renewals}/{POLICY.maxRenewals}</p>
        </div>
      </header>

      {d.guardrails.length > 0 && (
        <div className="guard" role="status">
          <strong>Policy guardrails {isDraft ? 'this draft would fail' : 'violated on this record'}:</strong>
          <ul>{d.guardrails.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}

      <div className="dt__grid">
        <section className="panel">
          <h3>Request</h3>
          {isDraft ? (
            <div className="form">
              <label><span>Title</span><input value={e.title} maxLength={200} onChange={(ev) => onEdit({ title: ev.target.value })} /></label>
              <label><span>Policy reference</span><input value={e.policyRef} maxLength={200} onChange={(ev) => onEdit({ policyRef: ev.target.value })} /></label>
              <div className="grid3">
                <label><span>Risk level</span><select value={e.riskLevel} onChange={(ev) => onEdit({ riskLevel: ev.target.value as Exception['riskLevel'] })}>{RISK_LEVELS.map((r) => <option key={r} value={r}>{r} (max {POLICY.maxDurationDays[r]} d)</option>)}</select></label>
                <label><span>Requester</span><input value={e.requester} maxLength={80} onChange={(ev) => onEdit({ requester: ev.target.value })} /></label>
                <label><span>Risk owner</span><input value={e.owner} maxLength={80} onChange={(ev) => onEdit({ owner: ev.target.value })} /></label>
                <label><span>Start</span><input type="date" value={e.startOn} onChange={(ev) => ev.target.value && onEdit({ startOn: ev.target.value })} /></label>
                <label><span>Expires</span><input type="date" value={e.expiresOn} onChange={(ev) => ev.target.value && onEdit({ expiresOn: ev.target.value })} /></label>
                <label><span>Remediation due</span><input type="date" value={e.remediation.dueOn} onChange={(ev) => ev.target.value && onEdit({ remediation: { ...e.remediation, dueOn: ev.target.value } })} /></label>
              </div>
              <label><span>Justification (≥ {POLICY.minJustification} chars) <span className="muted">{e.justification.trim().length}</span></span><textarea rows={2} maxLength={2000} value={e.justification} onChange={(ev) => onEdit({ justification: ev.target.value })} /></label>
              <label><span>Compensating controls (one per line{POLICY.requireCompensating.includes(e.riskLevel) ? '; required at this risk level' : ''})</span><textarea rows={2} maxLength={2000} value={e.compensatingControls.join('\n')} onChange={(ev) => onEdit({ compensatingControls: ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} /></label>
              <label><span>Remediation plan</span><textarea rows={2} maxLength={2000} value={e.remediation.plan} onChange={(ev) => onEdit({ remediation: { ...e.remediation, plan: ev.target.value } })} /></label>
            </div>
          ) : (
            <dl className="kv">
              <dt>Justification</dt><dd>{e.justification}</dd>
              <dt>Compensating controls</dt><dd>{e.compensatingControls.length ? <ul className="plain">{e.compensatingControls.map((c) => <li key={c}>{c}</li>)}</ul> : <em>none</em>}</dd>
              <dt>Remediation</dt><dd>{e.remediation.plan} — due <span className="mono">{e.remediation.dueOn}</span> · <strong>{e.remediation.status}</strong></dd>
              {e.closure && <><dt>Closure</dt><dd>{e.closure.evidence} — {e.closure.closedBy}, {e.closure.closedOn}</dd></>}
            </dl>
          )}
        </section>

        <section className="panel">
          <h3>Approval quorum</h3>
          <p className="small">{d.quorum.required}. Have <strong>{d.quorum.have}</strong> of <strong>{d.quorum.need}</strong>{d.quorum.missingRoles.length ? <>; still needs <strong>{d.quorum.missingRoles.map((r) => ROLE_LABEL[r]).join(', ')}</strong></> : ''}. Approver must not be the requester or the risk owner.</p>
          {e.pendingRenewal && <p className="notice notice--warn small" role="status"><strong>Renewal pending:</strong> {e.pendingRenewal.requestedBy} asked on {e.pendingRenewal.requestedOn} to extend {e.expiresOn} → <span className="mono">{e.pendingRenewal.newExpiresOn}</span>. The current term keeps running until the quorum approves; it can still expire and escalate.</p>}
          {e.approvals.length === 0 ? <p className="empty small">No approvals recorded{e.pendingRenewal ? ' (reset by renewal request)' : ''}.</p> : (
            <ul className="approvals">{e.approvals.map((a, i) => <li key={i}><strong>{a.approver}</strong> <span className="rolechip">{ROLE_LABEL[a.role]}</span> <span className="mono small">{a.decidedOn}</span>{a.note && <div className="small muted">{a.note}</div>}</li>)}</ul>
          )}

          <h3>Actions</h3>
          <div className="form">
            <div className="grid3">
              <label><span>Acting as</span><input value={actor} maxLength={80} onChange={(ev) => setActor(ev.target.value)} /></label>
              {deciding && <label><span>Role</span><select value={role} onChange={(ev) => setRole(ev.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>}
              <label className="span2"><span>Note</span><input value={note} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} placeholder={deciding ? 'required when rejecting' : ''} /></label>
            </div>
            <div className="btnrow">
              {e.state === 'draft' && <button type="button" className="primary" onClick={() => onEvent({ type: 'submit', actor })}>Submit request</button>}
              {e.state === 'submitted' && <button type="button" className="primary" onClick={() => onEvent({ type: 'start-review', actor })}>Start review</button>}
              {deciding && <>
                <button type="button" className="primary" onClick={() => { onEvent({ type: 'approve', actor, role, note }); setNote(''); }}>{e.pendingRenewal ? 'Approve renewal' : 'Approve'}</button>
                <button type="button" className="danger" onClick={() => { onEvent({ type: 'reject', actor, note }); setNote(''); }}>{e.pendingRenewal ? 'Refuse renewal' : 'Reject'}</button>
              </>}
              {(e.state === 'draft' || e.state === 'submitted' || e.state === 'under-review') && <button type="button" className="ghost" onClick={() => onEvent({ type: 'withdraw', actor, note })}>Withdraw</button>}
            </div>
            {live && (
              <>
                <div className="grid3">
                  <label><span>Remediation status</span><select value={remStatus} onChange={(ev) => setRemStatus(ev.target.value as Exception['remediation']['status'])}><option value="planned">planned</option><option value="in-progress">in-progress</option><option value="done">done</option></select></label>
                  <div className="align-end"><button type="button" onClick={() => onEvent({ type: 'update-remediation', actor, status: remStatus, note })}>Update remediation</button></div>
                </div>
                {e.state !== 'escalated' && (
                  <div className="grid3">
                    <label><span>Renew to (≤ {POLICY.maxDurationDays[e.riskLevel]} d beyond current expiry; requester or risk owner only)</span><input type="date" value={newExpiry} onChange={(ev) => setNewExpiry(ev.target.value)} /></label>
                    <div className="align-end"><button type="button" onClick={() => onEvent({ type: 'renew', actor, newExpiresOn: newExpiry, note })} disabled={e.renewals >= POLICY.maxRenewals || !!e.pendingRenewal} title={e.renewals >= POLICY.maxRenewals ? 'Renewal limit reached; raise a new exception' : e.pendingRenewal ? 'A renewal is already pending approval' : ''}>Request renewal (needs quorum)</button></div>
                  </div>
                )}
                <label><span>Closure evidence (≥ {POLICY.minClosureEvidence} chars: what was done and where it can be verified)</span><textarea rows={2} maxLength={2000} value={evidence} onChange={(ev) => setEvidence(ev.target.value)} /></label>
                <div className="btnrow"><button type="button" className="primary" onClick={() => onEvent({ type: 'close', actor, evidence })}>Close with evidence</button></div>
              </>
            )}
            <p className="small muted">Board date {asOf}. Refused actions list every policy reason; nothing is silently ignored.</p>
          </div>
        </section>
      </div>

      <section className="ledger" aria-labelledby="hist-h">
        <h3 id="hist-h">Decision history ({e.history.length})</h3>
        {e.history.length === 0 ? <p className="empty small">No events yet.</p> : (
          <ol className="hist">
            {e.history.map((h, i) => (
              <li key={i} className={`hist__item ev--${h.event}`}>
                <span className="mono hist__at">{h.at}</span>
                <span className="hist__ev"><strong>{h.event}</strong> by {h.actor} · {h.from} → <strong>{h.to}</strong></span>
                {h.note && <span className="hist__note small muted">{h.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
