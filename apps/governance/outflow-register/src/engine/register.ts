/**
 * Outflow Register core engine: data-sharing agreement register with issue detection
 * (owners, expiry, flow coverage, obligations, contradictions), explained renewal priority,
 * a guarded agreement state machine with history, evidence packets and exports.
 * Pure functions over synthetic data. Not legal advice.
 */
import type {
  Agreement, AgreementStatus, Flow, HistoryEntry, Issue, IssueKind, ObligationKind, Register, RenewalPriority, PriorityBreakdown,
} from './types';
import { daysBetween, isIsoDate, toCsv } from './safe';

export const LIMITS = { systems: 100, vendors: 200, owners: 500, agreements: 500, flows: 2000, obligations: 50, categories: 50, history: 5000 };
export const STALE_FLOW_DAYS = 365;
export const OBLIGATION_KINDS: ObligationKind[] = ['encryption', 'subprocessor_notice', 'deletion_on_termination', 'breach_notification', 'audit_right', 'access_review'];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const SEVERITY: Record<IssueKind, Issue['severity']> = {
  flow_category_not_covered: 'high', flow_without_agreement: 'high', flow_after_end: 'high', flow_under_draft: 'high', expired_but_active: 'high', deletion_obligation_unmet: 'high',
  contradictory_breach_window: 'medium', missing_owner: 'medium', obligation_no_evidence: 'medium', vendor_mismatch: 'medium', renewal_window_open: 'low', stale_flow: 'low',
};

/** Status as of a date: an 'active'/'renewing' agreement whose end date has passed is effectively expired. */
export function effectiveStatus(a: Agreement, asOf: string): AgreementStatus {
  if ((a.status === 'active' || a.status === 'renewing') && Date.parse(a.endOn) < Date.parse(asOf)) return 'expired';
  return a.status;
}

const ownerOk = (r: Register, a: Agreement) => !!a.ownerId && r.owners.some((o) => o.id === a.ownerId && o.status === 'active');

function parseHours(req: string): number | null {
  const m = /^(\d+)\s*h/i.exec(req.trim());
  return m ? Number(m[1]) : null;
}

export function findIssues(r: Register, asOf: string): Issue[] {
  const issues: Issue[] = [];
  const push = (kind: IssueKind, vendorId: string, detail: string, agreementId: string | null = null, flowId: string | null = null, suffix = '') =>
    issues.push({ id: `${kind}:${agreementId ?? '-'}:${flowId ?? '-'}${suffix ? ':' + suffix : ''}`, kind, severity: SEVERITY[kind], agreementId, flowId, vendorId, detail });
  const vendorName = (id: string) => r.vendors.find((v) => v.id === id)?.name ?? id;

  for (const a of r.agreements) {
    const st = effectiveStatus(a, asOf);
    if (!ownerOk(r, a) && st !== 'terminated' && st !== 'expired') {
      const o = r.owners.find((x) => x.id === a.ownerId);
      push('missing_owner', a.vendorId, a.ownerId ? `Owner ${o?.name ?? a.ownerId} has left; nobody is accountable for "${a.title}".` : `"${a.title}" has no named owner.`, a.id);
    }
    if (a.status === 'active' && st === 'expired') push('expired_but_active', a.vendorId, `"${a.title}" ended ${a.endOn} but is still recorded as active.`, a.id);
    if (st === 'active') {
      const d = daysBetween(asOf, a.endOn);
      if (d >= 0 && d <= a.noticeDays) push('renewal_window_open', a.vendorId, `"${a.title}" ends in ${d} days; the ${a.noticeDays}-day notice window is open.`, a.id);
      for (const ob of a.obligations) if (!ob.evidence) push('obligation_no_evidence', a.vendorId, `${ob.kind.replace(/_/g, ' ')} (${ob.requirement}) has no evidence on file for "${a.title}".`, a.id, null, ob.id);
    }
    if (st === 'expired' || st === 'terminated') {
      for (const ob of a.obligations) if (ob.kind === 'deletion_on_termination' && !ob.evidence) push('deletion_obligation_unmet', a.vendorId, `"${a.title}" has ended but deletion (${ob.requirement}) is not evidenced.`, a.id, null, ob.id);
    }
  }
  for (const f of r.flows) {
    const a = f.agreementId ? r.agreements.find((x) => x.id === f.agreementId) ?? null : null;
    if (f.agreementId && a && a.vendorId !== f.vendorId) push('vendor_mismatch', f.vendorId, `Flow ${f.id} names vendor ${vendorName(f.vendorId)} but its agreement "${a.title}" is with ${vendorName(a.vendorId)}.`, a.id, f.id);
    if (!f.active) continue;
    if (!a) { push('flow_without_agreement', f.vendorId, `Active flow ${f.id} to ${vendorName(f.vendorId)} (${f.categories.join(', ')}) has no agreement.`, null, f.id); }
    else {
      const uncovered = f.categories.filter((c) => !a.categories.includes(c));
      if (uncovered.length) push('flow_category_not_covered', f.vendorId, `Flow ${f.id} shares ${uncovered.join(', ')} but "${a.title}" only covers ${a.categories.join(', ') || 'nothing'}.`, a.id, f.id);
      const st = effectiveStatus(a, asOf);
      if (st === 'expired' || st === 'terminated') push('flow_after_end', f.vendorId, `Flow ${f.id} is still active although "${a.title}" is ${st} (${a.endOn}).`, a.id, f.id);
      if (st === 'draft') push('flow_under_draft', f.vendorId, `Flow ${f.id} is active but "${a.title}" is still a draft (unsigned); data is moving without an executed agreement.`, a.id, f.id);
    }
    if (f.lastTransferOn && daysBetween(f.lastTransferOn, asOf) > STALE_FLOW_DAYS) push('stale_flow', f.vendorId, `Flow ${f.id} is marked active but last transferred ${f.lastTransferOn}.`, a?.id ?? null, f.id);
  }
  // contradictions: same vendor, two live agreements with different breach-notification hours
  for (const v of r.vendors) {
    const live = r.agreements.filter((a) => a.vendorId === v.id && effectiveStatus(a, asOf) === 'active');
    const windows = live.flatMap((a) => a.obligations.filter((o) => o.kind === 'breach_notification').map((o) => ({ a, h: parseHours(o.requirement), raw: o.requirement }))).filter((w) => w.h !== null);
    const distinct = new Set(windows.map((w) => w.h));
    if (distinct.size > 1) {
      const first = windows[0]!;
      push('contradictory_breach_window', v.id, `${v.name} has conflicting breach-notification windows: ${windows.map((w) => `${w.raw} in "${w.a.title}"`).join(' vs ')}.`, first.a.id);
    }
  }
  issues.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || x.id.localeCompare(y.id));
  return issues;
}

