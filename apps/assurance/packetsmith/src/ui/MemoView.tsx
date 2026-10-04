import { useEffect, useRef } from 'react';
import { CATALOG, CATALOG_VERSION, PROCEDURES_VERSION, SUBSET_LABEL } from '../engine/catalog';
import { controlStatus, describeChain } from '../engine/packet';
import type { Blocker, Packet } from '../engine/types';

export function MemoView({ packet, digest, blockers, onClose }: { packet: Packet; digest: string; blockers: Blocker[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const chain = describeChain(packet);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = () => onClose();
    d?.addEventListener('close', onCancel);
    return () => d?.removeEventListener('close', onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} className="memo" aria-labelledby="memo-h">
      <div className="memo__bar no-print">
        <button type="button" onClick={() => window.print()}>Print</button>
        <button type="button" className="ghost" onClick={() => ref.current?.close()}>Close</button>
      </div>
      <article className="memo__body">
        <h1 id="memo-h">Assessment packet memo — {packet.meta.systemName}</h1>
        <p className="memo__warn">Educational prototype output on synthetic data. Not a FedRAMP, federal authorization or any other compliance determination. Determination statements are paraphrased.</p>
        <dl className="memo__meta">
          <dt>Catalog</dt><dd>{CATALOG_VERSION}</dd>
          <dt>Procedures</dt><dd>{PROCEDURES_VERSION}</dd>
          <dt>Scope</dt><dd>{SUBSET_LABEL}</dd>
          <dt>Assessor / approver</dt><dd>{packet.meta.assessor} / {packet.meta.approver}</dd>
          <dt>As of · state</dt><dd>{packet.meta.asOf} · {packet.state}</dd>
          <dt>Packet digest</dt><dd><code className="mono">{digest}</code> <span className="small">(content only; excludes state and history)</span></dd>
        </dl>
        <h2>Control results</h2>
        <table>
          <thead><tr><th>Control</th><th>Status</th><th>Determinations</th><th>Steps</th></tr></thead>
          <tbody>
            {packet.selectedControls.map((cid) => {
              const c = CATALOG.find((x) => x.id === cid)!;
              const steps = packet.steps.filter((s) => s.controlId === cid);
              return (
                <tr key={cid}>
                  <td><span className="mono">{cid}</span> {c.title}</td>
                  <td>{controlStatus(packet, cid)}</td>
                  <td>{c.determinations.map((d) => <div key={d.id}><span className="mono">{d.id}</span>: {packet.determinations.find((r) => r.determinationId === d.id)?.result ?? 'not-assessed'}</div>)}</td>
                  <td>{steps.filter((s) => s.status === 'performed').length}/{steps.length} performed</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>Findings</h2>
        {packet.findings.length === 0 ? <p>None recorded.</p> : (
          <table>
            <thead><tr><th>Finding</th><th>Ref</th><th>Severity</th><th>Description</th><th>Action · owner · due · status</th></tr></thead>
            <tbody>{packet.findings.map((f) => <tr key={f.id}><td className="mono">{f.id}</td><td className="mono">{f.determinationId}</td><td>{f.severity}</td><td>{f.description}</td><td>{f.action.description} · {f.action.owner || '—'} · {f.action.dueOn} · {f.action.status}</td></tr>)}</tbody>
          </table>
        )}
        <h2>Evidence artifacts</h2>
        <table>
          <thead><tr><th>Artifact</th><th>Kind</th><th>Captured</th><th>SHA-256</th></tr></thead>
          <tbody>{packet.artifacts.map((a) => <tr key={a.id}><td><span className="mono">{a.id}</span> {a.name}</td><td>{a.kind}</td><td>{a.capturedOn}</td><td className="mono small">{a.sha256}</td></tr>)}</tbody>
        </table>
        <h2>Completeness</h2>
        {blockers.length === 0 ? <p>No blockers.</p> : <ul>{blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>}
        <h2>History</h2>
        {packet.history.length === 0 ? <p>No transitions yet.</p> : (
          <>
            <p>History chain: <strong>{chain.label}</strong> — {chain.detail} The chain is tamper-evident for this exported record; it does not prove who acted.</p>
            <ul>{packet.history.map((h, i) => <li key={i}>{h.at}: {h.from} → {h.to} by {h.actor}{h.note ? ` — ${h.note}` : ''}{h.hash ? <> · hash <code className="mono small">{h.hash.slice(0, 12)}…</code></> : null}</li>)}</ul>
          </>
        )}
      </article>
    </dialog>
  );
}
