// Graceline lifecycle engine: guarded state machine, time-driven transitions, derivation and prioritisation. Pure.
import { POLICY } from './policy';
import type { Board, Derived, Event, Exception, HistoryEntry, Role, State } from './types';

const DAY = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY);
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

export class GuardrailError extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'GuardrailError';
    this.reasons = reasons;
  }
}

export function newException(p: Omit<Exception, 'renewals' | 'state' | 'approvals' | 'history'> & Partial<Pick<Exception, 'renewals' | 'state' | 'approvals' | 'history'>>): Exception {
  return { renewals: 0, state: 'draft', approvals: [], history: [], ...p };
}

/** Policy checks that apply to the record's content regardless of state. */
export function contentGuardrails(e: Exception): string[] {
  const out: string[] = [];
  const max = POLICY.maxDurationDays[e.riskLevel];
  const duration = daysBetween(e.startOn, e.expiresOn);
  if (duration <= 0) out.push(`Expiry (${e.expiresOn}) must be after the start date (${e.startOn}).`);
  else if (duration > max) out.push(`Duration ${duration} days exceeds the ${max} days allowed for ${e.riskLevel} risk.`);
  if (POLICY.requireCompensating.includes(e.riskLevel) && e.compensatingControls.filter((c) => c.trim()).length === 0) out.push(`${e.riskLevel[0].toUpperCase()}${e.riskLevel.slice(1)} risk requires at least one compensating control.`);
  if (e.justification.trim().length < POLICY.minJustification) out.push(`Justification must be at least ${POLICY.minJustification} characters.`);
  if (!e.owner.trim()) out.push('An accountable risk owner is required.');
  if (!e.remediation.plan.trim()) out.push('A remediation plan is required.');
  else if (e.remediation.dueOn > e.expiresOn) out.push(`Remediation due date (${e.remediation.dueOn}) must be on or before the expiry (${e.expiresOn}).`);
  return out;
}

export function quorumFor(e: Exception): Derived['quorum'] {
  const rule = POLICY.quorum[e.riskLevel];
  const roles = new Set(e.approvals.map((a) => a.role));
  const missingRoles = rule.requiredRoles.filter((r) => !roles.has(r));
  return { required: rule.description, have: e.approvals.length, need: rule.count, met: e.approvals.length >= rule.count && missingRoles.length === 0, missingRoles };
}

function entry(e: Exception, event: string, actor: string, to: State, at: string, note = ''): HistoryEntry {
  return { at, event, actor: actor.trim(), from: e.state, to, note: note.trim() };
}

function expect(cond: boolean, reasons: string[], msg: string) {
  if (!cond) reasons.push(msg);
}

const ALLOWED: Record<Event['type'], State[]> = {
  submit: ['draft'],
  'start-review': ['submitted'],
  approve: ['under-review'], // plus live records with a pending renewal, see applyEvent
  reject: ['under-review'],
  withdraw: ['draft', 'submitted', 'under-review'],
  renew: ['active', 'expired'],
  'update-remediation': ['active', 'expired', 'escalated'],
  close: ['active', 'expired', 'escalated'],
};

