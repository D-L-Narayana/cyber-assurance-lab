import type { Rule } from './rules';
import { parseCidr, contains, addressCount } from './net';
import type { Finding } from './analyze';

export type Op = 'disable' | 'narrow' | 'review' | 'add-rule' | 'add-expiry';
export interface Proposal { id: string; ruleId: string | null; findingId: string; op: Op; rationale: string; after: Partial<Rule> | null; newRule?: Rule; approved: boolean; manualReview: boolean }
export interface ProposalOptions { now: string; jumpHost?: string; staleGraceDays?: number }

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Deterministic proposal per finding kind. Anything that would require inventing an address scope is a MANUAL REVIEW
 * (op 'review', manualReview true, no automatic change) so the re-analysis preview never implies a finding is resolved
 * when the engine could not safely resolve it.
 */
export function proposeChange(rules: Rule[], f: Finding, opts: ProposalOptions): Proposal {
  const rule = rules.find(r => r.id === f.ruleId) ?? null;
  const base = { id: `prop:${f.id}`, ruleId: f.ruleId, findingId: f.id, approved: false, manualReview: false };
  const review = (rationale: string): Proposal => ({ ...base, op: 'review', rationale, after: null, manualReview: true });
  switch (f.kind) {
    case 'expired': return { ...base, op: 'disable', rationale: `Disable expired rule ${rule?.id}; owner ${rule?.owner || 'unassigned'} may request renewal with a new expiry.`, after: { enabled: false, comment: `${rule?.comment ?? ''} [disabled: expired ${rule?.expires}]`.trim() } };
    case 'redundant': return { ...base, op: 'disable', rationale: `Disable ${rule?.id}; traffic remains handled by ${f.relatedRuleIds.join(', ')}. Confirm no earlier non-containing deny was relied upon (the engine only checks containing rules).`, after: { enabled: false, comment: `${rule?.comment ?? ''} [disabled: shadowed by ${f.relatedRuleIds.join(',')}]`.trim() } };
    case 'stale': {
      const expires = addDays(opts.now, opts.staleGraceDays ?? 30);
      return { ...base, op: 'add-expiry', rationale: `Give ${rule?.id} an expiry of ${expires} (${opts.staleGraceDays ?? 30} days after the review date ${opts.now}) so it is removed unless the owner confirms it is needed. The stale finding itself stays until traffic or the owner confirms.`, after: { expires, comment: `${rule?.comment ?? ''} [expiry ${expires} added pending owner confirmation]`.trim() } };
    }
    case 'vpn-management': {
      const jh = opts.jumpHost?.trim();
      const jhIv = jh ? parseCidr(jh) : null;
      const origIv = rule ? parseCidr(rule.dst) : null;
      if (!jh || !jhIv || !origIv) return review(`Manual review required: ${rule?.id} lets VPN clients reach management ports on ${rule?.dst}. Supply the admin jump host or admin subnet (IPv4 CIDR) to generate a narrowing proposal; the engine does not invent destination scopes.`);
      // The supplied destination must be a STRICT subset of the current one: contained, and smaller. Anything equal,
      // broader or outside would widen or move the rule's reach and is refused rather than proposed.
      const contained = contains(origIv, jhIv);
      const strict = contained && addressCount(jhIv) < addressCount(origIv);
      if (!strict) return review(`Manual review required: the supplied destination ${jh} is not a strict subset of ${rule?.id}'s current destination ${rule?.dst} (${!contained ? 'it lies outside or is broader' : 'it is equivalent'}), so applying it would not narrow the rule. Supply a jump host or admin subnet inside ${rule?.dst}.`);
      return { ...base, op: 'narrow', rationale: `Restrict ${rule?.id} to the supplied admin jump host ${jh} (${addressCount(jhIv).toLocaleString('en-US')} of ${addressCount(origIv).toLocaleString('en-US')} addresses) instead of ${rule?.dst}.`, after: { dst: jh, comment: `${rule?.comment ?? ''} [narrowed: VPN admin access via ${jh}]`.trim() } };
    }
    case 'overbroad': return review(`Manual review required: ${rule?.id} allows ${rule?.src} → ${rule?.dst} on ${rule?.ports === 'any' ? 'all ports' : `ports ${rule?.ports}`}. Replace it with rules scoped to named source and destination zones/hosts and the services they actually use; the engine cannot derive those scopes from the rule table. Disabling a troubleshooting rule may also be appropriate after confirming with ${rule?.owner || 'the (unassigned) owner'}.`);
    case 'conflict': return review(`Review ${rule?.id} vs ${f.relatedRuleIds.join(', ')} with both owners; no automatic change.`);
    case 'no-final-deny': {
      const maxSeq = rules.reduce((m, r) => Math.max(m, r.seq), 0);
      return { ...base, op: 'add-rule', rationale: 'Append an explicit logged deny-all (all zones, protocols and ports).', after: null, newRule: { id: 'DENY-ALL', seq: maxSeq + 1, action: 'deny', src: 'any', dst: 'any', proto: 'any', ports: 'any', zoneFrom: 'any', zoneTo: 'any', enabled: true, owner: 'netsec', expires: '', lastHit: '', comment: 'Explicit final deny with logging' } };
    }
  }
}

export function applyProposals(rules: Rule[], proposals: Proposal[]): Rule[] {
  let out = rules.map(r => ({ ...r }));
  for (const p of proposals) {
    if (!p.approved) continue;
    if (p.op === 'add-rule' && p.newRule) { if (!out.some(r => r.id === p.newRule!.id)) out.push({ ...p.newRule }); continue; }
    if (!p.after || !p.ruleId) continue;
    out = out.map(r => r.id === p.ruleId ? { ...r, ...p.after } : r);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export interface Change { ruleId: string; kind: 'modified' | 'added' | 'removed'; fields: (keyof Rule)[]; before: Rule | null; after: Rule | null }
export function diffRuleSets(before: Rule[], after: Rule[]): Change[] {
  const bm = new Map(before.map(r => [r.id, r])); const am = new Map(after.map(r => [r.id, r]));
  const out: Change[] = [];
  for (const [id, a] of am) {
    const b = bm.get(id);
    if (!b) { out.push({ ruleId: id, kind: 'added', fields: [], before: null, after: a }); continue; }
    const fields = (Object.keys(a) as (keyof Rule)[]).filter(k => a[k] !== b[k]);
    if (fields.length) out.push({ ruleId: id, kind: 'modified', fields, before: b, after: a });
  }
  for (const [id, b] of bm) if (!am.has(id)) out.push({ ruleId: id, kind: 'removed', fields: [], before: b, after: null });
  return out;
}
