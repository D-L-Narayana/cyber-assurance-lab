/**
 * Holdfast Ledger core engine: retention due-dates, legal-hold precedence, idempotent disposal plans,
 * simulated execution with hash-chained receipts, chain verification and plan/receipt reconciliation.
 *
 * Simulation only. "Deleting" a record flips a status flag on an in-memory synthetic row; nothing external is touched.
 * Hashes use SHA-256 via Web Crypto (available in modern browsers and Node 20).
 */
import type {
  ChainVerification, DisposalAction, DueItem, Fixture, Hold, Plan, PlanItem, Receipt, Reconciliation, RecordRow, Schedule,
} from './types';
import { addDays, daysBetween, isIsoDate, toCsv } from './safe';

export const LIMITS = { systems: 50, schedules: 100, records: 5000, holds: 200, holdRecordIds: 500 };
export const GENESIS = '0'.repeat(64);

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ----------------------------- holds ----------------------------- */

function holdApplies(h: Hold, r: RecordRow): boolean {
  const s = h.scope;
  if (s.systemId && s.systemId !== r.systemId) return false;
  if (s.category && s.category !== r.category) return false;
  if (s.subjectRef && s.subjectRef !== r.subjectRef) return false;
  if (s.recordIds && !s.recordIds.includes(r.id)) return false;
  return !!(s.systemId || s.category || s.subjectRef || s.recordIds);
}

export function holdIsActive(h: Hold, asOf: string): boolean {
  return Date.parse(h.placedOn) <= Date.parse(asOf) && (h.releasedOn === null || Date.parse(h.releasedOn) > Date.parse(asOf));
}

export function activeHoldsFor(r: RecordRow, holds: Hold[], asOf: string): Hold[] {
  return holds.filter((h) => holdIsActive(h, asOf) && holdApplies(h, r));
}

/* ----------------------------- due dates ----------------------------- */

export function scheduleFor(r: RecordRow, schedules: Schedule[]): Schedule | null {
  return schedules.find((s) => s.category === r.category) ?? null;
}

export function computeDue(fixture: Fixture, asOf: string): DueItem[] {
  return fixture.records.map((r) => {
    const schedule = scheduleFor(r, fixture.schedules);
    const holds = activeHoldsFor(r, fixture.holds, asOf).map((h) => h.id);
    if (r.status !== 'active') return { recordId: r.id, scheduleId: schedule?.id ?? null, dueOn: null, state: 'disposed', daysOverdue: 0, holdIds: holds, action: null };
    if (!schedule) return { recordId: r.id, scheduleId: null, dueOn: null, state: 'unscheduled', daysOverdue: 0, holdIds: holds, action: null };
    const dueOn = addDays(r.triggerDate, schedule.retainDays);
    const over = daysBetween(dueOn, asOf); // positive when past due
    let state: DueItem['state'];
    if (over < 0) state = 'retained';
    else if (holds.length > 0) state = 'held';
    else if (over === 0) state = 'due';
    else state = 'overdue';
    return { recordId: r.id, scheduleId: schedule.id, dueOn, state, daysOverdue: Math.max(0, over), holdIds: holds, action: schedule.action };
  });
}

/* ----------------------------- planning ----------------------------- */

export async function planDisposal(fixture: Fixture, asOf: string): Promise<Plan> {
  const due = computeDue(fixture, asOf);
  const items: PlanItem[] = [];
  for (const d of due) {
    if (!['due', 'overdue', 'held'].includes(d.state)) continue;
    const r = fixture.records.find((x) => x.id === d.recordId)!;
    const action = d.action as DisposalAction;
    if (d.state === 'held') {
      items.push({ recordId: r.id, systemId: r.systemId, action, decision: 'skip', reason: `Blocked by active hold ${d.holdIds.join(', ')}; retention due ${d.dueOn}.` });
    } else {
      items.push({ recordId: r.id, systemId: r.systemId, action, decision: 'dispose', reason: d.state === 'due' ? `Retention period ends today (${d.dueOn}).` : `Retention ended ${d.dueOn}, ${d.daysOverdue} days ago.` });
    }
  }
  items.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const activeHoldIds = fixture.holds.filter((h) => holdIsActive(h, asOf)).map((h) => h.id).sort();
  const id = await sha256Hex(JSON.stringify({ asOf, items: items.map((i) => [i.recordId, i.action, i.decision]), holds: activeHoldIds }));
  return { id, asOf, items, counts: { dispose: items.filter((i) => i.decision === 'dispose').length, skip: items.filter((i) => i.decision === 'skip').length } };
}

/* ----------------------------- execution (simulated) ----------------------------- */

export async function recordHash(r: RecordRow): Promise<string> {
  return sha256Hex(`${r.id}|${r.systemId}|${r.category}|${r.subjectRef}|${r.triggerDate}`);
}

async function receiptHash(r: Omit<Receipt, 'hash'>): Promise<string> {
  return sha256Hex(`${r.seq}|${r.planId}|${r.recordId}|${r.systemId}|${r.action}|${r.executedOn}|${r.recordHash}|${r.prevHash}`);
}