export function applyEvent(e: Exception, ev: Event, at: string): Exception {
  const reasons: string[] = [];
  const renewalDecision = (ev.type === 'approve' || ev.type === 'reject') && !!e.pendingRenewal && (e.state === 'active' || e.state === 'expired' || e.state === 'escalated');
  if (!ALLOWED[ev.type].includes(e.state) && !renewalDecision) {
    throw new GuardrailError([`Cannot ${ev.type} an exception that is ${e.state}${(ev.type === 'approve' || ev.type === 'reject') && !e.pendingRenewal ? ' with no renewal pending' : ''}.`]);
  }
  const actor = ev.actor.trim();
  expect(actor.length > 0, reasons, 'An actor is required.');

  switch (ev.type) {
    case 'submit': {
      expect(actor === e.requester, reasons, `Only the requester (${e.requester}) can submit.`);
      reasons.push(...contentGuardrails(e));
      if (reasons.length) throw new GuardrailError(reasons);
      return { ...e, state: 'submitted', history: [...e.history, entry(e, 'submit', actor, 'submitted', at)] };
    }
    case 'start-review':
      if (reasons.length) throw new GuardrailError(reasons);
      return { ...e, state: 'under-review', history: [...e.history, entry(e, 'start-review', actor, 'under-review', at)] };
    case 'approve': {
      expect(actor !== e.requester && actor !== e.owner, reasons, `Separation of duties: ${actor || 'the actor'} is the requester or risk owner and cannot approve.`);
      expect(!e.approvals.some((a) => a.approver === actor), reasons, `${actor} has already approved this request.`);
      if (reasons.length) throw new GuardrailError(reasons);
      const approvals = [...e.approvals, { approver: actor, role: ev.role, decidedOn: at, note: ev.note.trim() }];
      const q = quorumFor({ ...e, approvals });
      if (renewalDecision && e.pendingRenewal) {
        // Approving a renewal: the running term is untouched until the quorum is met.
        if (!q.met) {
          const note = `${ev.note.trim()} Renewal to ${e.pendingRenewal.newExpiresOn}: ${q.have}/${q.need}${q.missingRoles.length ? `, still needs ${q.missingRoles.join(', ')}` : ''}.`.trim();
          return { ...e, approvals, history: [...e.history, entry(e, 'approve', actor, e.state, at, note)] };
        }
        const { pendingRenewal: _done, ...rest } = e;
        const note = `${ev.note.trim()} Renewal quorum met (${q.have}/${q.need}); expiry ${e.expiresOn} → ${e.pendingRenewal.newExpiresOn} (renewal ${e.renewals + 1}/${POLICY.maxRenewals}).`.trim();
        return { ...rest, approvals, state: 'active', expiresOn: e.pendingRenewal.newExpiresOn, renewals: e.renewals + 1, history: [...e.history, entry(e, 'approve', actor, 'active', at, note)] };
      }
      const to: State = q.met ? 'active' : 'under-review';
      const note = q.met ? `${ev.note.trim()} Quorum met (${q.have}/${q.need}, roles ${[...new Set(approvals.map((a) => a.role))].join(', ')}).`.trim() : `${ev.note.trim()} (${q.have}/${q.need}${q.missingRoles.length ? `, still needs ${q.missingRoles.join(', ')}` : ''})`.trim();
      return { ...e, approvals, state: to, history: [...e.history, entry(e, 'approve', actor, to, at, note)] };
    }
    case 'reject':
      expect(ev.note.trim().length > 0, reasons, 'A rejection note is required.');
      if (reasons.length) throw new GuardrailError(reasons);
      if (renewalDecision && e.pendingRenewal) {
        const { pendingRenewal: _dropped, ...rest } = e;
        return { ...rest, approvals: [], history: [...e.history, entry(e, 'reject', actor, e.state, at, `Renewal to ${e.pendingRenewal.newExpiresOn} refused; current term unchanged. ${ev.note.trim()}`)] };
      }
      return { ...e, state: 'rejected', history: [...e.history, entry(e, 'reject', actor, 'rejected', at, ev.note)] };
    case 'withdraw':
      if (reasons.length) throw new GuardrailError(reasons);
      return { ...e, state: 'withdrawn', history: [...e.history, entry(e, 'withdraw', actor, 'withdrawn', at, ev.note)] };
    case 'renew': {
      expect(actor === e.requester || actor === e.owner, reasons, `Only the requester (${e.requester}) or the risk owner (${e.owner}) can request a renewal.`);
      expect(!e.pendingRenewal, reasons, `A renewal to ${e.pendingRenewal?.newExpiresOn} is already pending approval.`);
      expect(e.renewals < POLICY.maxRenewals, reasons, `Already renewed ${e.renewals} times (maximum ${POLICY.maxRenewals}); raise a new exception instead.`);
      const max = POLICY.maxDurationDays[e.riskLevel];
      expect(ev.newExpiresOn > e.expiresOn && ev.newExpiresOn > at, reasons, `New expiry must be after the current expiry (${e.expiresOn}) and after today (${at}).`);
      expect(daysBetween(e.expiresOn, ev.newExpiresOn) <= max, reasons, `Renewal extends ${daysBetween(e.expiresOn, ev.newExpiresOn)} days; at most ${max} days beyond the current expiry is allowed for ${e.riskLevel} risk.`);
      if (reasons.length) throw new GuardrailError(reasons);
      // The current term keeps running: expiry and escalation are unaffected until the quorum approves the new date.
      return { ...e, approvals: [], pendingRenewal: { newExpiresOn: ev.newExpiresOn, requestedBy: actor, requestedOn: at, note: ev.note.trim() }, history: [...e.history, entry(e, 'renew', actor, e.state, at, `${ev.note.trim()} Renewal requested: ${e.expiresOn} → ${ev.newExpiresOn}; approvals reset, current expiry stands until the quorum approves (would be renewal ${e.renewals + 1}/${POLICY.maxRenewals}).`.trim())] };
    }
    case 'update-remediation':
      if (reasons.length) throw new GuardrailError(reasons);
      return { ...e, remediation: { ...e.remediation, status: ev.status }, history: [...e.history, entry(e, 'update-remediation', actor, e.state, at, `${e.remediation.status} → ${ev.status}. ${ev.note.trim()}`.trim())] };
    case 'close':
      expect(ev.evidence.trim().length >= POLICY.minClosureEvidence, reasons, `Closure evidence must be at least ${POLICY.minClosureEvidence} characters (what was done, where it can be verified).`);
      if (reasons.length) throw new GuardrailError(reasons);
      return { ...e, state: 'closed', closure: { evidence: ev.evidence.trim(), closedBy: actor, closedOn: at }, remediation: { ...e.remediation, status: 'done' }, history: [...e.history, entry(e, 'close', actor, 'closed', at, ev.evidence)] };
  }
}

