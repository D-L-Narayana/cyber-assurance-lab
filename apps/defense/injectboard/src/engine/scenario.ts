export interface Role { id: string; name: string }
export interface TaskTemplate { id: string; role: string; title: string; dueInMinutes: number }
export interface Unlock { injectId: string; afterMinutes: number }
export interface Option { id: string; label: string; score: number; note: string; tasks?: TaskTemplate[]; unlocks?: Unlock[] }
export interface Decision { id: string; prompt: string; slaMinutes: number; options: Option[] }
export interface Inject { id: string; atMinute: number | null; role: string; title: string; body: string; decision?: Decision }
export interface Scenario { id: string; title: string; version: number; startAt: string; roles: Role[]; injects: Inject[]; description?: string }

/**
 * Import bounds. `maxBytes` is checked on the UTF-8 length of the text BEFORE `JSON.parse`; `maxDepth`/`maxValues`
 * are enforced by an iterative (stack-based) scan of the parsed value before any field is read. The shipped fixture
 * is exactly 8 containers deep (scenario → injects → inject → decision → options → option → tasks → task).
 */
export const LIMITS = {
  maxInjects: 200, maxMinute: 24 * 60, maxRoles: 12, maxText: 2000,
  maxBytes: 512 * 1024, maxDepth: 8, maxValues: 100_000, maxErrors: 25,
  maxId: 80, maxTitle: 200, maxDescription: 2000, maxRoleId: 40, maxRoleName: 120,
  maxPrompt: 500, maxLabel: 200, maxNote: 1000, maxOptions: 12, maxTasks: 12, maxUnlocks: 12, maxScore: 100,
};

export type ScenarioValidation = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

/** Validate a scenario given either as JSON text (bounded parse) or as an already-parsed value. Never throws. */
export function validateScenario(input: unknown): ScenarioValidation {
  if (typeof input === 'string') return parseScenario(input);
  return validateParsed(input);
}

/** Bounded text entry point used by the import dialog: byte cap → JSON.parse → structural scan → field rules. */
export function parseScenario(text: string): ScenarioValidation {
  if (utf8LengthExceeds(text, LIMITS.maxBytes)) return { ok: false, errors: [`Scenario text exceeds ${LIMITS.maxBytes.toLocaleString()} bytes (512 KiB, UTF-8).`] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, errors: ['Not valid JSON.'] }; }
  return validateParsed(parsed); // decoded exactly once: a JSON string literal is a value, never re-parsed
}

/** Structural scan + field rules for an already-decoded value. Strings are plain values here (not re-parsed). */
function validateParsed(input: unknown): ScenarioValidation {
  const structural = scanStructure(input);
  if (structural) return { ok: false, errors: [structural] };
  return validateShape(input);
}

/** True when the UTF-8 encoding of `s` is longer than `max` bytes; stops counting as soon as the cap is passed. */
function utf8LengthExceeds(s: string, max: number): boolean {
  if (s.length > max) return true; // UTF-8 never needs fewer bytes than UTF-16 code units
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
    if (n > max) return true;
  }
  return false;
}

