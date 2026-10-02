import { useState } from 'react';
import type { QueueItem, QueueKind } from '../engine/types';

const KINDS: QueueKind[] = ['missing-evidence', 'expired-evidence', 'expiring-evidence', 'future-dated-evidence', 'exception-expired', 'exception-expiring', 'exception-out-of-policy', 'review-overdue', 'review-due-soon', 'tier-drift', 'incomplete-questionnaire'];

export function Queue({ queue, onJump, selected }: { queue: QueueItem[]; onJump: (id: string) => void; selected: string | null }) {
  const [kind, setKind] = useState<QueueKind | 'all'>('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const rows = queue.filter((q) => (kind === 'all' || q.kind === kind) && (!onlySelected || q.vendorId === selected));
  return (
    <section className="queue" aria-labelledby="queue-h">
      <div className="pane-head queue__head">
        <div>
          <h2 id="queue-h">Review queue</h2>
          <p className="small muted">{queue.length} items across the register, ordered by priority = tier weight × urgency + overdue months (capped).</p>
        </div>
        <div className="queue__filters">
          <label className="inline"><span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as QueueKind | 'all')}>
              <option value="all">all kinds</option>
              {KINDS.map((k) => <option key={k} value={k}>{k} ({queue.filter((q) => q.kind === k).length})</option>)}
            </select>
          </label>
          <label className="inline check"><input type="checkbox" checked={onlySelected} disabled={!selected} onChange={(e) => setOnlySelected(e.target.checked)} /> selected vendor only</label>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty">Nothing in the queue for this filter.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Review queue table">
          <table>
            <thead><tr><th scope="col">Priority</th><th scope="col">Vendor</th><th scope="col">Kind</th><th scope="col">Detail</th><th scope="col">Due</th></tr></thead>
            <tbody>
              {rows.map((q, i) => (
                <tr key={i} className={q.vendorId === selected ? 'is-selected' : ''}>
                  <td className="mono">{q.priority.toFixed(2)}</td>
                  <td><button type="button" className="linkish" onClick={() => onJump(q.vendorId)}><span className={`tierdot t${q.tier}`}>{q.tier}</span> {q.vendorName}</button></td>
                  <td><span className={`kind kind--${q.kind}`}>{q.kind}</span></td>
                  <td>{q.detail}</td>
                  <td className="mono">{q.dueOn ?? '—'}{q.dueOn && q.daysOverdue > 0 && <span className="bad small"> +{q.daysOverdue} d</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
