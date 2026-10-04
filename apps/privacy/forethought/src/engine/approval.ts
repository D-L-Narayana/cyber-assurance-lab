import type { AppliedMitigation, Assessment, Blocker, DataFlow, MitigationStatus, RiskAcceptance, Signature, Version } from './types';
import { THEME_LABEL } from './types';
import { MITIGATIONS } from './rubric';
import { mitigationCounts, score, visibleQuestions } from './scoring';

/** Invariants that must hold before anyone can sign. Each blocker names the thing to fix. */
export function signOffBlockers(a: Assessment): Blocker[] {
  const blockers: Blocker[] = [];
  const unanswered = visibleQuestions(a).filter((q) => !q.options.some((o) => o.id === a.answers[q.id]));
  if (unanswered.length) blockers.push({ code: 'UNANSWERED_QUESTIONS', message: `${unanswered.length} question(s) still need an answer: ${unanswered.map((q) => q.id).join(', ')}.` });

  const card = score(a);
  for (const t of card.themes) {
    if (t.residual.band !== 'high' && t.residual.band !== 'very-high') continue;
    const acc = t.acceptance;
    if (!acc || acc.rationale.trim().length < 30) {
      blockers.push({ code: 'HIGH_RESIDUAL_WITHOUT_ACCEPTANCE', subject: t.theme, message: `${THEME_LABEL[t.theme]} is ${t.residual.band} after mitigations and has no recorded risk acceptance (rationale of 30+ characters).` });
      continue;
    }
    if (t.residual.band === 'very-high' && acc.acceptedBy !== 'data-protection-lead') {
      blockers.push({ code: 'VERY_HIGH_NEEDS_DP_LEAD', subject: t.theme, message: `${THEME_LABEL[t.theme]} is very high; acceptance must come from the data-protection lead, not the product owner alone.` });
    }
  }

  for (const f of a.flows) {
    if (f.outsideOriginRegion && f.mechanism === 'none') blockers.push({ code: 'UNRESOLVED_TRANSFER', subject: f.id, message: `Flow ${f.id} (${f.from} → ${f.to}) leaves the origin region with no transfer mechanism.` });
  }

  if (card.isDpiaScale && !a.dpoConsulted) {
    blockers.push({ code: 'DPO_NOT_CONSULTED', message: 'Inherent risk is very high in at least one theme; record that the data protection officer was consulted (GDPR Art. 35(2) expects DPO advice on a DPIA).' });
  }

  for (const m of a.mitigations) {
    const def = MITIGATIONS.find((x) => x.id === m.mitigationId);
    if (def?.requiresEvidence && m.status === 'verified' && !mitigationCounts(m)) {
      blockers.push({ code: 'EVIDENCE_MISSING', subject: m.mitigationId, message: `${def.name} is marked verified but has no evidence reference.` });
    }
  }
  return blockers;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const flowRows = (flows: DataFlow[]) => [...flows].sort((x, y) => x.id.localeCompare(y.id)).map((f) => [f.id, f.from, f.to, [...f.dataCategories].sort(), f.outsideOriginRegion, f.mechanism]);
const acceptanceRows = (acceptances: RiskAcceptance[]) => [...acceptances].sort((x, y) => x.theme.localeCompare(y.theme)).map((x) => [x.theme, x.acceptedBy, x.acceptedByName, x.rationale, x.acceptedOn]);

/** Hash of the assessable content only: signatures and versions are excluded so they can reference it. */
export function canonicalContent(a: Assessment): string {
  const answers = Object.keys(a.answers).sort().map((k) => [k, a.answers[k]]);
  const mitigations = [...a.mitigations].sort((x, y) => x.mitigationId.localeCompare(y.mitigationId)).map((m) => [m.mitigationId, m.status, m.evidenceRef ?? '', m.owner ?? '']);
  return JSON.stringify({ id: a.id, title: a.title, owner: a.owner, description: a.description, answers, mitigations, flows: flowRows(a.flows), acceptances: acceptanceRows(a.acceptances), dpoConsulted: a.dpoConsulted });
}

export async function contentHash(a: Assessment): Promise<string> {
  return sha256(canonicalContent(a));
}

export function applyAnswer(a: Assessment, questionId: string, optionId: string): Assessment {
  return { ...a, answers: { ...a.answers, [questionId]: optionId } };
}

export class SignOffError extends Error {
  readonly blockers: Blocker[];
  constructor(blockers: Blocker[]) {
    super(`Sign-off blocked by ${blockers.length} issue(s): ${blockers.map((b) => b.code).join(', ')}`);
    this.name = 'SignOffError';
    this.blockers = blockers;
  }
}

export async function signOff(a: Assessment, signer: Omit<Signature, 'contentHash'>): Promise<Assessment> {
  const blockers = signOffBlockers(a);
  if (blockers.length) throw new SignOffError(blockers);
  const hash = await contentHash(a);
  return { ...a, signatures: [...a.signatures.filter((s) => s.role !== signer.role), { ...signer, contentHash: hash }] };
}

export async function signatureStatus(a: Assessment): Promise<Array<Signature & { current: boolean }>> {
  const hash = await contentHash(a);
  return a.signatures.map((s) => ({ ...s, current: s.contentHash === hash }));
}

function diffSummary(prev: CanonicalContent, next: CanonicalContent): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(prev.answers), ...Object.keys(next.answers)]);
  for (const k of [...keys].sort()) {
    if (prev.answers[k] !== next.answers[k]) out.push(`Answer ${k}: ${prev.answers[k] ?? '—'} → ${next.answers[k] ?? '—'}`);
  }
  const pm = new Map(prev.mitigations.map((m) => [m.mitigationId, m]));
  const nm = new Map(next.mitigations.map((m) => [m.mitigationId, m]));
  for (const id of new Set([...pm.keys(), ...nm.keys()])) {
    const p = pm.get(id); const n = nm.get(id);
    if (!p) out.push(`Mitigation ${id} added (${n!.status})`);
    else if (!n) out.push(`Mitigation ${id} removed`);
    else if (p.status !== n.status || (p.evidenceRef ?? '') !== (n.evidenceRef ?? '')) out.push(`Mitigation ${id}: ${p.status} → ${n.status}${n.evidenceRef ? ` (${n.evidenceRef})` : ''}`);
  }
  if (JSON.stringify(flowRows(prev.flows)) !== JSON.stringify(flowRows(next.flows))) out.push('Data flows changed');
  if (JSON.stringify(acceptanceRows(prev.acceptances)) !== JSON.stringify(acceptanceRows(next.acceptances))) out.push('Risk acceptances changed');
  if (prev.dpoConsulted !== next.dpoConsulted) out.push(`DPO consulted: ${prev.dpoConsulted} → ${next.dpoConsulted}`);
  for (const k of ['title', 'owner', 'description'] as const) if (prev[k] !== next[k]) out.push(`${k} changed`);
  return out.length ? out : ['No content changes since the previous version.'];
}

