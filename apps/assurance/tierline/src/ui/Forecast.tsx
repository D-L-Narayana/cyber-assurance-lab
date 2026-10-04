import { useMemo, useState } from 'react';
import { addDays, DEFAULT_FORECAST_DAYS, FORECAST_HORIZONS, forecastQueue, forecastToCsvRows, toCsv } from '../engine/assess';
import type { ForecastKind, Register } from '../engine/types';
import { downloadText } from './files';

const KINDS: ForecastKind[] = ['evidence-lapses', 'exception-expires', 'review-due'];

/** What will lapse within the chosen horizon if nothing new is filed. Already-lapsed items live in the Queue, not here. */
export function Forecast({ register, onJump, selected }: { register: Register; onJump: (id: string) => void; selected: string | null }) {
  const [horizon, setHorizon] = useState<number>(DEFAULT_FORECAST_DAYS);
  const items = useMemo(() => forecastQueue(register, register.asOf, horizon), [register, horizon]);
  const stamp = register.asOf.replace(/-/g, '');
  return (
    <section className="forecast" aria-labelledby="forecast-h">
      <div className="pane-head queue__head">
        <div>
          <h2 id="forecast-h">Forecast: lapses within {horizon} days</h2>
          <p className="small muted">
            {items.length} item{items.length === 1 ? '' : 's'} would lapse by {addDays(register.asOf, horizon)} if nothing new is filed and no review is held
            {' '}({KINDS.map((k) => `${items.filter((i) => i.kind === k).length} ${k}`).join(' · ')}). Items that have already lapsed are in the review queue below, not here.
          </p>
        </div>
        <div className="queue__filters">
          <label className="inline"><span>Horizon</span>
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {FORECAST_HORIZONS.map((h) => <option key={h} value={h}>{h} days</option>)}
            </select>
          </label>
          <button type="button" className="ghost" onClick={() => downloadText(`tierline-forecast-${stamp}-${horizon}d.csv`, toCsv(forecastToCsvRows(items)), 'text/csv')}>Export forecast CSV</button>
        </div>
      </div>
      {items.length === 0 ? <p className="empty">Nothing lapses within {horizon} days.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Forecast table">
          <table>
            <thead><tr><th scope="col">Lapses on</th><th scope="col">In</th><th scope="col">Vendor</th><th scope="col">Kind</th><th scope="col">Detail</th></tr></thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={n} className={i.vendorId === selected ? 'is-selected' : ''}>
                  <td className="mono">{i.lapsesOn}</td>
                  <td className="mono">{i.daysUntil} d</td>
                  <td><button type="button" className="linkish" onClick={() => onJump(i.vendorId)}><span className={`tierdot t${i.tier}`}>{i.tier}</span> {i.vendorName}</button></td>
                  <td><span className={`kind kind--${i.kind}`}>{i.kind}</span></td>
                  <td>{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