export function renewalPriority(r: Register, a: Agreement, asOf: string): RenewalPriority {
  const b: PriorityBreakdown[] = [];
  const st = effectiveStatus(a, asOf);
  const d = daysBetween(asOf, a.endOn);
  const expiryPts = st === 'expired' ? 40 : d <= 30 ? 35 : d <= 90 ? 25 : d <= 180 ? 15 : d <= 365 ? 8 : 2;
  b.push({ factor: 'expiry', points: expiryPts, note: st === 'expired' ? `ended ${a.endOn}` : `${d} days to ${a.endOn}` });
  const restricted = a.categories.filter((c) => r.restrictedCategories.includes(c));
  b.push({ factor: 'restricted categories', points: Math.min(20, restricted.length * 10), note: restricted.length ? restricted.join(', ') : 'none' });
  const flows = r.flows.filter((f) => f.agreementId === a.id && f.active);
  b.push({ factor: 'active flows', points: Math.min(20, flows.length * 5), note: `${flows.length} active flow${flows.length === 1 ? '' : 's'}` });
  const open = a.obligations.filter((o) => !o.evidence).length;
  b.push({ factor: 'open obligations', points: Math.min(15, open * 5), note: `${open} without evidence` });
  b.push({ factor: 'owner', points: ownerOk(r, a) ? 0 : 10, note: ownerOk(r, a) ? 'accountable owner in place' : 'no active owner' });
  return { agreementId: a.id, score: b.reduce((n, x) => n + x.points, 0), breakdown: b, daysToEnd: st === 'expired' ? null : d };
}

export function renewalQueue(r: Register, asOf: string): RenewalPriority[] {
  return r.agreements.filter((a) => !['draft', 'terminated'].includes(a.status)).map((a) => renewalPriority(r, a, asOf))
    .sort((x, y) => y.score - x.score || x.agreementId.localeCompare(y.agreementId));
}

export interface TransitionInput { agreementId: string; to: AgreementStatus; reason: string; acknowledgeActiveFlows?: boolean; newEndOn?: string; on?: string }
export type TransitionResult = { ok: true; register: Register } | { ok: false; error: string };