/** Upper bound on the canonical content retained on a version (UTF-8 bytes). */
export const MAX_VERSION_CONTENT_BYTES = 64 * 1024;

/** The assessable content, as reconstructed from a canonical content string. */
export type CanonicalContent = Pick<Assessment, 'answers' | 'mitigations' | 'flows' | 'acceptances' | 'dpoConsulted' | 'title' | 'owner' | 'description'>;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/**
 * Reconstructs the assessable content from a `canonicalContent` string. Returns `undefined` for anything
 * that is not well-formed canonical content (bad JSON, wrong shapes, oversized), so callers fall back to a
 * hash-only summary instead of throwing. Enum values are reproduced as stored; `parseAssessment` is the
 * place where imported enums are validated.
 */
export function fromCanonical(content: string): CanonicalContent | undefined {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_VERSION_CONTENT_BYTES) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return undefined; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const title = o['title'];
  const owner = o['owner'];
  const description = o['description'];
  const dpoConsulted = o['dpoConsulted'];
  const rawAnswers = o['answers'];
  const rawMitigations = o['mitigations'];
  const rawFlows = o['flows'];
  const rawAcceptances = o['acceptances'];
  if (!isStr(title) || !isStr(owner) || !isStr(description) || !isBool(dpoConsulted)) return undefined;
  if (!Array.isArray(rawAnswers) || !Array.isArray(rawMitigations) || !Array.isArray(rawFlows) || !Array.isArray(rawAcceptances)) return undefined;

  const answers: Record<string, string> = {};
  for (const pair of rawAnswers as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2) return undefined;
    const [k, v] = pair as unknown[];
    if (!isStr(k) || !isStr(v)) return undefined;
    answers[k] = v;
  }
  const mitigations: AppliedMitigation[] = [];
  for (const row of rawMitigations as unknown[]) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(isStr)) return undefined;
    const [mitigationId, status, evidenceRef, mitigationOwner] = row as [string, string, string, string];
    mitigations.push({ mitigationId, status: status as MitigationStatus, ...(evidenceRef ? { evidenceRef } : {}), ...(mitigationOwner ? { owner: mitigationOwner } : {}) });
  }
  const flows: DataFlow[] = [];
  for (const row of rawFlows as unknown[]) {
    if (!Array.isArray(row) || row.length !== 6) return undefined;
    const [id, from, to, cats, outside, mechanism] = row as unknown[];
    if (!isStr(id) || !isStr(from) || !isStr(to) || !isStrArray(cats) || !isBool(outside) || !isStr(mechanism)) return undefined;
    flows.push({ id, from, to, dataCategories: cats, outsideOriginRegion: outside, mechanism: mechanism as DataFlow['mechanism'] });
  }
  const acceptances: RiskAcceptance[] = [];
  for (const row of rawAcceptances as unknown[]) {
    if (!Array.isArray(row) || row.length !== 5 || !row.every(isStr)) return undefined;
    const [theme, acceptedBy, acceptedByName, rationale, acceptedOn] = row as [string, string, string, string, string];
    acceptances.push({ theme: theme as RiskAcceptance['theme'], acceptedBy: acceptedBy as RiskAcceptance['acceptedBy'], acceptedByName, rationale, acceptedOn });
  }
  return { title, owner, description, dpoConsulted, answers, mitigations, flows, acceptances };
}

