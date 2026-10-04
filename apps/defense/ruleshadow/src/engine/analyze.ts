import { parseCidr, parsePorts, contains, subtractIntervals, mergeIntervals, addressCount, type Interval } from './net';
import type { Rule } from './rules';
import { coverage, formatCoverage, zoneCovers, DEFAULT_FRAGMENT_BUDGET, type Coverage } from './boxes';

export type FindingKind = 'redundant' | 'conflict' | 'overbroad' | 'expired' | 'stale' | 'vpn-management' | 'no-final-deny' | 'partially-shadowed';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export interface Finding { id: string; kind: FindingKind; severity: Severity; ruleId: string | null; relatedRuleIds: string[]; title: string; detail: string }
export interface AnalyzeOptions {
  now: string; staleDays?: number; managementPorts?: number[]; vpnZones?: string[]; broadDstMaxPrefix?: number;
  /** Union coverage at or above this share (and below 1) raises `partially-shadowed`; default 0.5. Full coverage (1) is always raised unless containment analysis already flagged the rule. */
  partialShadowThreshold?: number;
  /** Precomputed `analyzeCoverage(rules)` (e.g. shared with the UI); computed here when omitted. */
  coverage?: Record<string, Coverage>;
  /** Fragment budget per target box for the coverage pass (default 4 000); exceeding it marks the result approximate. */
  fragmentBudget?: number;
}

export const KIND_META: Record<FindingKind, { label: string; severity: Severity; explain: string }> = {
  redundant: { label: 'Shadowed (same action)', severity: 'low', explain: 'Earlier rules already match everything this rule matches with the same action, so it never fires. Safe to remove; keeping it hides intent drift.' },
  conflict: { label: 'Shadowed (opposite action)', severity: 'high', explain: 'An earlier rule with the opposite action matches everything this rule matches. The later rule is dead and the author\'s intent is unclear — someone expected it to work.' },
  overbroad: { label: 'Overbroad allow', severity: 'critical', explain: 'An allow that spans any source, any destination, or all ports defeats segmentation. Narrow to named zones, hosts and services.' },
  expired: { label: 'Expired', severity: 'medium', explain: 'The rule\'s expiry date has passed but it is still enabled. Temporary access that never ends is a classic audit finding.' },
  stale: { label: 'No traffic', severity: 'low', explain: 'No hits within the stale window (or never). Unused allows are attack surface with no business value; confirm with the owner before disabling.' },
  'vpn-management': { label: 'VPN to management ports', severity: 'high', explain: 'Remote-access users can reach administrative services (SSH/RDP/SMB/WinRM) on broad destinations. Route admin access through a jump host or a tightly scoped admin group.' },
  'no-final-deny': { label: 'No explicit final deny', severity: 'medium', explain: 'Without an explicit catch-all deny the implicit default is relied upon and logging of dropped traffic is usually lost.' },
  'partially-shadowed': { label: 'Partially shadowed', severity: 'info', explain: 'Earlier enabled rules in covering zones already match part (or, assembled from several rules, all) of this rule\'s address × port space — a union across address space, not containment. The rule still fires for the remainder, so this is informational: confirm the overlap is intended, especially when the covering rules have the opposite action.' },
};