const ALLOWED: Record<AgreementStatus, AgreementStatus[]> = {
  draft: ['active', 'terminated'], active: ['renewing', 'terminated', 'expired'], renewing: ['active', 'terminated', 'expired'], expired: ['renewing', 'terminated'], terminated: [],
};

export function transition(r: Register, input: TransitionInput): TransitionResult {
  const a = r.agreements.find((x) => x.id === input.agreementId);
  if (!a) return { ok: false, error: `Unknown agreement ${input.agreementId}.` };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'A reason is required for every status change.' };
  const from = a.status;
  if (!ALLOWED[from].includes(input.to)) return { ok: false, error: `Cannot move "${a.title}" from ${from} to ${input.to}.` };
  const on = input.on ?? r.asOf;
  let next: Agreement = { ...a, status: input.to };
  let note: string | undefined;
  if (input.to === 'active') {
    if (!ownerOk(r, a)) return { ok: false, error: 'An active owner is required before activation.' };
    if (a.categories.length === 0) return { ok: false, error: 'List at least one permitted data category before activation.' };
    if (from === 'renewing') {
      if (!input.newEndOn || !isIsoDate(input.newEndOn)) return { ok: false, error: 'Provide the new end date (YYYY-MM-DD) to complete renewal.' };
      if (Date.parse(input.newEndOn) <= Date.parse(a.endOn)) return { ok: false, error: `New end date must be after the current end date ${a.endOn}.` };
      if (Date.parse(input.newEndOn) <= Date.parse(on)) return { ok: false, error: `New end date must be after the as-of date ${on}; a renewal cannot end in the past.` };
      next = { ...next, endOn: input.newEndOn };
      note = `renewed to ${input.newEndOn}`;
    } else if (Date.parse(a.endOn) <= Date.parse(a.startOn)) return { ok: false, error: 'End date must be after start date.' };
  }
  if (input.to === 'terminated' || input.to === 'expired') {
    const live = r.flows.filter((f) => f.agreementId === a.id && f.active);
    if (live.length && !input.acknowledgeActiveFlows) return { ok: false, error: `${live.length} active flow${live.length === 1 ? '' : 's'} still reference this agreement (${live.map((f) => f.id).join(', ')}). Acknowledge that they must be stopped or re-papered.` };
    if (live.length) note = `acknowledged ${live.length} active flow(s): ${live.map((f) => f.id).join(', ')}`;
  }
  const entry: HistoryEntry = { seq: r.history.length + 1, agreementId: a.id, from, to: input.to, on, reason, ...(note ? { note } : {}) };
  return { ok: true, register: { ...r, agreements: r.agreements.map((x) => x.id === a.id ? next : x), history: [...r.history, entry] } };
}

export interface Packet {
  schema: 'outflow.packet/v1';
  asOf: string;
  agreement: Agreement & { effectiveStatus: AgreementStatus };
  vendor: Register['vendors'][number];
  owner: Register['owners'][number] | null;
  flows: (Flow & { systemName: string; uncovered: string[] })[];
  obligations: { id: string; kind: string; requirement: string; status: 'evidenced' | 'no evidence'; evidence: { ref: string; on: string } | null }[];
  issues: Issue[];
  priority: RenewalPriority;
  history: HistoryEntry[];
  disclaimer: string;
}

