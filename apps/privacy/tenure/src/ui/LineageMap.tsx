import { useMemo, useState } from 'react';
import type { Finding, Graph } from '../engine/types';

interface Props {
  graph: Graph;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (systemId: string) => void;
}

const COL_W = 230;
const ROW_H = 118;
const NODE_W = 170;
const NODE_H = 62;
const PAD_X = 70;
const PAD_Y = 44;

/** Ring length encodes retention on a log scale: 90 days is a short arc, 10 years almost a full circle. */
function ringFraction(days: number): number {
  if (days <= 0) return 0;
  return Math.min(1, Math.log10(days + 1) / Math.log10(3651));
}

export function LineageMap({ graph, findings, selectedId, onSelect }: Props) {
  const [zoom, setZoom] = useState(1);
  const layout = useMemo(() => {
    const byLayer = new Map<number, string[]>();
    for (const n of graph.nodes) {
      if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
      byLayer.get(n.layer)!.push(n.id);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 1;
    for (const [layer, ids] of byLayer) {
      ids.sort();
      maxRows = Math.max(maxRows, ids.length);
      ids.forEach((id, i) => pos.set(id, { x: PAD_X + layer * COL_W, y: PAD_Y + i * ROW_H }));
    }
    const layers = Math.max(...graph.nodes.map((n) => n.layer), 0) + 1;
    return { pos, width: PAD_X * 2 + layers * COL_W - (COL_W - NODE_W), height: PAD_Y * 2 + maxRows * ROW_H - (ROW_H - NODE_H) + 20, layers };
  }, [graph]);

  const unmappedFlows = new Set(findings.filter((f) => f.code === 'UNMAPPED_TRANSFER').map((f) => f.subject.id));
  const bySystem = useMemo(() => {
    const m = new Map<string, { critical: number; other: number }>();
    for (const f of findings) {
      if (f.accepted || !f.systemId) continue;
      const cur = m.get(f.systemId) ?? { critical: 0, other: 0 };
      if (f.severity === 'critical' || f.severity === 'high') cur.critical += 1; else cur.other += 1;
      m.set(f.systemId, cur);
    }
    return m;
  }, [findings]);

  const connected = new Set<string>();
  if (selectedId) {
    for (const e of graph.edges) if (e.from === selectedId || e.to === selectedId) { connected.add(e.from); connected.add(e.to); }
  }

  const summary = `${graph.nodes.length} systems in ${layout.layers} layers, ${graph.edges.length} flows, ${graph.cycles.length} cycle(s), ${unmappedFlows.size} unmapped cross-region transfer(s).`;

  return (
    <div className="map-wrap">
      <div className="map-controls" role="group" aria-label="Map zoom">
        <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.min(2, z + 0.2))} aria-label="Zoom in">+</button>
        <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} aria-label="Zoom out">−</button>
        <button type="button" className="btn btn-sm" onClick={() => setZoom(1)}>Reset</button>
      </div>
      <div className="map-scroll">
        <svg className="map" style={{ width: `${100 * zoom}%`, minWidth: `${Math.round(layout.width * 0.6 * zoom)}px`, height: 'auto' }} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`Lineage map. ${summary} Use the inventory table for a full list.`}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker>
          </defs>
          {Array.from({ length: layout.layers }, (_, l) => (
            <text key={l} className="layer-label" x={PAD_X + l * COL_W} y={PAD_Y - 18}>{l === 0 ? 'Sources' : `Layer ${l}`}</text>
          ))}
          {graph.edges.map((e) => {
            const a = layout.pos.get(e.from)!;
            const b = layout.pos.get(e.to)!;
            const back = b.x <= a.x;
            const x1 = back ? a.x : a.x + NODE_W;
            const x2 = back ? b.x + NODE_W : b.x;
            const y1 = a.y + NODE_H / 2;
            const y2 = b.y + NODE_H / 2;
            const dx = Math.max(60, Math.abs(x2 - x1) / 2);
            const d = back
              ? `M ${x1} ${y1} C ${x1 - dx} ${y1 + 40}, ${x2 + dx} ${y2 + 40}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            const focus = selectedId && (e.from === selectedId || e.to === selectedId);
            const dim = selectedId && !focus;
            const cls = `edge${e.crossRegion ? ' cross' : ''}${unmappedFlows.has(e.id) ? ' unmapped' : ''}${focus ? ' focus' : ''}${dim ? ' dim' : ''}`;
            return <path key={e.id} className={cls} d={d} markerEnd="url(#arrow)"><title>{`${e.from} → ${e.to}: ${e.elementIds.length} element(s), ${e.mechanism}${e.crossRegion ? ', cross-region' : ''}`}</title></path>;
          })}
          {graph.nodes.map((n) => {
            const p = layout.pos.get(n.id)!;
            const badge = bySystem.get(n.id);
            const frac = ringFraction(n.maxRetentionDays);
            const r = 16;
            const circ = 2 * Math.PI * r;
            const dim = selectedId && selectedId !== n.id && !connected.has(n.id);
            const years = n.maxRetentionDays >= 365 ? `${(n.maxRetentionDays / 365).toFixed(n.maxRetentionDays % 365 === 0 ? 0 : 1)} y` : `${n.maxRetentionDays} d`;
            return (
              <g key={n.id} className="node" transform={`translate(${p.x}, ${p.y})`} role="button" tabIndex={0} aria-pressed={selectedId === n.id} aria-label={`${n.system.name}, ${n.system.region}, ${n.elementCount} elements, longest retention ${years}${badge ? `, ${badge.critical + badge.other} open findings` : ''}`} onClick={() => onSelect(n.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n.id); } }} opacity={dim ? 0.35 : 1}>
                <rect className={`node-box${n.system.hosting === 'vendor' ? ' vendor' : ''}`} width={NODE_W} height={NODE_H} rx={6} />
                <circle className="ring-track" cx={28} cy={NODE_H / 2} r={r} strokeWidth={5} />
                <circle className="ring" cx={28} cy={NODE_H / 2} r={r} strokeWidth={5} strokeDasharray={`${circ * frac} ${circ}`} transform={`rotate(-90 28 ${NODE_H / 2})`} />
                <text className="node-meta" x={28} y={NODE_H / 2 + 3.5} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700, fill: 'var(--ink)' }}>{years}</text>
                <text className="node-name" x={54} y={26}>{n.system.name.length > 17 ? `${n.system.name.slice(0, 16)}…` : n.system.name}</text>
                <text className="node-meta" x={54} y={42}>{n.system.region} · {n.system.hosting} · {n.elementCount} el.</text>
                {badge && badge.critical > 0 && (
                  <g transform={`translate(${NODE_W - 12}, 0)`}><circle className="badge-crit" r={10} /><text className="badge-text" textAnchor="middle" y={3.5}>{badge.critical}</text></g>
                )}
                {badge && badge.other > 0 && (
                  <g transform={`translate(${NODE_W - (badge.critical > 0 ? 34 : 12)}, 0)`}><circle className="badge-warn" r={10} /><text className="badge-text" textAnchor="middle" y={3.5}>{badge.other}</text></g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="map-legend" aria-hidden="true">
        <span><i className="legend-ring" /> ring = longest retention (log scale)</span>
        <span><i className="legend-swatch" /> flow</span>
        <span><i className="legend-swatch dashed" /> cross-region flow</span>
        <span><i className="legend-swatch clay" /> transfer without mechanism</span>
        <span><span className="pill pill-critical" style={{ padding: '0 6px' }}>n</span> critical/high · <span className="pill" style={{ background: 'var(--ochre)', color: '#fff', padding: '0 6px' }}>n</span> other open findings</span>
      </div>
    </div>
  );
}