export interface ExecutionResult { receipts: Receipt[]; records: RecordRow[]; skippedAlreadyExecuted: boolean; rejectedStale: boolean; reason: string | null }

/**
 * Simulate running a plan: flip record status and append chained receipts. Running the same plan twice is a no-op.
 * The plan is re-derived from the *current* fixture at execution time; if the id differs (a hold was placed or released,
 * a record changed) the plan is stale and nothing is executed. Holds therefore win at execution, not only at planning.
 */
export async function executePlan(plan: Plan, fixture: Fixture, existing: Receipt[]): Promise<ExecutionResult> {
  if (existing.some((r) => r.planId === plan.id)) return { receipts: existing, records: fixture.records, skippedAlreadyExecuted: true, rejectedStale: false, reason: 'Plan already executed.' };
  const current = await planDisposal(fixture, plan.asOf);
  if (current.id !== plan.id) {
    return { receipts: existing, records: fixture.records, skippedAlreadyExecuted: false, rejectedStale: true, reason: `Plan ${plan.id.slice(0, 12)}… is stale: holds or records changed since it was generated (current plan would be ${current.id.slice(0, 12)}…). Regenerate the plan; nothing was executed.` };
  }
  const receipts = [...existing];
  let prevHash = existing.length ? existing[existing.length - 1]!.hash : GENESIS;
  let seq = existing.length ? existing[existing.length - 1]!.seq : 0;
  const records = fixture.records.map((r) => ({ ...r }));
  for (const item of plan.items) {
    if (item.decision !== 'dispose') continue;
    const r = records.find((x) => x.id === item.recordId);
    if (!r || r.status !== 'active') continue;
    seq += 1;
    const partial: Omit<Receipt, 'hash'> = { seq, planId: plan.id, recordId: r.id, systemId: r.systemId, action: item.action, executedOn: plan.asOf, recordHash: await recordHash(r), prevHash };
    const hash = await receiptHash(partial);
    receipts.push({ ...partial, hash });
    prevHash = hash;
    r.status = item.action === 'delete' ? 'deleted' : 'anonymised';
  }
  return { receipts, records, skippedAlreadyExecuted: false, rejectedStale: false, reason: null };
}

export async function verifyChain(receipts: Receipt[]): Promise<ChainVerification> {
  let prev = GENESIS;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!;
    if (r.seq !== i + 1) return { ok: false, checked: i, brokenAt: r.seq, reason: `Sequence gap: expected seq ${i + 1}, found ${r.seq}.` };
    if (r.prevHash !== prev) return { ok: false, checked: i, brokenAt: r.seq, reason: `Receipt ${r.seq} does not link to the previous receipt.` };
    const { hash, ...rest } = r;
    const expected = await receiptHash(rest);
    if (expected !== hash) return { ok: false, checked: i, brokenAt: r.seq, reason: `Receipt ${r.seq} content does not match its hash (tampered).` };
    prev = hash;
  }
  return { ok: true, checked: receipts.length, brokenAt: null, reason: null };
}

export function reconcile(plan: Plan, receipts: Receipt[]): Reconciliation {
  const planned = new Set(plan.items.filter((i) => i.decision === 'dispose').map((i) => i.recordId));
  const mine = receipts.filter((r) => r.planId === plan.id);
  const got = new Set(mine.map((r) => r.recordId));
  const missing = [...planned].filter((id) => !got.has(id)).sort();
  const unexpected = [...got].filter((id) => !planned.has(id)).sort();
  return { planId: plan.id, ok: missing.length === 0 && unexpected.length === 0, missing, unexpected, skipped: plan.counts.skip };
}

/* ----------------------------- validation ----------------------------- */

export type FixtureValidation = { ok: true; fixture: Fixture } | { ok: false; errors: string[] };