export function evidencePacket(r: Register, agreementId: string, asOf: string): { json: Packet; markdown: string } {
  const a = r.agreements.find((x) => x.id === agreementId);
  if (!a) throw new Error(`Unknown agreement ${agreementId}`);
  const vendor = r.vendors.find((v) => v.id === a.vendorId)!;
  const owner = r.owners.find((o) => o.id === a.ownerId) ?? null;
  const flows = r.flows.filter((f) => f.agreementId === a.id).map((f) => ({ ...f, systemName: r.systems.find((s) => s.id === f.systemId)?.name ?? f.systemId, uncovered: f.categories.filter((c) => !a.categories.includes(c)) }));
  const obligations = a.obligations.map((o) => ({ id: o.id, kind: o.kind.replace(/_/g, ' '), requirement: o.requirement, status: o.evidence ? 'evidenced' as const : 'no evidence' as const, evidence: o.evidence }));
  const issues = findIssues(r, asOf).filter((i) => i.agreementId === a.id || flows.some((f) => f.id === i.flowId));
  const priority = renewalPriority(r, a, asOf);
  const json: Packet = { schema: 'outflow.packet/v1', asOf, agreement: { ...a, effectiveStatus: effectiveStatus(a, asOf) }, vendor, owner, flows, obligations, issues, priority, history: r.history.filter((h) => h.agreementId === a.id), disclaimer: 'Synthetic agreement register; educational prototype; not legal advice.' };
  const md = [
    `# Evidence packet — ${a.title}`, '', `As of ${asOf}. ${json.disclaimer}`, '',
    `**Vendor:** ${vendor.name} (${vendor.country}, ${vendor.role})  `, `**Owner:** ${owner ? `${owner.name} (${owner.status})` : 'none'}  `, `**Status:** ${a.status} (effective ${json.agreement.effectiveStatus}) · ${a.startOn} → ${a.endOn} · notice ${a.noticeDays} days  `,
    `**Purpose:** ${a.purpose}  `, `**Permitted categories:** ${a.categories.join(', ') || 'none'}  `, `**Transfer mechanism (label):** ${a.transferMechanism}`, '',
    `## Flows (${flows.length})`, ...flows.map((f) => `- ${f.id}: ${f.systemName} → ${vendor.name}, ${f.direction}, ${f.categories.join(', ')}${f.uncovered.length ? ` — NOT COVERED: ${f.uncovered.join(', ')}` : ''}, ${f.active ? 'active' : 'inactive'}, last ${f.lastTransferOn ?? 'never'}`), '',
    `## Obligations (${obligations.length})`, ...obligations.map((o) => `- ${o.kind}: ${o.requirement} — ${o.status}${o.evidence ? ` (${o.evidence.ref}, ${o.evidence.on})` : ''}`), '',
    `## Issues (${issues.length})`, ...issues.map((i) => `- [${i.severity}] ${i.kind}: ${i.detail}`), '',
    `## Renewal priority: ${priority.score}`, ...priority.breakdown.map((b) => `- ${b.factor}: ${b.points} (${b.note})`), '',
    `## History (${json.history.length})`, ...json.history.map((h) => `- #${h.seq} ${h.on}: ${h.from} → ${h.to} — ${h.reason}${h.note ? ` (${h.note})` : ''}`), '',
  ].join('\n');
  return { json, markdown: md };
}

export type RegisterValidation = { ok: true; register: Register } | { ok: false; errors: string[] };

