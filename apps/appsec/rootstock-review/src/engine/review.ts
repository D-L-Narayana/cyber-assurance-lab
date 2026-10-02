import { buildGraph } from './graph';
import { compareVersions, minSatisfying, satisfies } from './semver';
import { SEVERITIES } from './types';
import { evaluateLicense } from './license';
import type { Advisory, Flag, GraphNode, Lockgraph, Plan, Reachability, Review, ReviewRow } from './types';

export { evaluateLicense } from './license';

const rank = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
function reachabilityOf(node: GraphNode, imports: Set<string>): { reachability: Reachability; detail: string } {
  if (node.isDirect && imports.has(node.pkg.name)) return { reachability: 'known', detail: 'Direct dependency and listed in the application\u2019s import evidence.' };
  const viaImported = node.paths.filter((p) => imports.has(p[0].split('@')[0]));
  if (viaImported.length) return { reachability: 'inferred', detail: `Reachable through imported direct dependency ${[...new Set(viaImported.map((p) => p[0]))].join(', ')}; whether the vulnerable code path is used is not known.` };
  if (node.isDirect) return { reachability: 'unknown', detail: 'Declared as a direct dependency but absent from the import evidence: possibly unused, possibly loaded dynamically.' };
  if (node.paths.length === 0) return { reachability: 'unknown', detail: 'Present in the snapshot but not reachable from the root through resolved edges.' };
  return { reachability: 'unknown', detail: `Only reachable through direct dependencies without import evidence (${[...new Set(node.paths.map((p) => p[0]))].join(', ')}).` };
}

function planFor(node: GraphNode, matched: Advisory[], lock: Lockgraph): Plan {
  const name = node.pkg.name;
  if (matched.some((a) => a.patched.trim() === '')) return { kind: 'no-fix-available', detail: `${matched.filter((a) => !a.patched.trim()).map((a) => a.id).join(', ')} list no patched version. Options: remove or replace ${name}, isolate the input it parses, or wait for upstream.` };
  const candidates = (lock.registry[name] ?? []).filter((v) => compareVersions(v, node.pkg.version) > 0 && matched.every((a) => satisfies(v, a.patched)));
  const target = candidates.length ? minSatisfying(candidates, '*') : null;
  if (!target) return { kind: 'no-fix-available', detail: `No version in the registry snapshot for ${name} satisfies ${matched.map((a) => a.patched).join(' and ')}.` };
  const blockedBy = node.parents.filter((p) => !satisfies(target, p.range)).map((p) => ({ parent: p.from, range: p.range }));
  if (blockedBy.length === 0) return { kind: 'bump-in-range', target, detail: `Every parent range already accepts ${name}@${target}; refreshing the lockfile is enough.` };
  const hints = blockedBy.map((b) => {
    const parentName = b.parent.split('@')[0];
    const parentVersion = b.parent.split('@')[1];
    const newer = (lock.registry[parentName] ?? []).filter((v) => compareVersions(v, parentVersion) > 0);
    return `${b.parent} declares ${b.range}, which excludes ${target}` + (newer.length ? `; newer ${parentName} ${newer.join(', ')} exist in the registry snapshot — check whether they accept ${name}@${target} (the snapshot does not record their dependency ranges)` : `; no newer ${parentName} in the registry snapshot, so this waits on upstream or an override`);
  });
  return { kind: 'parent-conflict', target, blockedBy, detail: hints.join('. ') + '.' };
}

export function reviewDependencies(lock: Lockgraph): Review {
  const graph = buildGraph(lock);
  const imports = new Set(lock.imports);
  const versionsByName = new Map<string, number>();
  for (const p of lock.packages) versionsByName.set(p.name, (versionsByName.get(p.name) ?? 0) + 1);
  const rows: ReviewRow[] = [];
  for (const node of [...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const matched = lock.advisories.filter((a) => a.package === node.pkg.name && satisfies(node.pkg.version, a.vulnerable));
    const advisories = matched.map((a) => ({ ...a, blocking: rank(a.severity) <= rank(lock.policy.blockSeverity) }));
    const license = evaluateLicense(node.pkg.license, lock.policy);
    const flags: Flag[] = [];
    if (lock.policy.flagInstallScripts && node.pkg.hasInstallScript) flags.push('install-script');
    if (lock.policy.flagDeprecated && node.pkg.deprecated) flags.push('deprecated');
    if ((versionsByName.get(node.pkg.name) ?? 0) > 1) flags.push('multiple-versions');
    const { reachability, detail } = reachabilityOf(node, imports);
    rows.push({
      id: node.id, name: node.pkg.name, version: node.pkg.version, depth: node.depth, isDirect: node.isDirect,
      parents: node.parents.map((p) => p.from), paths: node.paths, license, advisories,
      ...(matched.length ? { plan: planFor(node, matched, lock) } : {}),
      reachability, reachabilityDetail: detail, flags,
      attention: advisories.length > 0 || license.verdict !== 'allow' || flags.length > 0,
    });
  }
  return {
    rows,
    unresolved: graph.unresolved,
    summary: {
      packages: rows.length,
      vulnerable: rows.filter((r) => r.advisories.length).length,
      blocking: rows.filter((r) => r.advisories.some((a) => a.blocking)).length,
      licenseDeny: rows.filter((r) => r.license.verdict === 'deny').length,
      licenseReview: rows.filter((r) => r.license.verdict === 'review').length,
      unknownLicense: rows.filter((r) => r.license.verdict === 'unknown').length,
      unresolvedEdges: graph.unresolved.length,
      reachabilityUnknown: rows.filter((r) => r.reachability === 'unknown').length,
      flagged: rows.filter((r) => r.flags.length).length,
    },
    notes: {
      reachability: 'Reachability is an import-evidence hint (known / inferred / unknown), not exploitability. "Inferred" means a path exists from an imported direct dependency; it says nothing about whether the vulnerable function is called.',
      severity: 'Advisory severities are taken from the synthetic advisory records; blocking means at or above the policy threshold.',
      data: 'All packages, versions, licences, advisories and registry entries in the demo are synthetic. Nothing is fetched from a live registry or advisory database.',
    },
  };
}
