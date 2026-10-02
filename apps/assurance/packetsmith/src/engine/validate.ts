// Bounded, path-addressed validation for imported packets. Rebuilds a clean object with known keys only.
import { CATALOG, CONTROL_IDS, METHODS } from './catalog';
import { ARTIFACT_KINDS, type Artifact, type DeterminationResult, type Finding, type HistoryEntry, type PacketState, type Step, type ValidationIssue, type ValidationResult } from './types';

export const MAX_PACKET_BYTES = 1024 * 1024;
export const MAX_STEPS = 400;
export const MAX_ARTIFACTS = 300;
export const MAX_FINDINGS = 200;
export const MAX_HISTORY = 500;
export const MAX_CONTENT = 20_000;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 200;

const STATES: PacketState[] = ['drafting', 'ready-for-review', 'approved', 'returned'];
const DET_IDS = new Set(CATALOG.flatMap((c) => c.determinations.map((d) => d.id)));

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

type Issues = ValidationIssue[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function str(v: unknown, path: string, issues: Issues, max = MAX_SHORT, min = 1): string {
  if (typeof v !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  if (v.length < min) issues.push({ path, message: `must be at least ${min} character(s)` });
  if (v.length > max) issues.push({ path, message: `must be at most ${max} characters` });
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, issues: Issues): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    issues.push({ path, message: `must be one of ${allowed.join(', ')}` });
    return allowed[0];
  }
  return v as T;
}
function date(v: unknown, path: string, issues: Issues): string {
  if (!isIsoDate(v)) {
    issues.push({ path, message: 'must be an ISO date (YYYY-MM-DD)' });
    return '2000-01-01';
  }
  return v;
}
function idList(v: unknown, path: string, issues: Issues, max = 50): string[] {
  if (!Array.isArray(v)) {
    issues.push({ path, message: 'must be an array of ids' });
    return [];
  }
  if (v.length > max) issues.push({ path, message: `at most ${max} entries` });
  return v.slice(0, max).map((x, i) => str(x, `${path}[${i}]`, issues, 64));
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
function unique(items: { id: string }[], path: string, issues: Issues) {
  const seen = new Set<string>();
  items.forEach((x, i) => {
    if (seen.has(x.id)) issues.push({ path: `${path}[${i}].id`, message: `duplicate id ${x.id}` });
    seen.add(x.id);
  });
}

export function validatePacketObject(raw: unknown): ValidationResult {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', message: 'packet must be a JSON object' }] };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'packetsmith.packet/1') issues.push({ path: 'schema', message: "schema must be 'packetsmith.packet/1'" });

  const m = obj(o.meta);
  const meta = {
    systemName: str(m.systemName, 'meta.systemName', issues),
    assessor: str(m.assessor, 'meta.assessor', issues, 80),
    approver: str(m.approver, 'meta.approver', issues, 80),
    asOf: date(m.asOf, 'meta.asOf', issues),
  };

  const selectedControls = list(o.selectedControls, 'selectedControls', issues, CATALOG.length, (r, p) => {
    const s = str(r, p, issues, 10);
    if (s && !CONTROL_IDS.has(s)) issues.push({ path: p, message: `unknown control id in this subset: ${s}` });
    return s;
  });

  const steps: Step[] = list(o.steps, 'steps', issues, MAX_STEPS, (r, p) => {
    const s = obj(r);
    const status = oneOf(s.status, ['planned', 'performed', 'skipped'] as const, p + '.status', issues);
    const controlId = str(s.controlId, p + '.controlId', issues, 10);
    if (controlId && !CONTROL_IDS.has(controlId)) issues.push({ path: p + '.controlId', message: 'unknown control id' });
    const st: Step = {
      id: str(s.id, p + '.id', issues, 64),
      controlId,
      method: oneOf(s.method, METHODS, p + '.method', issues),
      object: str(s.object, p + '.object', issues, MAX_SHORT),
      status,
      evidenceIds: idList(s.evidenceIds, p + '.evidenceIds', issues),
      notes: str(s.notes ?? '', p + '.notes', issues, MAX_TEXT, 0),
    };
    if (s.skipReason !== undefined) st.skipReason = str(s.skipReason, p + '.skipReason', issues, MAX_TEXT, 0);
    return st;
  });
  unique(steps, 'steps', issues);

  const artifacts: Artifact[] = list(o.artifacts, 'artifacts', issues, MAX_ARTIFACTS, (r, p) => {
    const a = obj(r);
    const sha = str(a.sha256, p + '.sha256', issues, 64);
    if (sha && !/^[0-9a-f]{64}$/i.test(sha)) issues.push({ path: p + '.sha256', message: 'sha256 must be 64 hex characters' });
    return {
      id: str(a.id, p + '.id', issues, 64),
      name: str(a.name, p + '.name', issues),
      kind: oneOf(a.kind, ARTIFACT_KINDS, p + '.kind', issues),
      content: str(a.content, p + '.content', issues, MAX_CONTENT, 0),
      capturedOn: date(a.capturedOn, p + '.capturedOn', issues),
      sha256: sha.toLowerCase(),
    };
  });
  unique(artifacts, 'artifacts', issues);

  const determinations: DeterminationResult[] = list(o.determinations, 'determinations', issues, CATALOG.length * 3, (r, p) => {
    const d = obj(r);
    const controlId = str(d.controlId, p + '.controlId', issues, 10);
    const determinationId = str(d.determinationId, p + '.determinationId', issues, 16);
    if (determinationId && !DET_IDS.has(determinationId)) issues.push({ path: p + '.determinationId', message: `unknown determination id: ${determinationId}` });
    else if (determinationId && !determinationId.startsWith(controlId + '.')) issues.push({ path: p + '.determinationId', message: 'determination does not belong to controlId' });
    return {
      controlId,
      determinationId,
      result: oneOf(d.result, ['satisfied', 'other-than-satisfied', 'not-assessed'] as const, p + '.result', issues),
      stepIds: idList(d.stepIds, p + '.stepIds', issues),
      rationale: str(d.rationale ?? '', p + '.rationale', issues, MAX_TEXT, 0),
    };
  });
  {
    const seen = new Set<string>();
    determinations.forEach((d, i) => {
      if (seen.has(d.determinationId)) issues.push({ path: `determinations[${i}]`, message: `duplicate result for ${d.determinationId}` });
      seen.add(d.determinationId);
    });
  }

  const findings: Finding[] = list(o.findings, 'findings', issues, MAX_FINDINGS, (r, p) => {
    const f = obj(r);
    const act = obj(f.action);
    const determinationId = str(f.determinationId, p + '.determinationId', issues, 16);
    if (determinationId && !DET_IDS.has(determinationId)) issues.push({ path: p + '.determinationId', message: 'unknown determination id' });
    return {
      id: str(f.id, p + '.id', issues, 64),
      controlId: str(f.controlId, p + '.controlId', issues, 10),
      determinationId,
      description: str(f.description, p + '.description', issues, MAX_TEXT),
      severity: oneOf(f.severity, ['low', 'moderate', 'high'] as const, p + '.severity', issues),
      action: {
        description: str(act.description ?? '', p + '.action.description', issues, MAX_TEXT, 0),
        owner: str(act.owner ?? '', p + '.action.owner', issues, 80, 0),
        dueOn: date(act.dueOn, p + '.action.dueOn', issues),
        status: oneOf(act.status, ['open', 'in-progress', 'completed'] as const, p + '.action.status', issues),
      },
    };
  });
  unique(findings, 'findings', issues);

  let state: PacketState = 'drafting';
  if (typeof o.state !== 'string' || !STATES.includes(o.state as PacketState)) issues.push({ path: 'state', message: `state must be one of ${STATES.join(', ')}` });
  else state = o.state as PacketState;
  const history: HistoryEntry[] = list(o.history, 'history', issues, MAX_HISTORY, (r, p) => {
    const h = obj(r);
    return {
      at: date(h.at, p + '.at', issues),
      from: oneOf(h.from, STATES, p + '.from', issues),
      to: oneOf(h.to, STATES, p + '.to', issues),
      actor: str(h.actor, p + '.actor', issues, 80),
      note: str(h.note ?? '', p + '.note', issues, MAX_TEXT, 0),
    };
  });

  if (meta.assessor.trim() && meta.assessor.trim() === meta.approver.trim()) issues.push({ path: 'meta.approver', message: 'approver must differ from the assessor (separation of duties)' });

  // History must chain and must agree with the recorded state; 'approved' is terminal, so once reached the state must be approved.
  for (let i = 1; i < history.length; i++) {
    if (history[i].from !== history[i - 1].to) issues.push({ path: `history[${i}].from`, message: `must equal the previous entry's 'to' (${history[i - 1].to})` });
  }
  const last = history[history.length - 1];
  if (last && last.to !== state) issues.push({ path: 'state', message: `must equal the last history entry's 'to' (${last.to})` });
  if (history.some((h) => h.to === 'approved') && state !== 'approved') issues.push({ path: 'state', message: "history records an approved transition; 'approved' is terminal so state must be approved" });

  if (issues.length) return { ok: false, issues: issues.slice(0, 60) };
  return { ok: true, packet: { schema: 'packetsmith.packet/1', meta, selectedControls, steps, artifacts, determinations, findings, state, history } };
}

export function validatePacket(text: string): ValidationResult {
  if (text.length > MAX_PACKET_BYTES || new TextEncoder().encode(text).byteLength > MAX_PACKET_BYTES) {
    return { ok: false, issues: [{ path: '', message: `packet too large: limit is ${MAX_PACKET_BYTES} bytes` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
  return validatePacketObject(raw);
}