interface Parsed { rule: Rule; src: Interval; dst: Interval; ports: Interval[]; protos: Set<string> }
function parse(r: Rule): Parsed | null {
  const src = parseCidr(r.src), dst = parseCidr(r.dst), ports = parsePorts(r.ports);
  if (!src || !dst || !ports) return null;
  const protos = new Set(r.proto === 'any' ? ['tcp', 'udp', 'icmp'] : [r.proto]);
  return { rule: r, src, dst, ports: r.proto === 'icmp' ? [{ lo: 0, hi: 65535 }] : ports, protos };
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Union coverage of every enabled rule by the enabled rules before it (rule order = first-match order), keyed by rule id.
 * Disabled rules have no entry. Pure and deterministic; the per-box fragment budget bounds the work (R12).
 */
export function analyzeCoverage(rules: Rule[], budget: number = DEFAULT_FRAGMENT_BUDGET): Record<string, Coverage> {
  const out: Record<string, Coverage> = {};
  const enabled = rules.filter(r => r.enabled);
  enabled.forEach((r, k) => { out[r.id] = coverage(r, enabled.slice(0, k), budget); });
  return out;
}

export function analyzeRules(rules: Rule[], opts: AnalyzeOptions): Finding[] {
  const staleDays = opts.staleDays ?? 90;
  const mgmt = opts.managementPorts ?? [22, 3389, 445, 5985, 5986, 135];
  const vpnZones = opts.vpnZones ?? ['vpn', 'remote-access'];
  const broadDstMaxPrefix = opts.broadDstMaxPrefix ?? 16;
  const threshold = opts.partialShadowThreshold ?? 0.5;
  const budget = opts.fragmentBudget ?? DEFAULT_FRAGMENT_BUDGET;
  const findings: Finding[] = [];
  const add = (kind: FindingKind, ruleId: string | null, related: string[], title: string, detail: string) =>
    findings.push({ id: `${kind}:${ruleId ?? 'policy'}`, kind, severity: KIND_META[kind].severity, ruleId, relatedRuleIds: related, title, detail });

  const parsed = rules.map(parse);
  const enabled = rules.map((r, i) => ({ r, p: parsed[i], i })).filter(x => x.r.enabled && x.p) as { r: Rule; p: Parsed; i: number }[];

  // Shadowing (containment-based): walk earlier enabled rules whose address ranges, zones and protocols CONTAIN this rule,
  // in first-match order. Each earlier rule only contributes the port space it still owns after the rules before it, so an
  // earlier rule that is itself fully shadowed never counts as operative coverage. If the consumed port space covers the
  // rule completely it is shadowed; the classification depends on the actions of the operative covering rules.
  const fmtRange = (iv: Interval) => iv.lo === iv.hi ? `${iv.lo}` : `${iv.lo}–${iv.hi}`;
  for (let k = 0; k < enabled.length; k++) {
    const { r, p } = enabled[k];
    let consumed: Interval[] = [];
    const operative: { id: string; action: Rule['action']; ranges: Interval[] }[] = [];
    for (let j = 0; j < k; j++) {
      const e = enabled[j];
      const covers = contains(e.p.src, p.src) && contains(e.p.dst, p.dst) && zoneCovers(e.r.zoneFrom, r.zoneFrom) && zoneCovers(e.r.zoneTo, r.zoneTo) && [...p.protos].every(x => e.p.protos.has(x));
      if (!covers) continue;
      // Port space of this rule that e matches and that no earlier operative rule already consumed.
      const inRule = subtractIntervals(p.ports, subtractIntervals(p.ports, e.p.ports)); // intersection(p.ports, e.ports)
      const contribution = subtractIntervals(inRule, consumed);
      if (!contribution.length) continue;
      operative.push({ id: e.r.id, action: e.r.action, ranges: contribution });
      consumed = mergeIntervals([...consumed, ...contribution]);
    }
    if (!operative.length || subtractIntervals(p.ports, consumed).length) continue;
    const ids = operative.map(o => o.id);
    const actions = new Set(operative.map(o => o.action));
    const trace = operative.map(o => `ports ${o.ranges.map(fmtRange).join(', ')} already ${o.action === 'allow' ? 'allowed' : 'denied'} by ${o.id}`).join('; ');
    if (actions.size === 1 && actions.has(r.action)) add('redundant', r.id, ids, `${r.id} never matches: fully covered by ${ids.join(', ')}`, `Every address, port and protocol this ${r.action} rule could match is already ${r.action === 'allow' ? 'allowed' : 'denied'} by earlier operative rule(s) ${ids.join(', ')} (${trace}).`);
    else if (actions.size === 1) add('conflict', r.id, ids, `${r.id} is dead: earlier ${ids.join(', ')} ${r.action === 'allow' ? 'denies' : 'allows'} the same traffic`, `This ${r.action} rule is fully shadowed by earlier operative rule(s) with the opposite action, so it has no effect (${trace}). Decide which intent is correct.`);
    else add('conflict', r.id, ids, `${r.id} is dead: earlier rules with mixed actions cover all of its traffic`, `This ${r.action} rule is fully shadowed by earlier operative rules with mixed actions (${trace}). Part of its intent is contradicted; review with the owners of ${ids.join(', ')}.`);
  }

  // Partial shadowing (union-based, see boxes.ts): raised for rules the containment pass did not flag when earlier rules
  // in covering zones already match at least `threshold` of the rule's address × port space, or all of it assembled from
  // several non-containing rules. Informational: the rule still fires for the uncovered remainder.
  const cov = opts.coverage ?? analyzeCoverage(rules, budget);
  const shadowed = new Set(findings.filter(f => f.kind === 'redundant' || f.kind === 'conflict').map(f => f.ruleId));
  const actionOf = new Map(rules.map(r => [r.id, r.action]));
  for (const { r } of enabled) {
    const c = cov[r.id];
    if (!c || !c.coveringRuleIds.length || shadowed.has(r.id)) continue;
    if (!((c.fraction >= threshold && c.fraction < 1) || c.fraction === 1)) continue;
    const ids = c.coveringRuleIds;
    const named = ids.map(id => `${id} (${actionOf.get(id) ?? 'unknown action'})`).join(', ');
    const approx = c.approximate ? ` The figure is approximate — a lower bound: the fragment budget (${budget.toLocaleString('en-US')} fragments) was reached, so later covering rules were not subtracted.` : '';
    if (c.fraction === 1) add('partially-shadowed', r.id, ids, `${r.id} is fully covered by the union of ${ids.join(', ')}`, `Earlier rules ${named} together already match 100% of the address × port space this ${r.action} rule covers, although no single one contains it, so the containment analysis did not flag it. Confirm with the owners before removing it: coverage is by address space only, and the covering rules' actions may differ from this rule's.${approx}`);
    else add('partially-shadowed', r.id, ids, `${r.id} is partially shadowed: ${formatCoverage(c.fraction)} already handled by ${ids.join(', ')}`, `Earlier rules ${named} already match ${formatCoverage(c.fraction)} of the address × port space this ${r.action} rule covers (union across address space, not containment). The remaining ${formatCoverage(1 - c.fraction)} still reaches this rule, so it is live but partly dead; review whether the overlap is intended.${approx}`);
  }

  for (const { r, p } of enabled) {
    if (r.action === 'allow') {
      const anySrc = addressCount(p.src) === 2 ** 32, anyDst = addressCount(p.dst) === 2 ** 32, anyPorts = p.ports.length === 1 && p.ports[0].lo === 0 && p.ports[0].hi === 65535;
      if ((anySrc && anyDst) || (anyPorts && (anySrc || anyDst)) || (anySrc && anyDst && anyPorts))
        add('overbroad', r.id, [], `${r.id} allows ${anySrc ? 'any source' : r.src} → ${anyDst ? 'any destination' : r.dst}${anyPorts ? ' on all ports' : ''}`, `Allow rules spanning any/any or any-port-to-any defeat segmentation. ${r.comment ? `Comment: "${r.comment}". ` : ''}Narrow to specific zones, hosts and services.`);
      const dstPrefixBroad = addressCount(p.dst) >= 2 ** (32 - broadDstMaxPrefix);
      if (vpnZones.includes(r.zoneFrom.toLowerCase()) && dstPrefixBroad && p.protos.has('tcp') && mgmt.some(mp => p.ports.some(iv => iv.lo <= mp && mp <= iv.hi)))
        add('vpn-management', r.id, [], `${r.id}: VPN zone can reach management ports on ${r.dst}`, `Remote-access clients (${r.src}) reach ${mgmt.filter(mp => p.ports.some(iv => iv.lo <= mp && mp <= iv.hi)).join('/')} on a destination of ${addressCount(p.dst).toLocaleString('en-US')} addresses. Restrict to a jump host or admin subnet.`);
    }
    if (r.expires && Date.parse(r.expires) < Date.parse(opts.now)) add('expired', r.id, [], `${r.id} expired ${daysBetween(r.expires, opts.now)} days ago`, `Expiry ${r.expires} has passed and the rule is still enabled. Owner: ${r.owner || 'unassigned'}.`);
    if (r.action === 'allow' && (!r.lastHit || daysBetween(r.lastHit, opts.now) > staleDays)) add('stale', r.id, [], `${r.id} has ${r.lastHit ? `no hits for ${daysBetween(r.lastHit, opts.now)} days` : 'never matched traffic'}`, `Stale window is ${staleDays} days. Confirm with owner ${r.owner || '(unassigned)'} before disabling.`);
  }
  const last = enabled[enabled.length - 1];
  const finalDeny = last && last.r.action === 'deny' && last.r.zoneFrom === 'any' && last.r.zoneTo === 'any' && addressCount(last.p.src) === 2 ** 32 && addressCount(last.p.dst) === 2 ** 32 && last.p.protos.size === 3 && last.p.ports.length === 1 && last.p.ports[0].lo === 0 && last.p.ports[0].hi === 65535;
  if (!finalDeny) add('no-final-deny', null, [], 'Policy has no explicit final deny-all', 'Add an explicit, logged deny any→any (all zones, protocols and ports) as the last rule so dropped traffic is visible.');
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  return findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.id.localeCompare(b.id));
}
