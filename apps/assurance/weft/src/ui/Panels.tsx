import { useState } from 'react';
import type { Artifact, ArtifactInfo, Assertion, AssertionInfo, Bundle, Issue } from '../engine/types';

export function AssertionPanel({ assertion, info, bundle, onSignOff, onWithdraw, onEdit, onRemove, onJump }: { assertion: Assertion; info: AssertionInfo; bundle: Bundle; onSignOff: (reviewer: string) => void; onWithdraw: () => void; onEdit: (patch: Partial<Assertion>) => void; onRemove: () => void; onJump: (artifactId: string) => void }) {
  const [reviewer, setReviewer] = useState('');
  const linked = bundle.links.filter((l) => l.assertionId === assertion.id);
  return (
    <article className="panel">
      <p className="eyebrow">Assertion · <span className={`st st--${info.status}`}>{info.status}</span></p>
      <h2 className="mono">{assertion.id}</h2>
      <label><span>Control reference</span><input value={assertion.controlRef} maxLength={200} onChange={(e) => onEdit({ controlRef: e.target.value })} /></label>
      <label><span>Statement (editing it changes the binding hash)</span><textarea rows={2} maxLength={2000} value={assertion.statement} onChange={(e) => onEdit({ statement: e.target.value })} /></label>
      <div className="grid2">
        <label><span>Period start</span><input type="date" value={assertion.periodStart} onChange={(e) => e.target.value && onEdit({ periodStart: e.target.value })} /></label>
        <label><span>Period end</span><input type="date" value={assertion.periodEnd} onChange={(e) => e.target.value && onEdit({ periodEnd: e.target.value })} /></label>
      </div>
      <dl className="kv">
        <dt>Binding hash</dt><dd className="mono hash">{info.bindingHash}</dd>
        <dt>Sign-off</dt>
        <dd>
          {info.signoff ? (
            <span className={info.signoff.valid ? 'ok' : 'bad'}>{info.signoff.valid ? 'Valid' : 'INVALID'} — {info.signoff.reviewer} on {info.signoff.signedOn}{!info.signoff.valid && '; the statement or evidence changed since signing'}</span>
          ) : 'none'}
        </dd>
      </dl>
      <h3>Linked evidence ({linked.length})</h3>
      {linked.length === 0 ? <p className="empty">No evidence linked. Click a knot in the weave to link an artifact.</p> : (
        <ul className="evlist">
          {linked.map((l) => {
            const art = bundle.artifacts.find((a) => a.id === l.artifactId);
            const cls = info.tainted.includes(l.artifactId) ? 'tainted' : info.inPeriod.includes(l.artifactId) ? 'in' : info.outOfPeriod.includes(l.artifactId) ? 'out' : 'broken';
            return (
              <li key={l.artifactId} className={`ev ev--${cls}`}>
                <button type="button" className="linkish mono" onClick={() => art && onJump(l.artifactId)}>{l.artifactId}</button> {art ? `${art.name} · captured ${art.capturedOn}` : 'unknown artifact'} <span className="tag">{cls === 'in' ? 'in period' : cls === 'out' ? 'out of period' : cls}</span>
                {l.note && <div className="small muted">{l.note}</div>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="signrow">
        {info.signoff?.valid ? (
          <button type="button" className="ghost" onClick={onWithdraw}>Withdraw sign-off</button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); onSignOff(reviewer); }} className="inlineform">
            <label><span>Reviewer</span><input required maxLength={80} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="handle" /></label>
            <button type="submit" className="primary" title="Allowed only when the assertion is supported by in-period, hash-valid evidence">Sign off</button>
            {info.signoff && !info.signoff.valid && <button type="button" className="ghost" onClick={onWithdraw}>Clear stale sign-off</button>}
          </form>
        )}
        <button type="button" className="ghost danger" onClick={onRemove}>Remove assertion</button>
      </div>
    </article>
  );
}

export function ArtifactPanel({ artifact, info, onEdit, onRemove, onJump }: { artifact: Artifact; info: ArtifactInfo; onEdit: (patch: Partial<Artifact>) => void; onRemove: () => void; onJump: (assertionId: string) => void }) {
  return (
    <article className="panel">
      <p className="eyebrow">Artifact · {artifact.kind} · {info.bytes} bytes</p>
      <h2 className="mono">{artifact.id}</h2>
      <label><span>Name</span><input value={artifact.name} maxLength={200} onChange={(e) => onEdit({ name: e.target.value })} /></label>
      <label><span>Captured on</span><input type="date" value={artifact.capturedOn} onChange={(e) => e.target.value && onEdit({ capturedOn: e.target.value })} /></label>
      <dl className="kv">
        <dt>Computed SHA-256</dt><dd className="mono hash">{info.sha256}</dd>
        <dt>Declared SHA-256</dt>
        <dd className="mono hash">{artifact.declaredSha256 ?? <span className="muted">none recorded</span>}{info.declaredMatches === true && <span className="ok"> ✓ matches</span>}{info.declaredMatches === false && <span className="bad"> ✗ mismatch — content changed after collection</span>}</dd>
        <dt>Duplicates</dt><dd>{info.duplicateOf.length ? <span className="dup">identical content to {info.duplicateOf.join(', ')}</span> : '—'}</dd>
        <dt>Supports</dt><dd>{info.linkedAssertions.length ? info.linkedAssertions.map((id) => <button key={id} type="button" className="linkish mono" onClick={() => onJump(id)}>{id} </button>) : <span className="bad">nothing — orphan</span>}</dd>
      </dl>
      <label><span>Content (editing re-hashes immediately and invalidates any sign-off that bound this evidence)</span>
        <textarea rows={6} maxLength={50000} value={artifact.content} onChange={(e) => onEdit({ content: e.target.value })} className="mono" />
      </label>
      <div className="signrow">
        <button type="button" className="ghost" onClick={() => onEdit({ declaredSha256: info.sha256 })}>Record current hash as declared</button>
        <button type="button" className="ghost danger" onClick={onRemove}>Remove artifact</button>
      </div>
    </article>
  );
}

export function Ledger({ issues, high, onJump, onExport }: { issues: Issue[]; high: number; onJump: (ref: string) => void; onExport: () => void }) {
  const groups = new Map<string, Issue[]>();
  for (const i of issues) groups.set(i.kind, [...(groups.get(i.kind) ?? []), i]);
  return (
    <section className="ledger" aria-labelledby="ledger-h">
      <div className="ledger__head">
        <h2 id="ledger-h">Findings ledger</h2>
        <span className={`count ${high ? 'bad' : 'ok'}`}>{issues.length} finding{issues.length === 1 ? '' : 's'} · {high} high</span>
        <button type="button" className="ghost" onClick={onExport} title="Formula-safe CSV: kind, severity, refs, message">Export findings CSV</button>
      </div>
      {issues.length === 0 ? <p className="ok">Clean: every artifact is explained, every assertion is supported, every sign-off binds.</p> : (
        <ul className="groups">
          {[...groups.entries()].map(([kind, list]) => (
            <li key={kind}>
              <h3><span className={`sev sev--${list[0].severity}`}>{list[0].severity}</span> {kind} <span className="muted">({list.length})</span></h3>
              <ul>
                {list.map((i, n) => (
                  <li key={n}>
                    {i.refs.map((r) => <button key={r} type="button" className="linkish mono" onClick={() => onJump(r)}>{r}</button>)} {i.message}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
