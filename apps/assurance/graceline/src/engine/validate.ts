// Bounded, path-addressed board validation.
import { RISK_LEVELS, ROLES, STATES, type Approval, type Exception, type HistoryEntry, type ValidationIssue, type ValidationResult } from './types';

export const MAX_BOARD_BYTES = 1024 * 1024;
export const MAX_EXCEPTIONS = 300;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 200;

type Issues = ValidationIssue[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function str(v: unknown, path: string, issues: Issues, max = MAX_SHORT, min = 1): string {
  if (typeof v !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  if (v.length < min) issues.push({ path, message: `must be at least ${min} character(s)` });
  if (v.length > max) issues.push({ path, message: `must be at most ${max} characters` });
  return v;
}
function date(v: unknown, path: string, issues: Issues): string {
  if (!isIsoDate(v)) {
    issues.push({ path, message: 'must be an ISO date (YYYY-MM-DD)' });
    return '2000-01-01';
  }
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, issues: Issues, label: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    issues.push({ path, message: `${label} must be one of ${allowed.join(', ')}` });
    return allowed[0];
  }
  return v as T;
}
function list<T>(v: unknown, path: string, issues: Issues, max: number, fn: (raw: unknown, p: string) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    issues.push({ path, message: 'must be an array' });
    return [];
  }
  if (v.length > max) {
    issues.push({ path, message: `at most ${max} entries are accepted` });
    return [];
  }
  return v.map((raw, i) => fn(raw, `${path}[${i}]`));
}

function exception(raw: unknown, p: string, issues: Issues): Exception {
  const o = obj(raw);
  if (!raw || typeof raw !== 'object') issues.push({ path: p, message: 'must be an object' });
  const rem = obj(o.remediation);
  const renewals = typeof o.renewals === 'number' && Number.isInteger(o.renewals) && o.renewals >= 0 && o.renewals <= 10 ? o.renewals : (issues.push({ path: p + '.renewals', message: 'must be an integer from 0 to 10' }), 0);
  const e: Exception = {
    id: str(o.id, p + '.id', issues, 64),
    title: str(o.title, p + '.title', issues),
    policyRef: str(o.policyRef, p + '.policyRef', issues),
    riskLevel: oneOf(o.riskLevel, RISK_LEVELS, p + '.riskLevel', issues, 'riskLevel'),
    requester: str(o.requester, p + '.requester', issues, 80),
    owner: str(o.owner ?? '', p + '.owner', issues, 80, 0),
    compensatingControls: list(o.compensatingControls, p + '.compensatingControls', issues, 20, (r, pp) => str(r, pp, issues, MAX_SHORT)),
    justification: str(o.justification ?? '', p + '.justification', issues, MAX_TEXT, 0),
    requestedOn: date(o.requestedOn, p + '.requestedOn', issues),
    startOn: date(o.startOn, p + '.startOn', issues),
    expiresOn: date(o.expiresOn, p + '.expiresOn', issues),
    renewals,
    state: oneOf(o.state, STATES, p + '.state', issues, 'state'),
    ...(o.pendingRenewal !== undefined && o.pendingRenewal !== null
      ? { pendingRenewal: (() => { const r = obj(o.pendingRenewal); const pp = p + '.pendingRenewal'; return { newExpiresOn: date(r.newExpiresOn, pp + '.newExpiresOn', issues), requestedBy: str(r.requestedBy, pp + '.requestedBy', issues, 80), requestedOn: date(r.requestedOn, pp + '.requestedOn', issues), note: str(r.note ?? '', pp + '.note', issues, MAX_TEXT, 0) }; })() }
      : {}),
    approvals: list(o.approvals, p + '.approvals', issues, 10, (r, pp): Approval => {
      const a = obj(r);
      return { approver: str(a.approver, pp + '.approver', issues, 80), role: oneOf(a.role, ROLES, pp + '.role', issues, 'role'), decidedOn: date(a.decidedOn, pp + '.decidedOn', issues), note: str(a.note ?? '', pp + '.note', issues, MAX_TEXT, 0) };
    }),
    remediation: {
      plan: str(rem.plan ?? '', p + '.remediation.plan', issues, MAX_TEXT, 0),
      dueOn: date(rem.dueOn, p + '.remediation.dueOn', issues),
      status: oneOf(rem.status, ['planned', 'in-progress', 'done'] as const, p + '.remediation.status', issues, 'remediation.status'),
    },
    history: list(o.history, p + '.history', issues, 200, (r, pp): HistoryEntry => {
      const h = obj(r);
      return { at: date(h.at, pp + '.at', issues), event: str(h.event, pp + '.event', issues, 40), actor: str(h.actor, pp + '.actor', issues, 80), from: oneOf(h.from, STATES, pp + '.from', issues, 'from'), to: oneOf(h.to, STATES, pp + '.to', issues, 'to'), note: str(h.note ?? '', pp + '.note', issues, MAX_TEXT, 0) };
    }),
  };
  if (o.closure !== undefined) {
    const c = obj(o.closure);
    e.closure = { evidence: str(c.evidence, p + '.closure.evidence', issues, MAX_TEXT), closedBy: str(c.closedBy, p + '.closure.closedBy', issues, 80), closedOn: date(c.closedOn, p + '.closure.closedOn', issues) };
  }
  return e;
}

export function validateBoardObject(raw: unknown): ValidationResult {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', message: 'board must be a JSON object' }] };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'graceline.board/1') issues.push({ path: 'schema', message: "schema must be 'graceline.board/1'" });
  const asOf = date(o.asOf, 'asOf', issues);
  const exceptions = list(o.exceptions, 'exceptions', issues, MAX_EXCEPTIONS, (r, p) => exception(r, p, issues));
  const seen = new Set<string>();
  exceptions.forEach((e, i) => {
    if (seen.has(e.id)) issues.push({ path: `exceptions[${i}].id`, message: `duplicate id ${e.id}` });
    seen.add(e.id);
  });
  if (issues.length) return { ok: false, issues: issues.slice(0, 60) };
  return { ok: true, board: { schema: 'graceline.board/1', asOf, exceptions } };
}

export function validateBoard(text: string): ValidationResult {
  if (text.length > MAX_BOARD_BYTES || new TextEncoder().encode(text).byteLength > MAX_BOARD_BYTES) return { ok: false, issues: [{ path: '', message: `board too large: limit is ${MAX_BOARD_BYTES} bytes` }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
  return validateBoardObject(raw);
}
