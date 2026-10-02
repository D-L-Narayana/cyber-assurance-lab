import type { Decision } from '../engine/types';
import { RULES } from '../engine/evaluate';

interface Props {
  title: string;
  decision: Decision;
  /** Optional other decision to highlight differing rungs against. */
  against?: Decision;
}

const STATEMENTS = new Map(RULES.map((r) => [r.id, r.statement]));

export function Ladder({ title, decision, against }: Props) {
  const otherById = new Map(against?.trace.map((t) => [t.ruleId, t]) ?? []);
  return (
    <section aria-label={`${title}: ${decision.decision} by ${decision.ruleId}`}>
      <div className="ladder-head">
        <h3>{title}</h3>
        <span className="evt">{decision.eventId}</span>
      </div>
      <ol className="ladder">
        {decision.trace.map((t) => {
          const other = otherById.get(t.ruleId);
          const differs = against ? !other || other.outcome !== t.outcome || (t.outcome === 'matched' && against.reasonCode !== decision.reasonCode) : false;
          return (
            <li key={t.ruleId} className={`rung ${t.outcome}${differs ? ' differs' : ''}`} title={STATEMENTS.get(t.ruleId)}>
              <span className="rid">{t.ruleId} · {t.outcome}</span>
              <span className="rtitle">{t.title}</span>
              <span className="rnote">{t.note}</span>
              {t.outcome === 'matched' && (
                <>
                  <span className={`stamp ${decision.decision}`} role="status">
                    {decision.decision.toUpperCase()}
                    <small>{decision.reasonCode}</small>
                  </span>
                  {(decision.basis || decision.recordId) && (
                    <span className="basis">
                      {decision.basis && <>basis: <code>{decision.basis}</code></>}
                      {decision.basis && decision.recordId && ' · '}
                      {decision.recordId && <>record: <code>{decision.recordId}</code></>}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
