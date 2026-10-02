import type { Catalog, Graph, GraphEdge, GraphNode } from './types';
import { effectiveRetentionDays } from './retention';

/**
 * Builds the system lineage graph. Layers are longest-path depths from source systems computed with
 * Kahn's algorithm; nodes that sit on cycles are assigned the layer after their last processed
 * predecessor so every node still has a finite position. Cycles are reported separately.
 */
export function buildGraph(catalog: Catalog): Graph {
  const systemIds = new Set(catalog.systems.map((s) => s.id));
  const regionOf = new Map(catalog.systems.map((s) => [s.id, s.region]));
  const edges: GraphEdge[] = catalog.flows
    .filter((f) => systemIds.has(f.fromSystemId) && systemIds.has(f.toSystemId))
    .map((f) => ({ id: f.id, from: f.fromSystemId, to: f.toSystemId, elementIds: f.elementIds, mechanism: f.mechanism, crossRegion: regionOf.get(f.fromSystemId) !== regionOf.get(f.toSystemId) }));

  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of systemIds) { indeg.set(id, 0); out.set(id, []); }
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    out.get(e.from)!.push(e.to);
  }

  const layer = new Map<string, number>();
  const queue = [...systemIds].filter((id) => indeg.get(id) === 0).sort();
  for (const id of queue) layer.set(id, 0);
  const remaining = new Map(indeg);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of out.get(id)!) {
      layer.set(next, Math.max(layer.get(next) ?? 0, layer.get(id)! + 1));
      remaining.set(next, remaining.get(next)! - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }
  // Nodes left unprocessed are on or downstream of a cycle; give them a layer anyway.
  for (const id of systemIds) {
    if (!layer.has(id)) {
      const preds = edges.filter((e) => e.to === id).map((e) => layer.get(e.from) ?? 0);
      layer.set(id, (preds.length ? Math.max(...preds) : 0) + 1);
    }
  }

  const cycles = findCycles([...systemIds], out);

  const elementsBySystem = new Map<string, typeof catalog.elements>();
  for (const el of catalog.elements) {
    if (!elementsBySystem.has(el.systemId)) elementsBySystem.set(el.systemId, []);
    elementsBySystem.get(el.systemId)!.push(el);
  }

  const nodes: GraphNode[] = catalog.systems.map((system) => {
    const els = elementsBySystem.get(system.id) ?? [];
    const retentions = els.map((e) => effectiveRetentionDays(e, catalog.schedules) ?? 0);
    return {
      id: system.id,
      system,
      layer: layer.get(system.id) ?? 0,
      elementCount: els.length,
      maxRetentionDays: retentions.length ? Math.max(...retentions) : 0,
      inbound: edges.filter((e) => e.to === system.id).length,
      outbound: edges.filter((e) => e.from === system.id).length,
    };
  });

  return { nodes, edges, cycles };
}

/**
 * Cycle WITNESSES, not an enumeration of every elementary cycle. A single DFS with global colouring
 * reports one back-edge cycle per back edge it meets; cycles that share nodes with an already-finished
 * component can be missed. That is enough for a 'this inventory has circular flows' finding; full
 * enumeration (Johnson's algorithm) is deliberately out of scope.
 */
function findCycles(ids: string[], out: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const colour = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    colour.set(id, 1);
    stack.push(id);
    for (const next of out.get(id) ?? []) {
      if (colour.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join('>');
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle); }
      } else if (!colour.get(next)) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(id, 2);
  };
  for (const id of [...ids].sort()) if (!colour.get(id)) visit(id);
  return cycles;
}

export function downstreamOf(graph: Graph, systemId: string): Set<string> {
  const result = new Set<string>();
  const queue = [systemId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) {
      if (e.from === id && !result.has(e.to)) { result.add(e.to); queue.push(e.to); }
    }
  }
  return result;
}
