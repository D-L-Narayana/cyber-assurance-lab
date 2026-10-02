import { daysBetween } from '../engine/lifecycle';
import type { Board, Derived, State } from '../engine/types';

const COLUMNS: { key: string; title: string; states: State[]; hint: string }[] = [
  { key: 'draft', title: 'Draft', states: ['draft'], hint: 'not yet submitted' },
  { key: 'review', title: 'Submitted · under review', states: ['submitted', 'under-review'], hint: 'awaiting quorum' },
  { key: 'active', title: 'Active', states: ['active'], hint: 'accepted, within term' },
  { key: 'lapsed', title: 'Expired · escalated', states: ['expired', 'escalated'], hint: 'past expiry without closure' },
  { key: 'done', title: 'Closed · rejected · withdrawn', states: ['closed', 'rejected', 'withdrawn'], hint: 'terminal' },
];

export function Kanban({ board, derived, selected, onSelect }: { board: Board; derived: Map<string, Derived>; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="kanban">
      {COLUMNS.map((col) => {
        const cards = board.exceptions.filter((e) => col.states.includes(e.state));
        return (
          <section key={col.key} className={`col col--${col.key}`} aria-labelledby={`col-${col.key}`}>
            <header className="col__head">
              <h3 id={`col-${col.key}`}>{col.title} <span className="count">{cards.length}</span></h3>
              <p className="small muted">{col.hint}</p>
            </header>
            {cards.length === 0 ? <p className="empty small">none</p> : (
              <ul className="cards">
                {cards.map((e) => {
                  const d = derived.get(e.id)!;
                  const total = Math.max(1, daysBetween(e.startOn, e.expiresOn));
                  const elapsed = Math.min(Math.max(daysBetween(e.startOn, board.asOf), 0), total);
                  const pct = Math.round((elapsed / total) * 100);
                  const tone = d.state === 'escalated' ? 'esc' : d.state === 'expired' ? 'exp' : d.expiring ? 'soon' : d.state === 'active' ? 'ok' : d.state === 'closed' ? 'done' : 'idle';
                  return (
                    <li key={e.id}>
                      <button type="button" className={`card tone--${tone} ${selected === e.id ? 'is-selected' : ''}`} aria-pressed={selected === e.id} onClick={() => onSelect(e.id)}
                        aria-label={`${e.id} ${e.title}, ${e.riskLevel} risk, ${d.expiring ? 'expiring' : d.state}${d.overdueDays ? `, ${d.overdueDays} days overdue` : ''}`}>
                        <div className="card__top">
                          <span className="mono card__id">{e.id}</span>
                          <span className={`risk risk--${e.riskLevel}`}>{e.riskLevel}</span>
                        </div>
                        <div className="card__title">{e.title}</div>
                        <div className="card__meta small muted">{e.policyRef} · owner {e.owner || '—'}</div>
                        <div className="ribbon" aria-hidden="true">
                          <span className="ribbon__fill" style={{ width: `${pct}%` }} />
                          <span className="ribbon__now" style={{ left: `${pct}%` }} />
                        </div>
                        <div className="card__dates small">
                          <span className="mono">{e.startOn}</span>
                          <span className={d.daysToExpiry < 0 ? 'bad' : d.expiring ? 'warn' : 'muted'}>
                            {d.state === 'closed' || d.state === 'rejected' || d.state === 'withdrawn' ? d.state : d.daysToExpiry < 0 ? `${-d.daysToExpiry} d past expiry` : `${d.daysToExpiry} d left`}
                            {e.renewals > 0 && ` · renewed ×${e.renewals}`}{e.pendingRenewal && ' · renewal pending'}
                          </span>
                          <span className="mono">{e.expiresOn}</span>
                        </div>
                        {(e.state === 'under-review' || e.state === 'submitted') && <div className="small quorum">quorum {d.quorum.have}/{d.quorum.need}{d.quorum.missingRoles.length ? ` · needs ${d.quorum.missingRoles.join(', ')}` : ''}</div>}
                        {d.guardrails.length > 0 && e.state !== 'draft' && <div className="small bad">policy violation on record</div>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
