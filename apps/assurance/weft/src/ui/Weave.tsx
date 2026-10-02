import type { Analysis, Bundle } from '../engine/types';

type Selection = { type: 'assertion'; id: string } | { type: 'artifact'; id: string } | null;

interface Props {
  bundle: Bundle;
  analysis: Analysis;
  sel: Selection;
  onSelect: (s: Selection) => void;
  onToggleLink: (assertionId: string, artifactId: string) => void;
}

const GLYPH: Record<string, string> = { 'in-period': '●', 'out-of-period': '○', tainted: '⊗', broken: '✕' };

export function Weave({ bundle, analysis, sel, onSelect, onToggleLink }: Props) {
  const brokenAssertions = [...new Set(bundle.links.filter((l) => !bundle.assertions.some((a) => a.id === l.assertionId)).map((l) => l.assertionId))];
  const cols = [...bundle.assertions.map((a) => ({ id: a.id, ghost: false })), ...brokenAssertions.map((id) => ({ id, ghost: true }))];
  if (bundle.assertions.length === 0 && bundle.artifacts.length === 0) return <p className="empty">Empty bundle. Add an assertion and an artifact, then click a cell to link them.</p>;
  return (
    <div className="weave-wrap" tabIndex={0} role="region" aria-label="Lineage weave grid">
      <table className="weave">
        <thead>
          <tr>
            <th scope="col" className="corner"><span className="small muted">artifact ↓ / assertion →</span></th>
            {cols.map((c) => {
              const info = analysis.assertions.find((a) => a.id === c.id);
              const isSel = sel?.type === 'assertion' && sel.id === c.id;
              return (
                <th scope="col" key={c.id} className={`colh ${info ? `st--${info.status}` : 'st--ghost'} ${isSel ? 'is-selected' : ''}`}>
                  {c.ghost ? (
                    <span className="ghosth mono" title="referenced by a link but not defined">{c.id}?</span>
                  ) : (
                    <button type="button" className="hbtn" aria-pressed={isSel} onClick={() => onSelect({ type: 'assertion', id: c.id })} aria-label={`${c.id}: ${info!.status}${info!.signoff ? (info!.signoff.valid ? ', signed' : ', sign-off invalid') : ''}`}>
                      <span className="mono">{c.id}</span>
                      <span className="hstat">{info!.status}{info!.signoff && <span className={info!.signoff.valid ? 'sig ok' : 'sig bad'}> {info!.signoff.valid ? '✓ signed' : '✗ sign-off'}</span>}</span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {bundle.artifacts.map((art) => {
            const info = analysis.artifacts.find((a) => a.id === art.id)!;
            const isSel = sel?.type === 'artifact' && sel.id === art.id;
            const rowClass = info.declaredMatches === false ? 'row--tainted' : info.linkedAssertions.length === 0 ? 'row--orphan' : info.duplicateOf.length ? 'row--dup' : '';
            return (
              <tr key={art.id} className={`${rowClass} ${isSel ? 'is-selected' : ''}`}>
                <th scope="row" className="rowh">
                  <button type="button" className="hbtn" aria-pressed={isSel} onClick={() => onSelect({ type: 'artifact', id: art.id })} aria-label={`${art.id} ${art.name}${info.declaredMatches === false ? ', hash mismatch' : ''}${info.linkedAssertions.length === 0 ? ', orphan' : ''}${info.duplicateOf.length ? ', duplicate content' : ''}`}>
                    <span className="mono">{art.id}</span> <span className="rname">{art.name}</span>
                    <span className="rhash mono">{info.sha256.slice(0, 10)}…{info.declaredMatches === false && <span className="bad"> ≠ declared</span>}{info.duplicateOf.length > 0 && <span className="dup"> = {info.duplicateOf.join(',')}</span>}</span>
                  </button>
                </th>
                {cols.map((c) => {
                  const key = `${c.id}|${art.id}`;
                  const state = analysis.cells[key];
                  return (
                    <td key={c.id} className={`cell ${state ? `cell--${state}` : ''}`}>
                      {c.ghost ? (
                        <span aria-label={state ? `broken link ${key}` : ''}>{state ? GLYPH[state] : ''}</span>
                      ) : (
                        <button type="button" className="knot" onClick={() => onToggleLink(c.id, art.id)} aria-label={`${state ? `Unlink ${art.id} from ${c.id} (${state})` : `Link ${art.id} to ${c.id}`}`} aria-pressed={!!state}>
                          {state ? GLYPH[state] : '·'}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
