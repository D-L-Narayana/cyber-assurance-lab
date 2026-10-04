/**
 * Holdfast Ledger core engine: retention due-dates, legal-hold precedence, idempotent disposal plans,
 * simulated execution with hash-chained receipts, chain verification and plan/receipt reconciliation.
 *
 * Simulation only. "Deleting" a record flips a status flag on an in-memory synthetic row; nothing external is touched.
 * Hashes use SHA-256 via Web Crypto (available in modern browsers and Node 20).
 */
import type {
  ChainVerification, DisposalAction, DueItem, Fixture, Hold, HoldAction, HoldEvent, Plan, PlanItem, Receipt, Reconciliation, RecordRow, Schedule,
} from './types';
import { addDays, daysBetween, isIsoDate, toCsv } from './safe';

export const LIMITS = { systems: 50, schedules: 100, records: 5000, holds: 200, holdRecordIds: 500, holdHistory: 2000 };
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

/* ----------------------------- guarded hold release / reinstatement ----------------------------- */

export interface HoldActionInput { holdId: string; on: string; actor: string; reason: string }
export type HoldActionResult = { ok: true; fixture: Fixture } | { ok: false; error: string };
export const HOLD_ACTOR_MAX = 120;
export const HOLD_REASON_MIN = 10;

type HoldActionChecked =
  | { ok: true; hold: Hold; on: string; actor: string; reason: string; history: HoldEvent[] }
  | { ok: false; error: string };

/** Shared guards: strict date, actor 1–120 chars, reason ≥ 10 chars, trail cap, known hold. Never throws. */
function checkHoldAction(fixture: Fixture, input: HoldActionInput): HoldActionChecked {
  const on = typeof input.on === 'string' ? input.on.trim() : '';
  if (!isIsoDate(on)) return { ok: false, error: `Effective date must be a real calendar date (YYYY-MM-DD); got "${String(input.on).slice(0, 30)}".` };
  const actor = typeof input.actor === 'string' ? input.actor.trim() : '';
  if (actor.length < 1 || actor.length > HOLD_ACTOR_MAX) return { ok: false, error: `Actor is required (1–${HOLD_ACTOR_MAX} characters, who is asking for this change).` };
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < HOLD_REASON_MIN) return { ok: false, error: `Reason must be at least ${HOLD_REASON_MIN} characters (got ${reason.length}); say why the hold changes.` };
  const history = fixture.holdHistory ?? [];
  if (history.length >= LIMITS.holdHistory) return { ok: false, error: `Hold history is full: the fixture limit is ${LIMITS.holdHistory} events. Export the audit bundle and start a new fixture.` };
  const hold = fixture.holds.find((h) => h.id === input.holdId);
  if (!hold) return { ok: false, error: `Unknown hold "${String(input.holdId).slice(0, 60)}".` };
  return { ok: true, hold, on, actor, reason, history };
}

function withHoldEvent(fixture: Fixture, c: Extract<HoldActionChecked, { ok: true }>, action: HoldAction, holds: Hold[]): Fixture {
  const event: HoldEvent = { seq: c.history.length + 1, holdId: c.hold.id, action, on: c.on, actor: c.actor, reason: c.reason };
  return { ...fixture, holds, holdHistory: [...c.history, event] };
}

/**
 * Release a hold as of `on`. Refuses unknown holds, holds that already carry a release date (reinstate first if the
 * date must change), and dates before the hold was placed. Returns a new fixture (input untouched) with
 * `releasedOn = on` and a `release` event appended to `holdHistory`.
 */
export function releaseHold(fixture: Fixture, input: HoldActionInput): HoldActionResult {
  const c = checkHoldAction(fixture, input);
  if (!c.ok) return c;
  if (c.hold.releasedOn !== null) return { ok: false, error: `Hold ${c.hold.id} is already released (on ${c.hold.releasedOn}); reinstate it first if the release date must change.` };
  if (Date.parse(c.on) < Date.parse(c.hold.placedOn)) return { ok: false, error: `Hold ${c.hold.id} cannot be released on ${c.on}, before it was placed (${c.hold.placedOn}).` };
  const holds = fixture.holds.map((h) => (h.id === c.hold.id ? { ...h, releasedOn: c.on } : h));
  return { ok: true, fixture: withHoldEvent(fixture, c, 'release', holds) };
}

