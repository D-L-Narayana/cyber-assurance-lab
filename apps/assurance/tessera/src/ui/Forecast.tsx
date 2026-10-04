import { CATALOG } from '../engine/catalog';
import { forecastSummary } from '../engine/forecast';
import type { ForecastRow } from '../engine/types';

export const HORIZONS = [30, 90, 180] as const;
export type Horizon = (typeof HORIZONS)[number];
/** Horizon used for the mosaic tile marker. */
export const MARKER_HORIZON: Horizon = 90;

interface Props {
  rows: ForecastRow[]; // every horizon; the panel filters to the selected one
  horizon: Horizon;
  onHorizon: (h: Horizon) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onExportCsv: () => void;
}

export function Forecast({ rows, horizon, onHorizon, selected, onSelect, onExportCsv }: Props) {
  const summary = forecastSummary(rows).find((s) => s.horizonDays === horizon);
  const degrading = rows.filter((r) => r.horizonDays === horizon && r.degrades);
  const lapses = summary?.decisionLapses ?? 0;
  return (
    <section className="forecast" aria-labelledby="forecast-h">
      <div className="pane-head forecast__head">
        <div>
          <h2 id="forecast-h">Evidence forecast</h2>
          <p className="pane-help">
            Every outcome re-evaluated at a later date with the pack unchanged: no new evidence, no re-collection, no new decisions.
            {summary && (
              <>
                {' '}By <strong>{summary.asOf}</strong> (+{horizon} days) <strong>{summary.degrading}</strong> of {summary.outcomes} outcomes degrade and {lapses} reviewer decision{lapses === 1 ? '' : 's'} lapse{lapses === 1 ? 's' : ''}.
              </>
            )}
          </p>
        </div>
        <div className="forecast__controls">
          <fieldset className="horizons">
            <legend>Horizon</legend>
            {HORIZONS.map((h) => (
              <label key={h}>
                <input type="radio" name="forecast-horizon" value={h} checked={horizon === h} onChange={() => onHorizon(h)} />
                <span>{h} days</span>
              </label>
            ))}
          </fieldset>
          <button type="button" onClick={onExportCsv}>Export forecast CSV</button>
        </div>
      </div>
      {degrading.length === 0 ? (
        <p className="empty">Nothing degrades within {horizon} days. Evidence that is already stale stays stale and outcomes without evidence stay at none; only a worsening residual counts as degradation.</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={`Outcomes degrading within ${horizon} days`}>
          <table>
            <thead>
              <tr>
                <th scope="col">Outcome</th>
                <th scope="col">Status now → then</th>
                <th scope="col">Residual now → then</th>
                <th scope="col">Drivers</th>
              </tr>
            </thead>
            <tbody>
              {degrading.map((r) => {
                const s = CATALOG.find((c) => c.id === r.subcategoryId)!;
                return (
                  <tr key={r.subcategoryId} className={r.subcategoryId === selected ? 'is-selected' : ''}>
                    <td>
                      <button type="button" className="linkish" onClick={() => onSelect(r.subcategoryId)}>
                        <span className={`fn fn--${s.fn}`}>{s.id}</span>
                      </button>
                      <div className="muted small">{s.categoryName}</div>
                    </td>
                    <td>
                      <span className={`status status--${r.statusNow}`}>{r.statusNow}</span> → <span className={`status status--${r.statusThen}`}>{r.statusThen}</span>
                    </td>
                    <td>
                      <span className={`band band--${r.bandNow}`}>{r.residualNow.toFixed(2)}</span> → <span className={`band band--${r.bandThen}`}>{r.residualThen.toFixed(2)}</span>
                      <div className="muted small">{r.bandNow} → {r.bandThen}</div>
                    </td>
                    <td className="fc-drivers">
                      {r.drivers.length > 0 && (
                        <ul className="drivers">
                          {r.drivers.map((d) => (
                            <li key={d.evidenceId}>
                              <span className="ev__id">{d.evidenceId}</span> {d.from} → {d.to}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.decisionLapses && (
                        <div className="small">
                          <strong>Decision lapses</strong> — the recorded decision will be older than 365 days; re-review required.
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