/** Iterative depth/value scan. Containers nested deeper than `maxDepth` or more than `maxValues` values are rejected. */
function scanStructure(root: unknown): string | null {
  const stack: { v: unknown; depth: number }[] = [{ v: root, depth: 0 }];
  let values = 0;
  while (stack.length) {
    const { v, depth } = stack.pop()!;
    if (++values > LIMITS.maxValues) return `Scenario has too many values (more than ${LIMITS.maxValues.toLocaleString()}).`;
    if (typeof v === 'object' && v !== null) {
      if (depth + 1 > LIMITS.maxDepth) return `Scenario nesting depth exceeds ${LIMITS.maxDepth} levels.`;
      const children = Array.isArray(v) ? v : Object.values(v);
      for (const c of children) stack.push({ v: c, depth: depth + 1 });
    }
  }
  return null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
/**
 * Strict ISO-8601 timestamp: explicit zone, real calendar date (2026-02-30 rejected), fields in range (24:00 rejected),
 * and the platform parser must round-trip to the same instant as the component arithmetic. Returns epoch ms or null.
 */
export function parseIsoTimestamp(s: string): number | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), hh = Number(m[4]), mm = Number(m[5]);
  const ss = m[6] === undefined ? 0 : Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mm > 59 || ss > 59) return null;
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return null;
  let offsetMinutes = 0;
  if (m[8] !== 'Z') {
    const oh = Number(m[8].slice(1, 3)), om = Number(m[8].slice(4, 6));
    if (oh > 14 || om > 59) return null;
    offsetMinutes = (m[8][0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const t = Date.UTC(y, mo - 1, d, hh, mm, ss, ms) - offsetMinutes * 60_000;
  return Date.parse(s) === t ? t : null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : String(v));

function checkString(errors: string[], path: string, v: unknown, min: number, max: number): string | undefined {
  if (typeof v === 'string' && v.length >= min && v.length <= max) return v;
  errors.push(`${path}: must be a string of ${min === 0 ? `at most ${max}` : `${min}–${max}`} characters.`);
  return undefined;
}
function checkInt(errors: string[], path: string, v: unknown, min: number, max: number, message?: string): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
  errors.push(`${path}: ${message ?? `must be an integer between ${min} and ${max}`}.`);
  return undefined;
}
function checkNumber(errors: string[], path: string, v: unknown, min: number, max: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  errors.push(`${path}: must be a finite number between ${min} and ${max}.`);
  return undefined;
}
function checkRole(errors: string[], path: string, v: unknown, roleIds: Set<string>): string | undefined {
  if (typeof v === 'string' && roleIds.has(v)) return v;
  errors.push(`${path}: unknown role ${show(v)}.`);
  return undefined;
}

interface Ctx { roleIds: Set<string>; decisionIds: Set<string>; taskIds: Set<string>; injectIndex: Map<string, unknown> }

function validateShape(input: unknown): ScenarioValidation {
  if (!isObj(input)) return { ok: false, errors: ['Scenario must be a JSON object.'] };
  const errors: string[] = [];
  const fail = () => ({ ok: false as const, errors: errors.slice(0, LIMITS.maxErrors) });
  const id = checkString(errors, 'id', input.id, 1, LIMITS.maxId);
  const title = checkString(errors, 'title', input.title, 1, LIMITS.maxTitle);
  const version = checkInt(errors, 'version', input.version, 1, Number.MAX_SAFE_INTEGER, 'must be a positive integer');
  let startAt: string | undefined;
  if (typeof input.startAt === 'string' && parseIsoTimestamp(input.startAt) !== null) startAt = input.startAt;
  else errors.push('startAt: must be an ISO-8601 timestamp with an explicit zone naming a real calendar date, e.g. 2026-10-06T09:00:00Z.');
  const description = input.description === undefined ? undefined : checkString(errors, 'description', input.description, 0, LIMITS.maxDescription);
  if (!Array.isArray(input.roles)) errors.push(`roles: must be an array of 1–${LIMITS.maxRoles} roles.`);
  else if (input.roles.length < 1 || input.roles.length > LIMITS.maxRoles) errors.push(`roles: must contain 1–${LIMITS.maxRoles} roles (found ${input.roles.length}).`);
  if (!Array.isArray(input.injects)) errors.push(`injects: must be an array of at most ${LIMITS.maxInjects} injects.`);
  else if (input.injects.length > LIMITS.maxInjects) errors.push(`injects: too many injects: ${input.injects.length} (limit ${LIMITS.maxInjects}).`);
  if (!Array.isArray(input.roles) || !Array.isArray(input.injects)) return fail();

  const roles: Role[] = []; const roleIds = new Set<string>();
  input.roles.forEach((raw: unknown, i: number) => {
    const p = `roles[${i}]`;
    if (!isObj(raw)) { errors.push(`${p}: must be an object { id, name }.`); return; }
    const rid = checkString(errors, `${p}.id`, raw.id, 1, LIMITS.maxRoleId);
    const name = checkString(errors, `${p}.name`, raw.name, 1, LIMITS.maxRoleName);
    if (rid !== undefined) { if (roleIds.has(rid)) errors.push(`${p}.id: duplicate role id ${show(rid)}.`); roleIds.add(rid); }
    if (rid !== undefined && name !== undefined) roles.push({ id: rid, name });
  });

  // Unlock targets are resolved against every inject id, so a decision may unlock an inject declared later in the list.
  const injectIndex = new Map<string, unknown>();
  for (const raw of input.injects) if (isObj(raw) && typeof raw.id === 'string') injectIndex.set(raw.id, raw.atMinute);
  const ctx: Ctx = { roleIds, decisionIds: new Set(), taskIds: new Set(), injectIndex };

  const injects: Inject[] = []; const injectIds = new Set<string>();
  input.injects.forEach((raw: unknown, i: number) => {
    const p = `injects[${i}]`;
    if (!isObj(raw)) { errors.push(`${p}: must be an object.`); return; }
    const iid = checkString(errors, `${p}.id`, raw.id, 1, LIMITS.maxId);
    if (iid !== undefined) { if (injectIds.has(iid)) errors.push(`${p}.id: duplicate inject id ${show(iid)}.`); injectIds.add(iid); }
    const atMinute = raw.atMinute === null ? null : checkInt(errors, `${p}.atMinute`, raw.atMinute, 0, LIMITS.maxMinute, `must be null (unlock-only) or an integer between 0 and ${LIMITS.maxMinute}`);
    const role = checkRole(errors, `${p}.role`, raw.role, roleIds);
    const ititle = checkString(errors, `${p}.title`, raw.title, 1, LIMITS.maxTitle);
    const body = checkString(errors, `${p}.body`, raw.body, 0, LIMITS.maxText);
    const decision = raw.decision === undefined ? undefined : validateDecision(errors, `${p}.decision`, raw.decision, ctx);
    if (iid === undefined || atMinute === undefined || role === undefined || ititle === undefined || body === undefined || (raw.decision !== undefined && !decision)) return;
    const inj: Inject = { id: iid, atMinute, role, title: ititle, body };
    if (decision) inj.decision = decision;
    injects.push(inj);
  });

  if (errors.length) return fail();
  const scenario: Scenario = { id: id!, title: title!, version: version!, startAt: startAt!, roles, injects };
  if (description !== undefined) scenario.description = description;
  return { ok: true, scenario };
}

function validateDecision(errors: string[], p: string, raw: unknown, ctx: Ctx): Decision | undefined {
  if (!isObj(raw)) { errors.push(`${p}: must be an object { id, prompt, slaMinutes, options }.`); return undefined; }
  const did = checkString(errors, `${p}.id`, raw.id, 1, LIMITS.maxId);
  if (did !== undefined) { if (ctx.decisionIds.has(did)) errors.push(`${p}.id: duplicate decision id ${show(did)}.`); ctx.decisionIds.add(did); }
  const prompt = checkString(errors, `${p}.prompt`, raw.prompt, 1, LIMITS.maxPrompt);
  const sla = checkInt(errors, `${p}.slaMinutes`, raw.slaMinutes, 1, LIMITS.maxMinute);
  let options: Option[] | undefined;
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > LIMITS.maxOptions) errors.push(`${p}.options: must be an array of 2–${LIMITS.maxOptions} options.`);
  else {
    const optionIds = new Set<string>(); const out: Option[] = [];
    raw.options.forEach((o: unknown, j: number) => { const opt = validateOption(errors, `${p}.options[${j}]`, o, optionIds, ctx); if (opt) out.push(opt); });
    if (out.length === raw.options.length) options = out;
  }
  if (did === undefined || prompt === undefined || sla === undefined || !options) return undefined;
  return { id: did, prompt, slaMinutes: sla, options };
}