/**
 * Reinstate a released hold as of `on`. Refuses holds that are not released and dates before the release date.
 * Clears `releasedOn` (the original `placedOn` is preserved; the trail records when the hold came back) and appends a
 * `reinstate` event. Reinstating on the release day itself is allowed.
 */
export function reinstateHold(fixture: Fixture, input: HoldActionInput): HoldActionResult {
  const c = checkHoldAction(fixture, input);
  if (!c.ok) return c;
  if (c.hold.releasedOn === null) return { ok: false, error: `Hold ${c.hold.id} is not released; there is nothing to reinstate.` };
  if (Date.parse(c.on) < Date.parse(c.hold.releasedOn)) return { ok: false, error: `Hold ${c.hold.id} cannot be reinstated on ${c.on}, before its release date (${c.hold.releasedOn}).` };
  const holds = fixture.holds.map((h) => (h.id === c.hold.id ? { ...h, releasedOn: null } : h));
  return { ok: true, fixture: withHoldEvent(fixture, c, 'reinstate', holds) };
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
  // holdHistory (October 2026, additive): absent in legacy fixtures; when present every event is checked and rebuilt
  // field by field so unknown keys are dropped. seq must run 1..n without gaps.
  let holdHistory: HoldEvent[] | undefined;
  if (f.holdHistory !== undefined) {
    const hh = f.holdHistory;
    if (!Array.isArray(hh)) errors.push('holdHistory must be an array when present.');
    else if (hh.length > LIMITS.holdHistory) errors.push(`holdHistory has ${hh.length} events; limit is ${LIMITS.holdHistory}.`);
    else {
      const holdIds = new Set(holds.map((h) => h.id).filter((x): x is string => typeof x === 'string'));
      const clean: HoldEvent[] = [];
      hh.forEach((e, i) => {
        const p = `holdHistory[${i}]`;
        if (!isRow(e)) { errors.push(`${p} is not an object.`); return; }
        if (e.seq !== i + 1) errors.push(`${p}: seq must be ${i + 1} (contiguous from 1).`);
        if (!str(e.holdId) || !holdIds.has(e.holdId)) errors.push(`${p}: hold ${String(e.holdId)} is unknown.`);
        if (e.action !== 'release' && e.action !== 'reinstate') errors.push(`${p}: action must be release or reinstate.`);
        if (!isIsoDate(e.on)) errors.push(`${p}: on must be a real calendar date.`);
        if (!str(e.actor, HOLD_ACTOR_MAX)) errors.push(`${p}: actor must be 1–${HOLD_ACTOR_MAX} characters.`);
        if (!str(e.reason, 1000)) errors.push(`${p}: reason must be a string of 1–1000 characters.`);
        clean.push({ seq: e.seq as number, holdId: e.holdId as string, action: e.action as HoldAction, on: e.on as string, actor: e.actor as string, reason: e.reason as string });
      });
      holdHistory = clean;
    }
  }
  if (errors.length > 25) errors.splice(25, errors.length - 25, `… ${errors.length - 25} more`);
  if (errors.length) return { ok: false, errors };
  const fixture = f as unknown as Fixture;
  return { ok: true, fixture: holdHistory ? { ...fixture, holdHistory } : fixture };
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
  /** Release/reinstatement trail (additive, October 2026); `[]` for fixtures that never changed a hold. */
  holdHistory: HoldEvent[];
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
    holdHistory: fixture.holdHistory ?? [],
    disclaimer: 'Simulated disposal of synthetic records. No system was modified. Not legal advice.',
  };
  const csv = toCsv(['seq', 'plan_id', 'record_id', 'system', 'action', 'executed_on', 'record_hash', 'prev_hash', 'receipt_hash'],
    receipts.map((r) => [r.seq, r.planId, r.recordId, r.systemId, r.action, r.executedOn, r.recordHash, r.prevHash, r.hash]));
  const csvRecords = toCsv(['record_id', 'system', 'category', 'subject_ref', 'trigger_date', 'status', 'due_on', 'state', 'days_overdue', 'holds'],
    fixture.records.map((r) => { const d = due.find((x) => x.recordId === r.id)!; return [r.id, r.systemId, r.category, r.subjectRef, r.triggerDate, r.status, d.dueOn ?? '', d.state, d.daysOverdue, d.holdIds.join('|')]; }));
  return { json, csv, csvRecords };
}
