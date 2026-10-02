import { useState } from 'react';
import type { Blocker, Packet, PacketState } from '../engine/types';

interface Props {
  packet: Packet;
  blockers: Blocker[];
  digest: string;
  onTransition: (to: PacketState, actor: string, note: string) => void;
  onJump: (controlId: string) => void;
}

const NEXT: Record<PacketState, { to: PacketState; label: string; hint: string }[]> = {
  drafting: [{ to: 'ready-for-review', label: 'Submit for review', hint: 'Assessor only; every blocker must be cleared.' }],
  'ready-for-review': [
    { to: 'approved', label: 'Approve packet', hint: 'Named approver only; never the assessor.' },
    { to: 'returned', label: 'Return with note', hint: 'A note explaining what to fix is required.' },
  ],
  returned: [{ to: 'drafting', label: 'Reopen for drafting', hint: 'Edits are allowed again.' }],
  approved: [],
};

export function Gate({ packet, blockers, digest, onTransition, onJump }: Props) {
  const [actor, setActor] = useState(packet.meta.assessor);
  const [note, setNote] = useState('');
  const byControl = new Map<string, Blocker[]>();
  for (const b of blockers) {
    const k = b.controlId ?? 'packet';
    byControl.set(k, [...(byControl.get(k) ?? []), b]);
  }
  return (
    <section className="gate" aria-labelledby="gate-h">
      <div className="gate__head">
        <h2 id="gate-h">Packet gate</h2>
        <span className={`state state--${packet.state}`}>{packet.state.replace(/-/g, ' ')}</span>
      </div>
      <p className="small">
        Digest <code className="mono digest" title={digest}>{digest.slice(0, 16)}…</code>
      </p>
      <div className={`gatecount ${blockers.length === 0 ? 'gatecount--clear' : ''}`}>
        {blockers.length === 0 ? 'No blockers — the completeness gate is satisfied.' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} before review`}
      </div>
      {blockers.length > 0 && (
        <ul className="gatelist">
          {[...byControl.entries()].map(([k, list]) => (
            <li key={k}>
              {k === 'packet' ? <strong>Packet</strong> : <button type="button" className="linkish mono" onClick={() => onJump(k)}>{k}</button>}
              <ul>{list.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
      {NEXT[packet.state].length > 0 && (
        <form className="transition" onSubmit={(e) => e.preventDefault()}>
          <label><span>Acting as</span><input value={actor} maxLength={80} onChange={(e) => setActor(e.target.value)} /></label>
          <label><span>Note</span><input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="required when returning" /></label>
          <div className="btnrow">
            {NEXT[packet.state].map((n) => (
              <button key={n.to} type="button" title={n.hint} className={n.to === 'approved' ? 'primary' : ''} onClick={() => { onTransition(n.to, actor, note); setNote(''); }}>{n.label}</button>
            ))}
          </div>
          <p className="muted small">{NEXT[packet.state].map((n) => n.hint).join(' ')}</p>
        </form>
      )}
      {packet.state === 'approved' && <p className="small">Approved packets are immutable. Export the JSON or print the memo.</p>}
      <h3>History</h3>
      {packet.history.length === 0 ? <p className="empty small">No transitions yet.</p> : (
        <ol className="history">
          {packet.history.map((h, i) => (
            <li key={i}><span className="mono">{h.at}</span> {h.from} → <strong>{h.to}</strong> by {h.actor}{h.note && <> — <em>{h.note}</em></>}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
