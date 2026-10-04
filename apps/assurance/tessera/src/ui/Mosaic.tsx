import { CATALOG } from '../engine/catalog';
import type { CsfFunction, FunctionRollup, SubcategoryResult } from '../engine/types';

const FUNCTIONS: CsfFunction[] = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];

interface Props {
  results: Map<string, SubcategoryResult>;
  selected: string | null;
  onSelect: (id: string) => void;
  rollups: FunctionRollup[];
  /** Outcomes the forecast says degrade within `markerHorizon` days if no new evidence arrives. */
  degrading: ReadonlySet<string>;
  markerHorizon: number;
}

export function Mosaic({ results, selected, onSelect, rollups, degrading, markerHorizon }: Props) {
  return (
    <div className="mosaic">
      {FUNCTIONS.map((fn) => {
        const subs = CATALOG.filter((s) => s.fn === fn);
        const roll = rollups.find((r) => r.fn === fn)!;
        const categories = [...new Set(subs.map((s) => s.category))];
        return (
          <section key={fn} className={`row row--${fn}`} aria-labelledby={`fn-${fn}`}>
            <header className="row__head">
              <h3 id={`fn-${fn}`}>
                <span className="row__code">{fn}</span> {roll.functionName}
              </h3>
              <p className="row__roll">
                {roll.sufficient}/{roll.count} sufficient ·{' '}
                {roll.band === 'not-assessed' ? (
                  <span className="band band--not-assessed">not assessed (all scoped out)</span>
                ) : (
                  <>
                    mean residual <span className={`band band--${roll.band}`}>{roll.meanResidual?.toFixed(2)}</span>
                    {roll.assessed < roll.count && <span className="muted"> over {roll.assessed} assessed</span>}
                  </>
                )}
              </p>
            </header>
            <div className="row__cats">
              {categories.map((cat) => (
                <div key={cat} className="cat">
                  <div className="cat__label" title={subs.find((s) => s.category === cat)!.categoryName}>
                    {cat}
                  </div>
                  <div className="cat__tiles">
                    {subs
                      .filter((s) => s.category === cat)
                      .map((s) => {
                        const r = results.get(s.id)!;
                        const isSel = selected === s.id;
                        const warn = r.warnings.length > 0;
                        const willDegrade = degrading.has(s.id);
                        const forecastText = `forecast: degrades within ${markerHorizon} days if no new evidence is collected`;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`tile pat--${r.status} ${isSel ? 'is-selected' : ''} ${warn ? 'has-warning' : ''} ${willDegrade ? 'will-degrade' : ''}`}
                            aria-pressed={isSel}
                            aria-label={`${s.id}: ${r.status}, residual ${r.residual.toFixed(2)} (${r.band}), priority ${r.priority}${warn ? ', has reviewer warning' : ''}${willDegrade ? `, ${forecastText}` : ''}`}
                            title={willDegrade ? `${s.id} — ${forecastText}` : undefined}
                            onClick={() => onSelect(s.id)}
                          >
                            <span className="tile__id">{s.id.slice(6)}</span>
                            <span className="tile__prio" aria-hidden="true">{'●'.repeat(r.priority)}</span>
                            {warn && <span className="tile__warn" aria-hidden="true">!</span>}
                            {willDegrade && <span className="tile__fc" aria-hidden="true">↓</span>}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