export function validateRegister(input: unknown): RegisterValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Register must be a JSON object.'] };
  const r = input as Record<string, unknown>;
  if (r.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof r.label !== 'string') errors.push('label must be a string.');
  if (!isIsoDate(r.asOf)) errors.push('asOf must be a valid ISO date.');
  const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const strList = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => str(x, 60));
  const rows = (name: keyof typeof LIMITS): Record<string, unknown>[] => {
    const v = r[name];
    if (!Array.isArray(v)) { errors.push(`${name} must be an array.`); return []; }
    if (v.length > LIMITS[name]) { errors.push(`${name} has ${v.length} rows; limit is ${LIMITS[name]}.`); return []; }
    const good: Record<string, unknown>[] = [];
    v.forEach((row, i) => { if (isRow(row)) good.push(row); else errors.push(`${name}[${i}] is not an object.`); });
    return good;
  };
  if (!strList(r.restrictedCategories, LIMITS.categories)) errors.push('restrictedCategories must be a list of short strings.');
  const systems = rows('systems'), vendors = rows('vendors'), owners = rows('owners'), agreements = rows('agreements'), flows = rows('flows'), history = rows('history');
  const ids = (list: Record<string, unknown>[], name: string) => { const s = new Set<string>(); for (const x of list) { if (!str(x.id)) errors.push(`${name} row without id`); else if (s.has(x.id)) errors.push(`duplicate ${name} id ${x.id}`); else s.add(x.id); } return s; };
  const sys = ids(systems, 'system'), ven = ids(vendors, 'vendor'), own = ids(owners, 'owner'), agr = ids(agreements, 'agreement'); ids(flows, 'flow');
  for (const v of vendors) if (!str(v.name) || !str(v.country, 3) || !['processor', 'controller', 'joint'].includes(v.role as string)) errors.push(`vendor ${String(v.id)}: name, country and role required`);
  for (const o of owners) if (!str(o.name) || !['active', 'left'].includes(o.status as string)) errors.push(`owner ${String(o.id)}: name and status required`);
  for (const a of agreements) {
    if (!str(a.id)) continue;
    if (!str(a.title)) errors.push(`agreement ${a.id}: title required`);
    if (!str(a.vendorId) || !ven.has(a.vendorId)) errors.push(`agreement ${a.id}: vendor ${String(a.vendorId)} is missing`);
    if (a.ownerId !== null && (!str(a.ownerId) || !own.has(a.ownerId))) errors.push(`agreement ${a.id}: owner ${String(a.ownerId)} is missing`);
    if (!['draft', 'active', 'renewing', 'expired', 'terminated'].includes(a.status as string)) errors.push(`agreement ${a.id}: bad status`);
    if (!isIsoDate(a.startOn) || !isIsoDate(a.endOn)) errors.push(`agreement ${a.id}: startOn/endOn must be valid ISO dates`);
    if (typeof a.noticeDays !== 'number' || !Number.isInteger(a.noticeDays) || a.noticeDays < 0 || a.noticeDays > 3650) errors.push(`agreement ${a.id}: noticeDays must be an integer 0–3650`);
    if (!strList(a.categories, LIMITS.categories)) errors.push(`agreement ${a.id}: categories must be a list of short strings`);
    if (!str(a.purpose, 500) || !str(a.transferMechanism, 200)) errors.push(`agreement ${a.id}: purpose and transferMechanism required`);
    if (!Array.isArray(a.obligations) || a.obligations.length > LIMITS.obligations) errors.push(`agreement ${a.id}: obligations must be an array (max ${LIMITS.obligations})`);
    else a.obligations.forEach((o, i) => { if (!isRow(o) || !str(o.id) || !OBLIGATION_KINDS.includes(o.kind as ObligationKind) || !str(o.requirement) || (o.evidence !== null && (!isRow(o.evidence) || !str(o.evidence.ref) || !isIsoDate(o.evidence.on)))) errors.push(`agreement ${a.id}: obligation[${i}] malformed (kind must be one of ${OBLIGATION_KINDS.join(', ')})`); });
  }
  for (const f of flows) {
    if (!str(f.id)) continue;
    if (!str(f.systemId) || !sys.has(f.systemId)) errors.push(`flow ${f.id}: system ${String(f.systemId)} is missing`);
    if (!str(f.vendorId) || !ven.has(f.vendorId)) errors.push(`flow ${f.id}: vendor ${String(f.vendorId)} is missing`);
    if (f.agreementId !== null && (!str(f.agreementId) || !agr.has(f.agreementId))) errors.push(`flow ${f.id}: agreement ${String(f.agreementId)} is missing`);
    if (!strList(f.categories, LIMITS.categories)) errors.push(`flow ${f.id}: categories must be a list`);
    if (!['outbound', 'inbound', 'bidirectional'].includes(f.direction as string)) errors.push(`flow ${f.id}: bad direction`);
    if (typeof f.active !== 'boolean') errors.push(`flow ${f.id}: active must be boolean`);
    if (f.lastTransferOn !== null && !isIsoDate(f.lastTransferOn)) errors.push(`flow ${f.id}: lastTransferOn must be ISO or null`);
  }
  for (const h of history) if (!str(h.agreementId) || !str(h.from) || !str(h.to) || !isIsoDate(h.on) || typeof h.reason !== 'string') errors.push('history entry malformed');
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  return errors.length ? { ok: false, errors } : { ok: true, register: r as unknown as Register };
}

export interface RegisterExport {
  schema: 'outflow.register/v1';
  label: string; asOf: string;
  summary: { agreements: number; vendors: number; activeFlows: number; issues: Record<Issue['severity'], number> };
  queue: RenewalPriority[];
  issues: Issue[];
  history: HistoryEntry[];
  disclaimer: string;
}

export function exportIssues(r: Register, asOf: string): { json: RegisterExport; csv: string } {
  const issues = findIssues(r, asOf);
  const vendorName = (id: string) => r.vendors.find((v) => v.id === id)?.name ?? id;
  const json: RegisterExport = {
    schema: 'outflow.register/v1', label: r.label, asOf,
    summary: { agreements: r.agreements.length, vendors: r.vendors.length, activeFlows: r.flows.filter((f) => f.active).length, issues: { high: issues.filter((i) => i.severity === 'high').length, medium: issues.filter((i) => i.severity === 'medium').length, low: issues.filter((i) => i.severity === 'low').length } },
    queue: renewalQueue(r, asOf), issues, history: r.history, disclaimer: 'Synthetic register; educational prototype; not legal advice.',
  };
  const csv = toCsv(['severity', 'kind', 'vendor', 'agreement', 'flow', 'detail'], issues.map((i) => [i.severity, i.kind, vendorName(i.vendorId), i.agreementId ?? '', i.flowId ?? '', i.detail]));
  return { json, csv };
}
