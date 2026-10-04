import { describeUnsupportedRange, maxSatisfying } from './semver';
import type { Edge, Graph, GraphNode, Lockgraph } from './types';

export const MAX_PATHS = 20;
export const MAX_DEPTH = 12;
/** Traversal budget for path enumeration: node expansions per direct dependency, and stored paths in total. */
export const BUDGET = { maxExpansionsPerDirect: 20_000, maxTotalPaths: 50_000 } as const;
export interface GraphOptions { maxExpansionsPerDirect?: number; maxTotalPaths?: number }
export const NO_MATCH = 'no package in the snapshot satisfies this range';

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Builds the resolved dependency graph: each range is bound to the highest package version in the snapshot that satisfies it.
 * Depth, one shortest path per node and reachability from each direct dependency come from breadth-first passes (exact, O(V+E)
 * per direct dependency); alternative root paths come from a depth-first enumeration bounded by MAX_DEPTH, MAX_PATHS per node and
 * the expansion/path budget — when that budget runs out `truncated` is set and only the listed paths are incomplete.
 */
export function buildGraph(lock: Lockgraph, options: GraphOptions = {}): Graph {
  const maxExpansions = Math.max(0, options.maxExpansionsPerDirect ?? BUDGET.maxExpansionsPerDirect);
  const maxTotalPaths = Math.max(0, options.maxTotalPaths ?? BUDGET.maxTotalPaths);
  const byName = new Map<string, string[]>();
  for (const p of lock.packages) byName.set(p.name, [...(byName.get(p.name) ?? []), p.version]);
  const nodes = new Map<string, GraphNode>();
  for (const p of lock.packages) nodes.set(`${p.name}@${p.version}`, { id: `${p.name}@${p.version}`, pkg: p, parents: [], children: [], paths: [], roots: [], depth: Number.POSITIVE_INFINITY, isDirect: false });
  const unresolved: Edge[] = [];
  const resolve = (name: string, range: string): string | null => { const v = maxSatisfying(byName.get(name) ?? [], range); return v ? `${name}@${v}` : null; };

  const rootId = `${lock.root.name}@${lock.root.version}`;
  const directIds: string[] = [];
  for (const [name, range] of Object.entries(lock.direct)) {
    const id = resolve(name, range);
    if (!id) { unresolved.push({ from: rootId, name, range, reason: NO_MATCH }); continue; }
    const n = nodes.get(id)!;
    n.isDirect = true; n.parents.push({ from: rootId, name, range }); directIds.push(id);
  }
  for (const n of nodes.values()) {
    for (const [name, range] of Object.entries(n.pkg.dependencies)) {
      const id = resolve(name, range);
      if (!id) { unresolved.push({ from: n.id, name, range, reason: NO_MATCH }); continue; }
      n.children.push({ to: id, range });
      nodes.get(id)!.parents.push({ from: n.id, name, range });
    }
  }
  // Declared ranges the semver subset cannot parse (npm: aliases, file:, git, tags…) are unresolved edges too — never matched, never widened.
  for (const u of lock.unparsable ?? []) unresolved.push({ from: u.from, name: u.name, range: u.range, reason: describeUnsupportedRange(u.range) });

  // 1. Exact depth and one shortest path per reachable node: breadth-first from the direct dependencies.
  const parentOf = new Map<string, string | null>();
  const order: string[] = [];
  for (const id of directIds) if (!parentOf.has(id)) { parentOf.set(id, null); nodes.get(id)!.depth = 1; order.push(id); }
  for (let i = 0; i < order.length; i++) {
    const n = nodes.get(order[i])!;
    for (const c of n.children) if (!parentOf.has(c.to)) { parentOf.set(c.to, n.id); nodes.get(c.to)!.depth = n.depth + 1; order.push(c.to); }
  }
  const seenPaths = new Set<string>();
  let stored = 0;
  for (const id of order) {
    const path: string[] = [];
    for (let cur: string | null = id; cur !== null; cur = parentOf.get(cur) ?? null) path.unshift(cur);
    nodes.get(id)!.paths.push(path); seenPaths.add(path.join('>')); stored++;
  }
  // 2. Exact reachability: which direct dependencies can reach each node (used for the inferred reachability label).
  for (const d of directIds) {
    const seen = new Set<string>([d]);
    const queue = [d];
    for (let i = 0; i < queue.length; i++) for (const c of nodes.get(queue[i])!.children) if (!seen.has(c.to)) { seen.add(c.to); queue.push(c.to); }
    for (const id of seen) nodes.get(id)!.roots.push(d);
  }
  // 3. Budgeted depth-first enumeration of alternative root paths; cycles are cut by the on-path check.
  let truncated = false;
  let expansions = 0;
  for (const d of directIds) {
    let used = 0;
    const walk = (id: string, path: string[]) => {
      if (path.includes(id) || path.length >= MAX_DEPTH) return;
      if (used >= maxExpansions) { truncated = true; return; }
      used++;
      const n = nodes.get(id)!;
      const here = [...path, id];
      if (n.paths.length < MAX_PATHS) {
        const key = here.join('>');
        if (!seenPaths.has(key)) {
          if (stored >= maxTotalPaths) truncated = true;
          else { n.paths.push(here); seenPaths.add(key); stored++; }
        }
      }
      for (const c of n.children) walk(c.to, here);
    };
    walk(d, []);
    expansions += used;
  }
  for (const n of nodes.values()) {
    if (!Number.isFinite(n.depth)) n.depth = 0; // orphan: present in snapshot but not reachable from root
    n.roots.sort(byCodeUnit);
    n.paths.sort((a, b) => a.length - b.length || byCodeUnit(a.join('>'), b.join('>')));
  }
  return { nodes, unresolved, directIds, truncated, expansions };
}