export function validateFixture(input: unknown): FixtureValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Fixture must be a JSON object.'] };
  const f = input as Record<string, unknown>;
  if (f.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof f.label !== 'string') errors.push('label must be a string.');
  if (!isIsoDate(f.asOf)) errors.push('asOf must be a valid ISO date.');
  const isRow = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const rows = (name: keyof typeof LIMITS & keyof Fixture): Record<string, unknown>[] => {
    const v = f[name];
    if (!Array.isArray(v)) { errors.push(`${name} must be an array.`); return []; }
    if (v.length > LIMITS[name]) { errors.push(`${name} has ${v.length} rows; limit is ${LIMITS[name]}.`); return []; }
    const good: Record<string, unknown>[] = [];
    v.forEach((row, i) => { if (isRow(row)) good.push(row); else errors.push(`${name}[${i}] is not an object.`); });
    return good;
  };
  const systems = rows('systems'); const schedules = rows('schedules'); const records = rows('records'); const holds = rows('holds');
  const sysIds = new Set<string>();
  for (const s of systems) { if (!str(s.id)) { errors.push('system without id'); continue; } if (sysIds.has(s.id)) errors.push(`duplicate system ${s.id}`); sysIds.add(s.id); if (!str(s.name) || !str(s.steward)) errors.push(`system ${s.id}: name and steward required`); }
  const cats = new Set<string>();
  for (const s of schedules) {
    if (!str(s.id)) { errors.push('schedule without id'); continue; }
    if (!str(s.category)) errors.push(`schedule ${s.id}: category required`); else { if (cats.has(s.category)) errors.push(`schedule ${s.id}: category ${s.category} already has a schedule`); cats.add(s.category); }
    if (!['created', 'closed', 'terminated', 'last_contact'].includes(s.trigger as string)) errors.push(`schedule ${s.id}: bad trigger`);
    if (typeof s.retainDays !== 'number' || !Number.isInteger(s.retainDays) || s.retainDays < 0 || s.retainDays > 36500) errors.push(`schedule ${s.id}: retainDays must be an integer 0–36500`);
    if (!['delete', 'anonymise'].includes(s.action as string)) errors.push(`schedule ${s.id}: bad action`);
    if (!str(s.name) || !str(s.basis, 1000)) errors.push(`schedule ${s.id}: name and basis required`);
  }
  const recIds = new Set<string>();
  for (const r of records) {
    if (!str(r.id)) { errors.push('record without id'); continue; }
    if (recIds.has(r.id)) errors.push(`duplicate record ${r.id}`); recIds.add(r.id);
    if (!str(r.systemId) || !sysIds.has(r.systemId)) errors.push(`record ${r.id}: system ${String(r.systemId)} is missing`);
    if (!str(r.category) || !str(r.subjectRef)) errors.push(`record ${r.id}: category and subjectRef required`);
    if (!isIsoDate(r.triggerDate)) errors.push(`record ${r.id}: triggerDate must be ISO`);
    if (!['active', 'deleted', 'anonymised'].includes(r.status as string)) errors.push(`record ${r.id}: bad status`);
  }
  for (const h of holds) {
    if (!str(h.id)) { errors.push('hold without id'); continue; }
    if (!str(h.name) || !str(h.authority)) errors.push(`hold ${h.id}: name and authority required`);
    if (!isIsoDate(h.placedOn)) errors.push(`hold ${h.id}: placedOn must be ISO`);
    if (h.releasedOn !== null && !isIsoDate(h.releasedOn)) errors.push(`hold ${h.id}: releasedOn must be ISO or null`);
    if (!isRow(h.scope)) errors.push(`hold ${h.id}: scope must be an object`);
    else {
      const sc = h.scope;
      if (!(sc.systemId || sc.category || sc.subjectRef || sc.recordIds)) errors.push(`hold ${h.id}: scope must name a system, category, subject or record ids`);
      if (sc.recordIds !== undefined && (!Array.isArray(sc.recordIds) || sc.recordIds.length > LIMITS.holdRecordIds || !sc.recordIds.every((x) => typeof x === 'string'))) errors.push(`hold ${h.id}: recordIds must be up to ${LIMITS.holdRecordIds} strings`);
    }
  }
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  return errors.length ? { ok: false, errors } : { ok: true, fixture: f as unknown as Fixture };
}

/* ----------------------------- export ----------------------------- */

export interface AuditExport {
  schema: 'holdfast.audit/v1';
  label: string;
  asOf: string;
  summary: Record<DueItem['state'], number> & { receipts: number };
  plans: (Plan & { reconciliation: Reconciliation })[];
  receipts: Receipt[];
  chain: { ok: boolean; note: string };
  holds: Fixture['holds'];
  disclaimer: string;
}

export async function exportAudit(fixture: Fixture, plans: Plan[], receipts: Receipt[]): Promise<{ json: AuditExport; csv: string; csvRecords: string }> {
  const chain = await verifyChain(receipts);
  const due = computeDue(fixture, fixture.asOf);
  const summary = { retained: 0, due: 0, overdue: 0, held: 0, disposed: 0, unscheduled: 0, receipts: receipts.length } as AuditExport['summary'];
  for (const d of due) summary[d.state]++;
  const json: AuditExport = {
    schema: 'holdfast.audit/v1', label: fixture.label, asOf: fixture.asOf, summary,
    plans: plans.map((p) => ({ ...p, reconciliation: reconcile(p, receipts) })),
    receipts,
    chain: { ok: chain.ok, note: chain.reason ?? `${chain.checked} receipts verified at export time` },
    holds: fixture.holds,
    disclaimer: 'Simulated disposal of synthetic records. No system was modified. Not legal advice.',
  };
  const csv = toCsv(['seq', 'plan_id', 'record_id', 'system', 'action', 'executed_on', 'record_hash', 'prev_hash', 'receipt_hash'],
    receipts.map((r) => [r.seq, r.planId, r.recordId, r.systemId, r.action, r.executedOn, r.recordHash, r.prevHash, r.hash]));
  const csvRecords = toCsv(['record_id', 'system', 'category', 'subject_ref', 'trigger_date', 'status', 'due_on', 'state', 'days_overdue', 'holds'],
    fixture.records.map((r) => { const d = due.find((x) => x.recordId === r.id)!; return [r.id, r.systemId, r.category, r.subjectRef, r.triggerDate, r.status, d.dueOn ?? '', d.state, d.daysOverdue, d.holdIds.join('|')]; }));
  return { json, csv, csvRecords };
}