function validateOption(errors: string[], p: string, raw: unknown, optionIds: Set<string>, ctx: Ctx): Option | undefined {
  if (!isObj(raw)) { errors.push(`${p}: must be an object { id, label, score, note }.`); return undefined; }
  const oid = checkString(errors, `${p}.id`, raw.id, 1, LIMITS.maxId);
  if (oid !== undefined) { if (optionIds.has(oid)) errors.push(`${p}.id: duplicate option id ${show(oid)} within this decision.`); optionIds.add(oid); }
  const label = checkString(errors, `${p}.label`, raw.label, 1, LIMITS.maxLabel);
  const score = checkNumber(errors, `${p}.score`, raw.score, 0, LIMITS.maxScore);
  const note = checkString(errors, `${p}.note`, raw.note, 0, LIMITS.maxNote);
  let tasks: TaskTemplate[] | undefined; let unlocks: Unlock[] | undefined; let complete = true;
  if (raw.tasks !== undefined) {
    if (!Array.isArray(raw.tasks) || raw.tasks.length > LIMITS.maxTasks) { errors.push(`${p}.tasks: must be an array of at most ${LIMITS.maxTasks} tasks.`); complete = false; }
    else { const out: TaskTemplate[] = []; raw.tasks.forEach((t: unknown, k: number) => { const task = validateTask(errors, `${p}.tasks[${k}]`, t, ctx); if (task) out.push(task); else complete = false; }); tasks = out; }
  }
  if (raw.unlocks !== undefined) {
    if (!Array.isArray(raw.unlocks) || raw.unlocks.length > LIMITS.maxUnlocks) { errors.push(`${p}.unlocks: must be an array of at most ${LIMITS.maxUnlocks} unlocks.`); complete = false; }
    else { const out: Unlock[] = []; raw.unlocks.forEach((u: unknown, k: number) => { const unlock = validateUnlock(errors, `${p}.unlocks[${k}]`, u, ctx); if (unlock) out.push(unlock); else complete = false; }); unlocks = out; }
  }
  if (!complete || oid === undefined || label === undefined || score === undefined || note === undefined) return undefined;
  const opt: Option = { id: oid, label, score, note };
  if (tasks) opt.tasks = tasks;
  if (unlocks) opt.unlocks = unlocks;
  return opt;
}