/** The previous version's content for diffing, or the reason it cannot be used (stated in the summary). */
async function previousContent(last: Version): Promise<{ prev: CanonicalContent } | { reason: string }> {
  if (last.content === undefined) return { reason: 'the previous version carries no retained content' };
  if ((await sha256(last.content)) !== last.contentHash) return { reason: 'the retained content does not match the previous version’s content hash' };
  const prev = fromCanonical(last.content);
  return prev ? { prev } : { reason: 'the retained content could not be read as canonical content' };
}

/**
 * Records a version: number, timestamp, content hash, a change summary relative to the previous version,
 * and (when it fits the cap) the canonical content itself, so the next snapshot — in this session or after
 * an export/import round-trip — can summarise field by field. There is no module-level state: everything the
 * diff needs travels inside the assessment, and the previous version's content is used only when its hash
 * matches its own stored `contentHash` (a stale or copied version cannot leak another assessment's content).
 */
export async function snapshot(a: Assessment, at: string): Promise<Assessment> {
  const hash = await contentHash(a);
  const last = a.versions.at(-1);
  const content = canonicalContent(a);
  const retain = new TextEncoder().encode(content).length <= MAX_VERSION_CONTENT_BYTES;

  let changeSummary: string[];
  if (!last) {
    changeSummary = ['Initial version.'];
  } else if (last.contentHash === hash) {
    changeSummary = ['No content changes since the previous version.'];
  } else {
    const previous = await previousContent(last);
    changeSummary = 'prev' in previous ? diffSummary(previous.prev, a) : [`Content changed (previous snapshot content unavailable: ${previous.reason}).`];
  }
  if (!retain) changeSummary = [...changeSummary, `Version content too large to retain (${new TextEncoder().encode(content).length.toLocaleString('en-US')} bytes > ${MAX_VERSION_CONTENT_BYTES.toLocaleString('en-US')}); the next summary will not have field-level detail.`];

  const version: Version = { number: (last?.number ?? a.versions.length) + 1, at, contentHash: hash, changeSummary, ...(retain ? { content } : {}) };
  return { ...a, versions: [...a.versions, version] };
}
