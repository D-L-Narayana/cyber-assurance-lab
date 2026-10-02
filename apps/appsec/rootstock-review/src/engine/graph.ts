import { maxSatisfying } from './semver';
import type { Edge, Graph, GraphNode, Lockgraph } from './types';

export const MAX_PATHS = 20;
export const MAX_DEPTH = 12;

/** Builds the resolved dependency graph: each range is bound to the highest package version in the snapshot that satisfies it. */
export function buildGraph(lock: Lockgraph): Graph {
  const byName = new Map<string, string[]>();
  for (const p of lock.packages) byName.set(p.name, [...(byName.get(p.name) ?? []), p.version]);
  const nodes = new Map<string, GraphNode>();
  for (const p of lock.packages) nodes.set(`${p.name}@${p.version}`, { id: `${p.name}@${p.version}`, pkg: p, parents: [], children: [], paths: [], depth: Number.POSITIVE_INFINITY, isDirect: false });
  const unresolved: Edge[] = [];
  const resolve = (name: string, range: string): string | null => { const v = maxSatisfying(byName.get(name) ?? [], range); return v ? `${name}@${v}` : null; };

  const rootId = `${lock.root.name}@${lock.root.version}`;
  const directIds: string[] = [];
  for (const [name, range] of Object.entries(lock.direct)) {
    const id = resolve(name, range);
    if (!id) { unresolved.push({ from: rootId, name, range }); continue; }
    const n = nodes.get(id)!;
    n.isDirect = true; n.parents.push({ from: rootId, name, range }); directIds.push(id);
  }
  for (const n of nodes.values()) {
    for (const [name, range] of Object.entries(n.pkg.dependencies)) {
      const id = resolve(name, range);
      if (!id) { unresolved.push({ from: n.id, name, range }); continue; }
      n.children.push({ to: id, range });
      nodes.get(id)!.parents.push({ from: n.id, name, range });
    }
  }
  // Bounded DFS from each direct dependency to enumerate root paths; cycles are cut by the on-path check.
  const walk = (id: string, path: string[]) => {
    const n = nodes.get(id)!;
    if (path.includes(id) || path.length >= MAX_DEPTH) return;
    const here = [...path, id];
    if (n.paths.length < MAX_PATHS) n.paths.push(here);
    n.depth = Math.min(n.depth, here.length);
    for (const c of n.children) walk(c.to, here);
  };
  for (const id of directIds) walk(id, []);
  for (const n of nodes.values()) if (!Number.isFinite(n.depth)) n.depth = 0; // orphan: present in snapshot but not reachable from root
  return { nodes, unresolved, directIds };
}
