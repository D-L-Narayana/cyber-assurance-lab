import { EVIDENCE_TYPES, ROLES, SEVERITIES } from './types';
import type { Acceptance, Change, ChangeClass, Evidence, EvidenceType, FindingRecord, Identity, Manifest, Policy, RoleName, Severity } from './types';

export const LIMITS = {
  maxBytes: 128 * 1024,
  maxIdentities: 50,
  maxChanges: 500,
  maxEvidence: 60,
  maxAcceptances: 60,
  maxFindingsPerEvidence: 100,
  maxReviewers: 20,
  maxScope: 20,
  maxArtifactChars: 4000,
  maxStringLength: 400,
  maxChangeClasses: 20,
  maxListLength: 1000,
  maxDepth: 6,
} as const;

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const PATHISH = /^[a-z0-9][a-z0-9._\-/]{0,200}$/i;
const GLOB = /^[a-z0-9*][a-z0-9._\-/*]{0,120}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.maxStringLength;
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export const byteLength = (text: string) => new TextEncoder().encode(text).length;

function structuralProblem(root: unknown): string | null {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++visited > 100_000) return 'Document has too many values.';
    if (depth > LIMITS.maxDepth) return `Nesting exceeds ${LIMITS.maxDepth} levels.`;
    if (Array.isArray(value)) {
      if (value.length > LIMITS.maxListLength) return `A list exceeds ${LIMITS.maxListLength} entries.`;
      for (const v of value) stack.push({ value: v, depth: depth + 1 });
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value as object);
      if (keys.length > LIMITS.maxListLength) return `An object exceeds ${LIMITS.maxListLength} keys.`;
      for (const k of keys) stack.push({ value: (value as Record<string, unknown>)[k], depth: depth + 1 });
    } else if (typeof value === 'number' && !Number.isFinite(value)) return 'Numbers must be finite.';
  }
  return null;
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };
export type PolicyResult = { ok: true; policy: Policy } | { ok: false; errors: string[] };

function parseText<T>(text: string, validate: (v: unknown) => T): T | { ok: false; errors: string[] } {
  if (byteLength(text) > LIMITS.maxBytes) return { ok: false, errors: [`Document exceeds ${LIMITS.maxBytes} bytes (UTF-8).`] };
  try {
    return validate(JSON.parse(text));
  } catch {
    return { ok: false, errors: ['Document is not valid JSON.'] };
  }
}
export const parseManifest = (text: string): ManifestResult => parseText(text, validateManifest);
export const parsePolicy = (text: string): PolicyResult => parseText(text, validatePolicy);

export function validateManifest(input: unknown): ManifestResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['Manifest must be a JSON object.'] };
  const structural = structuralProblem(input);
  if (structural) return { ok: false, errors: [structural] };
  if (input.schema !== 'provgate.release/1') errors.push('schema must be "provgate.release/1".');

  const rel = isObj(input.release) ? input.release : {};
  for (const key of ['id', 'name', 'version', 'commit', 'author'] as const) if (!str(rel[key]) || !rel[key]) errors.push(`release.${key} is required.`);
  if (!isoDate(rel.createdAt)) errors.push('release.createdAt must be an ISO-8601 UTC timestamp (…Z).');

  const identities: Identity[] = [];
  const idSet = new Set<string>();
  const rawIds = Array.isArray(input.identities) ? input.identities : [];
  if (rawIds.length === 0 || rawIds.length > LIMITS.maxIdentities) errors.push(`identities must contain 1–${LIMITS.maxIdentities} entries.`);
  for (const i of rawIds.slice(0, LIMITS.maxIdentities)) {
    if (!isObj(i) || !str(i.id) || !ID.test(i.id) || !str(i.label) || !Array.isArray(i.roles) || !i.roles.every((r) => oneOf(ROLES, r))) { errors.push('identity entries need id, label and roles from the known set.'); continue; }
    if (idSet.has(i.id)) errors.push(`duplicate identity ${i.id}.`);
    idSet.add(i.id);
    identities.push({ id: i.id, label: i.label, roles: [...new Set(i.roles as RoleName[])] });
  }
  const knownOrSystem = (id: unknown): id is string => str(id) && (idSet.has(id) || id === 'ci-runner');
  if (str(rel.author) && !idSet.has(rel.author)) errors.push(`release.author ${rel.author} is not a listed identity.`);

  const changes: Change[] = [];
  const rawChanges = Array.isArray(input.changes) ? input.changes : [];
  if (rawChanges.length > LIMITS.maxChanges) errors.push(`changes exceeds ${LIMITS.maxChanges} entries.`);
  for (const c of rawChanges.slice(0, LIMITS.maxChanges)) {
    if (!isObj(c) || !str(c.path) || !PATHISH.test(c.path) || c.path.includes('..') || !oneOf(['added', 'modified', 'deleted'] as const, c.kind)) { errors.push('change entries need a relative path and kind added|modified|deleted.'); continue; }
    changes.push({ path: c.path, kind: c.kind });
  }

  const evidence: Evidence[] = [];
  const evidenceIds = new Set<string>();
  const findingIds = new Set<string>();
  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (rawEvidence.length > LIMITS.maxEvidence) errors.push(`evidence exceeds ${LIMITS.maxEvidence} entries.`);
  for (const e of rawEvidence.slice(0, LIMITS.maxEvidence)) {
    if (!isObj(e) || !str(e.id) || !ID.test(e.id) || !oneOf(EVIDENCE_TYPES, e.type) || !isoDate(e.producedAt) || !str(e.commit) || !ID.test(e.commit)) { errors.push('evidence entries need id, known type, ISO producedAt and commit.'); continue; }
    if (evidenceIds.has(e.id)) errors.push(`duplicate evidence id ${e.id}.`);
    evidenceIds.add(e.id);
    if (!knownOrSystem(e.producedBy)) errors.push(`evidence ${e.id} producedBy must be a listed identity or "ci-runner".`);
    const item: Evidence = { id: e.id, type: e.type as EvidenceType, producedAt: e.producedAt, commit: e.commit, producedBy: String(e.producedBy) };
    if (e.result !== undefined) { if (oneOf(['pass', 'warn', 'fail'] as const, e.result)) item.result = e.result; else errors.push(`evidence ${e.id} result must be pass|warn|fail.`); }
    if (e.reviewers !== undefined) {
      if (!Array.isArray(e.reviewers) || e.reviewers.length > LIMITS.maxReviewers) errors.push(`evidence ${e.id} reviewers must be a short list.`);
      else { for (const r of e.reviewers) if (!str(r) || !idSet.has(r)) errors.push(`evidence ${e.id} reviewer ${String(r)} is not a listed identity.`); item.reviewers = (e.reviewers as unknown[]).filter(str); }
    }
    if (e.scope !== undefined) {
      if (!Array.isArray(e.scope) || e.scope.length > LIMITS.maxScope || !e.scope.every((g) => str(g) && GLOB.test(g))) errors.push(`evidence ${e.id} scope must be a short list of globs.`);
      else item.scope = [...(e.scope as string[])];
    }
    if (e.artifact !== undefined) { if (typeof e.artifact === 'string' && e.artifact.length <= LIMITS.maxArtifactChars) item.artifact = e.artifact; else errors.push(`evidence ${e.id} artifact must be text up to ${LIMITS.maxArtifactChars} characters.`); }
    if (e.artifactHash !== undefined) { if (typeof e.artifactHash === 'string' && HEX64.test(e.artifactHash)) item.artifactHash = e.artifactHash.toLowerCase(); else errors.push(`evidence ${e.id} artifactHash must be 64 hex characters (SHA-256).`); }
    if (e.findings !== undefined) {
      if (!Array.isArray(e.findings) || e.findings.length > LIMITS.maxFindingsPerEvidence) { errors.push(`evidence ${e.id} findings list too long.`); }
      else {
        const list: FindingRecord[] = [];
        for (const f of e.findings) {
          if (!isObj(f) || !str(f.id) || !ID.test(f.id) || !str(f.title) || !oneOf(SEVERITIES, f.severity) || !oneOf(['open', 'fixed', 'accepted'] as const, f.status)) { errors.push(`evidence ${e.id} has a malformed finding.`); continue; }
          if (findingIds.has(f.id)) errors.push(`finding id ${f.id} appears in more than one evidence item; finding ids must be unique per manifest.`);
          findingIds.add(f.id);
          list.push({ id: f.id, title: f.title, severity: f.severity as Severity, status: f.status });
        }
        item.findings = list;
      }
    }
    evidence.push(item);
  }

  const acceptances: Acceptance[] = [];
  const rawAcc = Array.isArray(input.acceptances) ? input.acceptances : [];
  if (rawAcc.length > LIMITS.maxAcceptances) errors.push(`acceptances exceeds ${LIMITS.maxAcceptances} entries.`);
  const accIds = new Set<string>();
  for (const a of rawAcc.slice(0, LIMITS.maxAcceptances)) {
    if (!isObj(a) || !str(a.id) || !ID.test(a.id) || !str(a.findingRef) || !str(a.approvedBy) || !isoDate(a.approvedAt) || !isoDate(a.expiresAt) || !str(a.rationale)) { errors.push('acceptance entries need id, findingRef, approvedBy, ISO approvedAt/expiresAt and rationale.'); continue; }
    if (!idSet.has(a.approvedBy)) errors.push(`acceptance ${a.id} approvedBy ${a.approvedBy} is not a listed identity.`);
    if (accIds.has(a.id)) errors.push(`duplicate acceptance id ${a.id}.`);
    accIds.add(a.id);
    acceptances.push({ id: a.id, findingRef: a.findingRef, approvedBy: a.approvedBy, approvedAt: a.approvedAt, expiresAt: a.expiresAt, rationale: a.rationale });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schema: 'provgate.release/1',
      release: { id: rel.id as string, name: rel.name as string, version: rel.version as string, commit: rel.commit as string, author: rel.author as string, createdAt: rel.createdAt as string },
      identities, changes, evidence, acceptances,
    },
  };
}

export function validatePolicy(input: unknown): PolicyResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['Policy must be a JSON object.'] };
  const structural = structuralProblem(input);
  if (structural) return { ok: false, errors: [structural] };
  if (input.schema !== 'provgate.policy/1') errors.push('schema must be "provgate.policy/1".');
  if (!str(input.name) || !input.name) errors.push('name is required.');
  const num = (v: unknown, key: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) { errors.push(`${key} must be an integer between ${min} and ${max}.`); return min; }
    return v;
  };
  const typeList = (v: unknown, key: string): EvidenceType[] => {
    if (!Array.isArray(v) || !v.every((t) => oneOf(EVIDENCE_TYPES, t))) { errors.push(`${key} must list known evidence types (${EVIDENCE_TYPES.join(', ')}).`); return []; }
    return [...new Set(v as EvidenceType[])];
  };
  const maxEvidenceAgeDays = num(input.maxEvidenceAgeDays, 'maxEvidenceAgeDays', 1, 365);
  const requireSameCommit = typeList(input.requireSameCommit, 'requireSameCommit');
  const baseline = typeList(input.baseline, 'baseline');
  const minReviewers = num(input.minReviewers, 'minReviewers', 0, 10);
  if (!oneOf(ROLES, input.reviewerRole)) errors.push('reviewerRole must be a known role.');
  const changeClasses: ChangeClass[] = [];
  const rawClasses = Array.isArray(input.changeClasses) ? input.changeClasses : [];
  if (rawClasses.length > LIMITS.maxChangeClasses) errors.push(`changeClasses exceeds ${LIMITS.maxChangeClasses}.`);
  for (const c of rawClasses.slice(0, LIMITS.maxChangeClasses)) {
    if (!isObj(c) || !str(c.id) || !ID.test(c.id) || !str(c.label) || !Array.isArray(c.match) || !c.match.every((g) => str(g) && GLOB.test(g))) { errors.push('changeClasses entries need id, label and match globs.'); continue; }
    const cls: ChangeClass = { id: c.id, label: c.label, match: [...(c.match as string[])], requires: typeList(c.requires, `changeClasses.${c.id}.requires`) };
    if (c.minReviewers !== undefined) cls.minReviewers = num(c.minReviewers, `changeClasses.${c.id}.minReviewers`, 0, 10);
    changeClasses.push(cls);
  }
  if (!oneOf(SEVERITIES, input.blockOnOpenFindingsAtOrAbove)) errors.push('blockOnOpenFindingsAtOrAbove must be a known severity.');
  const acc = isObj(input.acceptance) ? input.acceptance : {};
  if (!oneOf(ROLES, acc.approverRole)) errors.push('acceptance.approverRole must be a known role.');
  const maxDays = num(acc.maxDays, 'acceptance.maxDays', 1, 730);
  if (typeof acc.approverMayBeAuthor !== 'boolean') errors.push('acceptance.approverMayBeAuthor must be boolean.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    policy: {
      schema: 'provgate.policy/1', name: input.name as string, maxEvidenceAgeDays, requireSameCommit, baseline, minReviewers,
      reviewerRole: input.reviewerRole as RoleName, changeClasses, blockOnOpenFindingsAtOrAbove: input.blockOnOpenFindingsAtOrAbove as Severity,
      acceptance: { approverRole: acc.approverRole as RoleName, maxDays, approverMayBeAuthor: acc.approverMayBeAuthor as boolean },
    },
  };
}
