import type { Assessment, Blocker, Signature, Version } from './types';
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

/** Hash of the assessable content only: signatures and versions are excluded so they can reference it. */
export function canonicalContent(a: Assessment): string {
  const answers = Object.keys(a.answers).sort().map((k) => [k, a.answers[k]]);
  const mitigations = [...a.mitigations].sort((x, y) => x.mitigationId.localeCompare(y.mitigationId)).map((m) => [m.mitigationId, m.status, m.evidenceRef ?? '', m.owner ?? '']);
  const flows = [...a.flows].sort((x, y) => x.id.localeCompare(y.id)).map((f) => [f.id, f.from, f.to, [...f.dataCategories].sort(), f.outsideOriginRegion, f.mechanism]);
  const acceptances = [...a.acceptances].sort((x, y) => x.theme.localeCompare(y.theme)).map((x) => [x.theme, x.acceptedBy, x.acceptedByName, x.rationale, x.acceptedOn]);
  return JSON.stringify({ id: a.id, title: a.title, owner: a.owner, description: a.description, answers, mitigations, flows, acceptances, dpoConsulted: a.dpoConsulted });
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

function diffSummary(prev: Assessment | undefined, next: Assessment): string[] {
  if (!prev) return ['Initial version.'];
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
  if (JSON.stringify(prev.flows) !== JSON.stringify(next.flows)) out.push('Data flows changed');
  if (JSON.stringify(prev.acceptances) !== JSON.stringify(next.acceptances)) out.push('Risk acceptances changed');
  if (prev.dpoConsulted !== next.dpoConsulted) out.push(`DPO consulted: ${prev.dpoConsulted} → ${next.dpoConsulted}`);
  for (const k of ['title', 'owner', 'description'] as const) if (prev[k] !== next[k]) out.push(`${k} changed`);
  return out.length ? out : ['No content changes since the previous version.'];
}

/**
 * Records a version: number, timestamp, content hash and a change summary relative to the previous
 * snapshot. The previous content is reconstructed from the stored `_content` of the last version when
 * available; otherwise the summary compares hashes only.
 */
export async function snapshot(a: Assessment, at: string): Promise<Assessment> {
  const hash = await contentHash(a);
  const last = a.versions.at(-1);
  const prev = last ? snapshotStore.get(last.contentHash) : undefined;
  const changeSummary = last && !prev ? (last.contentHash === hash ? ['No content changes since the previous version.'] : ['Content changed (previous snapshot content unavailable in this session).']) : diffSummary(prev, a);
  snapshotStore.set(hash, a);
  const version: Version = { number: (last?.number ?? a.versions.length) + 1, at, contentHash: hash, changeSummary };
  return { ...a, versions: [...a.versions, version] };
}

/** In-memory content of snapshots taken this session, keyed by content hash (for diff summaries). */
const snapshotStore = new Map<string, Assessment>();
