import { useMemo, useState } from 'react';
import demoJson from '../fixtures/demo.json';
import { explainPath, exportReview, hotspots, reach, toxicCombinations, validateGraph, whatIfRemoveEdge } from '../engine/graph';
import type { Action, Graph, NodeKind } from '../engine/types';
import { parseBoundedJson } from '../engine/safe';
import { downloadText } from './download';

const LANES: NodeKind[] = ['identity', 'group', 'role', 'permission', 'asset'];
const LANE_TITLE: Record<NodeKind, string> = { identity: 'Identities', group: 'Groups', role: 'Roles', permission: 'Permissions', asset: 'Asset' };

export function App() {
  const initial = useMemo(() => { const v = validateGraph(demoJson); if (!v.ok) throw new Error(v.errors.join('; ')); return v.graph; }, []);
  const [graph, setGraph] = useState<Graph>(initial);
  const assets = graph.nodes.filter((n) => n.kind === 'asset');
  const [assetId, setAssetId] = useState(assets.find((a) => a.id === 'a-prod')?.id ?? assets[0]!.id);
  const [action, setAction] = useState<Action | 'any'>('any');
  const [selected, setSelected] = useState<string | null>(null);
  const [removeEdge, setRemoveEdge] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [hideNone, setHideNone] = useState(true);

  const result = useMemo(() => reach(graph, assetId, action), [graph, assetId, action]);
  const hs = useMemo(() => hotspots(graph), [graph]);
  const toxic = useMemo(() => toxicCombinations(graph), [graph]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);
  const asset = nodeById.get(assetId)!;
  const sel = result.identities.find((i) => i.identityId === selected) ?? null;

  // Lane layout: only nodes that participate in some path (or deny) for this query.
  const lanes = useMemo(() => {
    const used = new Map<string, Set<string>>(LANES.map((k) => [k, new Set<string>()]));
    const usedEdges = new Set<string>();
    for (const ia of result.identities) {
      for (const p of [...ia.paths, ...ia.blockedByCondition]) for (const s of p.steps) { used.get(nodeById.get(s.nodeId)!.kind)!.add(s.nodeId); if (s.via) usedEdges.add(s.via); }
      for (const d of ia.denies) { used.get('identity')!.add(ia.identityId); const k = nodeById.get(d.from)?.kind; if (k) used.get(k)!.add(d.from); usedEdges.add(d.edgeId); }
    }
    used.get('asset')!.add(assetId);
    const W = 1040, laneW = W / 5, rowH = 26, top = 34;
    const pos = new Map<string, { x: number; y: number; w: number }>();
    let maxRows = 1;
    LANES.forEach((k, li) => {
      const ids = [...used.get(k)!].sort((a, b) => (nodeById.get(a)!.label).localeCompare(nodeById.get(b)!.label));
      maxRows = Math.max(maxRows, ids.length);
      ids.forEach((id, ri) => pos.set(id, { x: li * laneW + 14, y: top + ri * rowH, w: laneW - 28 }));
    });
    return { W, H: top + maxRows * rowH + 10, laneW, rowH, pos, usedEdges: [...usedEdges].map((id) => edgeById.get(id)!).filter(Boolean) };
  }, [result, nodeById, edgeById, assetId]);

  const litEdges = useMemo(() => {
    const lit = new Map<string, 'ok' | 'denied' | 'cond'>();
    if (!sel) return lit;
    for (const p of sel.paths) for (const s of p.steps) if (s.via) lit.set(s.via, sel.decision === 'deny' ? 'denied' : 'ok');
    for (const p of sel.blockedByCondition) for (const s of p.steps) if (s.via && !lit.has(s.via)) lit.set(s.via, 'cond');
    return lit;
  }, [sel]);
  const selNodes = useMemo(() => { const s = new Set<string>(); if (sel) for (const p of [...sel.paths, ...sel.blockedByCondition]) for (const st of p.steps) s.add(st.nodeId); if (sel) for (const d of sel.denies) s.add(d.from); return s; }, [sel]);

  const whatIf = useMemo(() => { try { return removeEdge ? whatIfRemoveEdge(graph, removeEdge, assetId, action) : null; } catch { return null; } }, [graph, removeEdge, assetId, action]);
  const candidateEdges = lanes.usedEdges.filter((e) => e.kind !== 'applies_to');

  const onImport = async (file?: File) => {
    if (!file) return;
    const p = parseBoundedJson(await file.text()); if (!p.ok) { setNotice({ tone: 'error', text: p.error }); return; }
    const v = validateGraph(p.value); if (!v.ok) { setNotice({ tone: 'error', text: 'Graph rejected: ' + v.errors.slice(0, 5).join(' · ') }); return; }
    const firstAsset = v.graph.nodes.find((n) => n.kind === 'asset');
    if (!firstAsset) { setNotice({ tone: 'error', text: 'Graph rejected: it has no asset nodes.' }); return; }
    setGraph(v.graph); setAssetId(firstAsset.id); setSelected(null); setRemoveEdge(''); setNotice({ tone: 'ok', text: `Loaded “${v.graph.label}”: ${v.graph.nodes.length} nodes, ${v.graph.edges.length} edges.` });
  };
  const doExport = (kind: 'json' | 'csv') => {
    const out = exportReview(graph, result, hs, toxic);
    if (kind === 'json') downloadText('pathcaster-review.json', JSON.stringify(out.json, null, 2), 'application/json'); else downloadText('pathcaster-review.csv', out.csv, 'text/csv');
    setNotice({ tone: 'ok', text: `Exported ${kind.toUpperCase()} for ${asset.label} (${result.identities.length} identities).` });
  };
  const applyRemoval = () => {
    if (!whatIf) return;
    setGraph({ ...graph, edges: graph.edges.filter((e) => e.id !== whatIf.removedEdgeId) });
    setNotice({ tone: 'ok', text: `Removed edge ${whatIf.removedEdgeId} in this session's copy of the graph (synthetic; nothing external changed).` });
    setRemoveEdge('');
  };
  const curve = (a: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }) => { const x1 = a.x + a.w, y1 = a.y + lanes.rowH / 2 - 3, x2 = b.x, y2 = b.y + lanes.rowH / 2 - 3; const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };

  return (
    <>
      <header className="top">
        <div className="top-row">
          <h1>Pathcaster<small>Sensitive-data access-path explorer · deny-overrides · ABAC conditions · synthetic graph, educational prototype</small></h1>
          <div className="query">
            <label className="field">Asset<select value={assetId} onChange={(e) => { setAssetId(e.target.value); setSelected(null); setRemoveEdge(''); }}>{assets.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.sensitivity}</option>)}</select></label>
            <label className="field">Action<select value={action} onChange={(e) => { setAction(e.target.value as Action | 'any'); setSelected(null); setRemoveEdge(''); }}>{['any', 'read', 'write', 'admin'].map((a) => <option key={a}>{a}</option>)}</select></label>
            <label className="btn ghost">Load graph<input className="sr-only" type="file" accept=".json,application/json" onChange={(e) => onImport(e.target.files?.[0])} /></label>
            <button className="btn ghost" onClick={() => doExport('csv')}>Export CSV</button>
            <button className="btn" onClick={() => doExport('json')}>Export review JSON</button>
          </div>
        </div>
        <p className="summary" aria-live="polite"><b className="allow">{result.summary.allow}</b> identit{result.summary.allow === 1 ? 'y' : 'ies'} can reach <strong>{asset.label}</strong> ({action}) · <b className="deny">{result.summary.deny}</b> have a path but are blocked by an explicit deny · <b className="none">{result.summary.none}</b> have no path{result.summary.indeterminate > 0 && <> · <b className="indeterminate">{result.summary.indeterminate}</b> indeterminate (traversal budget exhausted — not a verdict)</>}. {graph.label}: {graph.nodes.length} nodes, {graph.edges.length} edges.</p>
        {notice && <p className={`notice ${notice.tone === 'error' ? 'error' : ''}`} role="status">{notice.text}</p>}
      </header>

      <div className="layout">
        <main className="main">
          <section aria-labelledby="lanes-h">
            <h2 id="lanes-h">Access paths<span className="mono">{selected ? `highlighting ${nodeById.get(selected)?.label}` : 'select an identity to light its paths'}</span></h2>
            <p className="note">Left to right: identity → group membership (nested allowed) → role assignment (may carry a condition) → permission → asset. Red dashed lines are explicit denies; they cut every path they touch. Amber dotted lines are paths blocked by a failed attribute condition.</p>
            <div className="lanes">
              <svg viewBox={`0 0 ${lanes.W} ${lanes.H}`} width="100%" role="group" aria-label={`Access path diagram for ${asset.label}. ${result.summary.allow} allowed, ${result.summary.deny} denied, ${result.summary.none} without a path. A table below lists each identity.`}>
                {LANES.map((k, i) => <g key={k}><text className="lane-title" x={i * lanes.laneW + 14} y={18}>{LANE_TITLE[k]}</text><line x1={i * lanes.laneW} x2={i * lanes.laneW} y1={0} y2={lanes.H} stroke="var(--line)" /></g>)}
                {lanes.usedEdges.filter((e) => e.kind !== 'deny').map((e) => { const a = lanes.pos.get(e.from), b = lanes.pos.get(e.to); if (!a || !b) return null; const lit = litEdges.get(e.id); return <path key={e.id} className={`edge ${lit === 'ok' ? 'lit' : lit === 'denied' ? 'lit denied' : lit === 'cond' ? 'cond-fail' : ''}`} d={curve(a, b)} opacity={sel && !lit ? 0.25 : 1} />; })}
                {lanes.usedEdges.filter((e) => e.kind === 'deny').map((e) => { const a = lanes.pos.get(e.from), b = lanes.pos.get(e.to); if (!a || !b) return null; const show = !sel || selNodes.has(e.from); return <g key={e.id} opacity={show ? 1 : 0.2}><path className="deny-edge" d={curve(a, b)} /><line className="cut" x1={b.x - 6} x2={b.x + 4} y1={b.y + 2} y2={b.y + lanes.rowH - 8} /></g>; })}
                {[...lanes.pos.entries()].map(([id, p]) => { const n = nodeById.get(id)!; const ia = n.kind === 'identity' ? result.identities.find((x) => x.identityId === id) : null; const dim = sel ? !selNodes.has(id) && id !== selected : false; return (
                  <g key={id} className={`node-g ${n.kind} ${dim ? 'dim' : ''} ${id === selected ? 'sel' : ''}`} tabIndex={n.kind === 'identity' ? 0 : -1} role={n.kind === 'identity' ? 'button' : undefined} aria-label={n.kind === 'identity' ? `${n.label}: ${ia?.decision}` : undefined}
                    onClick={() => n.kind === 'identity' && setSelected(id === selected ? null : id)} onKeyDown={(e) => { if (n.kind === 'identity' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(id === selected ? null : id); } }}>
                    <rect className="node" x={p.x} y={p.y} width={p.w} height={lanes.rowH - 6} />
                    <text x={p.x + 6} y={p.y + 14}>{n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label}</text>
                    {ia && <text className={`dec ${ia.decision}`} x={p.x + p.w - 6} y={p.y + 14} textAnchor="end">{ia.decision === 'allow' ? '✓' : ia.decision === 'deny' ? '✕' : ia.decision === 'indeterminate' ? '?' : '·'}</text>}
                  </g>); })}
              </svg>
            </div>
          </section>

          {sel && (
            <section aria-labelledby="exp-h">
              <h2 id="exp-h">Why · {nodeById.get(sel.identityId)?.label} <span className={`pill ${sel.decision}`}>{sel.decision}</span></h2>
              <ul className="explain">
                {sel.denies.map((d) => <li key={d.edgeId} className="denied">Deny override: {d.reason} (edge <span className="mono">{d.edgeId}</span>, from {nodeById.get(d.from)?.label}).</li>)}
                {sel.paths.map((p, i) => <li key={i} className={sel.decision === 'deny' ? 'denied' : ''}>{explainPath(graph, p)}</li>)}
                {sel.blockedByCondition.map((p, i) => <li key={'b' + i} className="cond">Blocked by condition: {explainPath(graph, p)} — failed: {p.conditions.filter((c) => !c.satisfied).map((c) => `${c.condition.attr} is ${(nodeById.get(sel.identityId)?.attrs ?? {})[c.condition.attr] ?? 'unset'}`).join(', ')}.</li>)}
                {sel.paths.length === 0 && sel.blockedByCondition.length === 0 && <li>No path from this identity to {asset.label}.</li>}
                {sel.truncated && <li className="cond">Traversal truncated: {sel.indeterminateReason ?? 'path cap reached; the verdict above is still definitive (see README semantics).'}</li>}
              </ul>
            </section>
          )}

          <section aria-labelledby="tbl-h">
            <h2 id="tbl-h">Identities<span className="mono">{result.identities.filter((i) => !hideNone || i.decision !== 'none' || i.blockedByCondition.length > 0).length} of {result.identities.length}</span></h2>
            <label className="note" style={{ display: 'block' }}><input type="checkbox" checked={hideNone} onChange={(e) => setHideNone(e.target.checked)} /> Hide identities with no path and no condition-blocked path</label>
            <div style={{ overflowX: "auto" }}>
            <table className="ids">
              <thead><tr><th scope="col">Identity</th><th scope="col">Attributes</th><th scope="col">Decision</th><th scope="col">Paths</th><th scope="col">Shortest explanation</th></tr></thead>
              <tbody>
                {result.identities.filter((i) => !hideNone || i.decision !== 'none' || i.blockedByCondition.length > 0).map((ia) => { const n = nodeById.get(ia.identityId)!; return (
                  <tr key={ia.identityId} aria-selected={ia.identityId === selected} onClick={() => setSelected(ia.identityId === selected ? null : ia.identityId)}>
                    <td><button className="btn small ghost" onClick={(e) => { e.stopPropagation(); setSelected(ia.identityId === selected ? null : ia.identityId); }} aria-pressed={ia.identityId === selected}>{n.label}</button><div className="mono">{n.id}</div></td>
                    <td className="mono">{Object.entries(n.attrs ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                    <td><span className={`pill ${ia.decision}`}>{ia.decision}</span></td>
                    <td className="mono">{ia.paths.length}{ia.blockedByCondition.length ? ` (+${ia.blockedByCondition.length} blocked)` : ''}</td>
                    <td>{ia.denies[0]?.reason ?? (ia.paths[0] ? explainPath(graph, ia.paths[0]) : ia.blockedByCondition[0] ? 'Only condition-blocked paths' : '—')}</td>
                  </tr>); })}
              </tbody>
            </table>
            </div>
          </section>
        </main>

        <aside className="side">
          <section aria-labelledby="hot-h">
            <h2 id="hot-h">Privilege hotspots</h2>
            <p className="note">Groups and roles ranked by how many identities they carry to high-sensitivity assets across the whole graph. A stale or over-broad hotspot is the first remediation candidate.</p>
            <ol className="rank">
              {hs.slice(0, 8).map((h) => <li key={h.nodeId}><div><div className="lbl"><span>{h.label}</span><span className="mono">{h.kind}</span></div><div className="bar" aria-hidden="true"><span style={{ width: `${hs[0]!.identities ? (h.identities / hs[0]!.identities) * 100 : 0}%` }} /></div></div><span className="mono">{h.identities} id · {h.highAssets} hi</span></li>)}
            </ol>
          </section>
          <section aria-labelledby="tox-h">
            <h2 id="tox-h">Toxic combinations<span className="mono">{toxic.length}</span></h2>
            {toxic.length === 0 ? <p className="note">No identity holds both sides of any toxic rule.</p> : (
              <ul className="toxic">{toxic.map((t) => { const r = graph.toxicRules.find((x) => x.id === t.ruleId)!; return <li key={t.ruleId + t.identityId}><strong>{nodeById.get(t.identityId)?.label}</strong> — {r.name}. <span className="note">{r.rationale}</span></li>; })}</ul>
            )}
          </section>
          <section aria-labelledby="wi-h" className="whatif">
            <h2 id="wi-h">What if an edge is removed?</h2>
            <p className="note">Pick an edge used in the current query and see who loses or gains access to {asset.label}. Applying the change edits this session's synthetic copy only.</p>
            <label className="field">Edge<select value={removeEdge} onChange={(e) => setRemoveEdge(e.target.value)}><option value="">Choose an edge</option>{candidateEdges.map((e) => <option key={e.id} value={e.id}>{e.id} · {nodeById.get(e.from)?.label} {e.kind} {nodeById.get(e.to)?.label}</option>)}</select></label>
            {whatIf && <div className="delta" role="status">Allowed before <b>{whatIf.before}</b> → after <b>{whatIf.after}</b>.{whatIf.lostAccess.length ? ` Loses access: ${whatIf.lostAccess.map((i) => nodeById.get(i)?.label).join(', ')}.` : ''}{whatIf.gainedAccess.length ? ` Gains access: ${whatIf.gainedAccess.map((i) => nodeById.get(i)?.label).join(', ')}.` : ''}{!whatIf.lostAccess.length && !whatIf.gainedAccess.length ? ' No change for this asset.' : ''}</div>}
            <button className="btn" disabled={!whatIf} onClick={applyRemoval}>Apply removal to session graph</button>
          </section>
        </aside>
      </div>
      <p className="foot">Pathcaster is an educational prototype over a synthetic RBAC/ABAC graph. No directory is enumerated and no permission is changed; "apply removal" edits an in-memory copy that resets on refresh. Deny-overrides and condition semantics are documented in the README and are not a statement about any specific product.</p>
    </>
  );
}