function validateTask(errors: string[], p: string, raw: unknown, ctx: Ctx): TaskTemplate | undefined {
  if (!isObj(raw)) { errors.push(`${p}: must be an object { id, role, title, dueInMinutes }.`); return undefined; }
  const tid = checkString(errors, `${p}.id`, raw.id, 1, LIMITS.maxId);
  if (tid !== undefined) { if (ctx.taskIds.has(tid)) errors.push(`${p}.id: duplicate task id ${show(tid)}.`); ctx.taskIds.add(tid); }
  const role = checkRole(errors, `${p}.role`, raw.role, ctx.roleIds);
  const title = checkString(errors, `${p}.title`, raw.title, 1, LIMITS.maxTitle);
  const due = checkInt(errors, `${p}.dueInMinutes`, raw.dueInMinutes, 0, LIMITS.maxMinute);
  if (tid === undefined || role === undefined || title === undefined || due === undefined) return undefined;
  return { id: tid, role, title, dueInMinutes: due };
}

function validateUnlock(errors: string[], p: string, raw: unknown, ctx: Ctx): Unlock | undefined {
  if (!isObj(raw)) { errors.push(`${p}: must be an object { injectId, afterMinutes }.`); return undefined; }
  let injectId: string | undefined;
  if (typeof raw.injectId !== 'string' || !ctx.injectIndex.has(raw.injectId)) errors.push(`${p}.injectId: unknown inject ${show(raw.injectId)}.`);
  else if (ctx.injectIndex.get(raw.injectId) !== null) errors.push(`${p}.injectId: unlock target ${show(raw.injectId)} must be an unlock-only inject (atMinute: null); scheduled injects cannot also be unlocked.`);
  else injectId = raw.injectId;
  const after = checkInt(errors, `${p}.afterMinutes`, raw.afterMinutes, 0, LIMITS.maxMinute);
  if (injectId === undefined || after === undefined) return undefined;
  return { injectId, afterMinutes: after };
}