/** Time-driven transitions. Idempotent; returns the same object when nothing changes. */
export function tick(e: Exception, at: string): Exception {
  if (e.state === 'active' && at > e.expiresOn) {
    const expired: Exception = { ...e, state: 'expired', history: [...e.history, entry(e, 'tick', 'system', 'expired', at, `Expiry ${e.expiresOn} passed without closure or renewal.`)] };
    return tick(expired, at);
  }
  if (e.state === 'expired' && daysBetween(e.expiresOn, at) > POLICY.escalationGraceDays) {
    return { ...e, state: 'escalated', history: [...e.history, entry(e, 'tick', 'system', 'escalated', at, `${POLICY.escalationGraceDays}-day grace window after expiry exceeded; escalated to the risk owner's management.`)] };
  }
  return e;
}

const STATE_FACTOR: Record<State, number> = { escalated: 3, expired: 2.5, active: 1, 'under-review': 1.5, submitted: 1.2, draft: 0.5, closed: 0, rejected: 0, withdrawn: 0 };

export function derive(e: Exception, at: string): Derived {
  const daysToExpiry = daysBetween(at, e.expiresOn);
  const live = e.state === 'active' || e.state === 'expired' || e.state === 'escalated';
  const expiring = e.state === 'active' && daysToExpiry >= 0 && daysToExpiry <= POLICY.expiringWindowDays;
  const overdueDays = live && daysToExpiry < 0 ? -daysToExpiry : 0;
  let factor = STATE_FACTOR[e.state];
  if (expiring) factor = 2;
  const relief = e.compensatingControls.filter((c) => c.trim()).length ? POLICY.compensatingRelief : 1;
  const priority = Math.round((POLICY.riskWeight[e.riskLevel] * factor * relief + overdueDays / 15) * 100) / 100;
  return { id: e.id, state: e.state, daysToExpiry, expiring, overdueDays, quorum: quorumFor(e), guardrails: contentGuardrails(e), priority };
}

export function prioritise(board: Board): Derived[] {
  return board.exceptions
    .map((e) => derive(tick(e, board.asOf), board.asOf))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export const ROLE_LABEL: Record<Role, string> = { manager: 'Manager', 'risk-owner': 'Risk owner', ciso: 'CISO', 'control-owner': 'Control owner' };
