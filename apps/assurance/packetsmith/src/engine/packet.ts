// Packetsmith decision engine: control rollup, completeness gate, state machine, digest and memo.
// Pure functions; inputs are never mutated.
import { CATALOG, CATALOG_VERSION, PROCEDURES_VERSION, SUBSET_LABEL } from './catalog';
import { sha256Hex } from './sha256';
import type { Artifact, Blocker, ControlStatus, Packet, PacketState, HistoryEntry } from './types';

export class TransitionError extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'TransitionError';
    this.reasons = reasons;
  }
}

export function emptyPacket(meta: Packet['meta']): Packet {
  return {
    schema: 'packetsmith.packet/1',
    meta: { ...meta },
    selectedControls: [],
    steps: [],
    artifacts: [],
    determinations: [],
    findings: [],
    state: 'drafting',
    history: [],
  };
}

export function makeArtifact(a: Omit<Artifact, 'sha256'> & { sha256?: string }): Artifact {
  return { id: a.id, name: a.name, kind: a.kind, content: a.content, capturedOn: a.capturedOn, sha256: sha256Hex(a.content) };
}

/** id -> whether the stored hash matches the content. */
export function verifyArtifacts(artifacts: Artifact[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const a of artifacts) m.set(a.id, sha256Hex(a.content) === a.sha256.toLowerCase());
  return m;
}

export function controlStatus(packet: Packet, controlId: string): ControlStatus {
  const control = CATALOG.find((c) => c.id === controlId);
  if (!control) return 'not-assessed';
  const results = control.determinations.map((d) =>
    packet.determinations.find((r) => r.controlId === controlId && r.determinationId === d.id),
  );
  const assessed = results.filter((r) => r && r.result !== 'not-assessed');
  if (assessed.length === 0) return 'not-assessed';
  if (assessed.some((r) => r!.result === 'other-than-satisfied')) return 'other-than-satisfied';
  if (assessed.length < control.determinations.length) return 'in-progress';
  return 'satisfied';
}

/** Every reason the packet cannot move to review. Empty list = complete. */
export function completeness(packet: Packet): Blocker[] {
  const out: Blocker[] = [];
  const integrity = verifyArtifacts(packet.artifacts);
  const artifactIds = new Set(packet.artifacts.map((a) => a.id));
  const asOf = packet.meta.asOf;

  for (const [id, ok] of integrity) {
    if (!ok) out.push({ ref: id, message: `Artifact ${id} content does not match its recorded SHA-256 hash (tampered or edited after capture).` });
  }

  // Separation of duties is checked here, not only at the approve transition, so the packet cannot be assembled into an unapprovable state unnoticed.
  if (packet.meta.assessor.trim() && packet.meta.assessor.trim() === packet.meta.approver.trim()) {
    out.push({ ref: 'meta.approver', message: `Assessor and approver are the same person (${packet.meta.assessor.trim()}); separation of duties requires a different named approver, otherwise the packet can never be approved.` });
  }

  for (const s of packet.steps) {
    if (s.status === 'skipped' && !(s.skipReason && s.skipReason.trim().length >= 10)) {
      out.push({ controlId: s.controlId, ref: s.id, message: `Step ${s.id} is skipped without a substantive reason.` });
    }
    for (const e of s.evidenceIds) {
      if (!artifactIds.has(e)) out.push({ controlId: s.controlId, ref: s.id, message: `Step ${s.id} cites unknown artifact ${e}.` });
    }
  }

  for (const cid of packet.selectedControls) {
    const control = CATALOG.find((c) => c.id === cid);
    if (!control) {
      out.push({ controlId: cid, message: `Control ${cid} is not in the catalog subset.` });
      continue;
    }
    const steps = packet.steps.filter((s) => s.controlId === cid);
    const performed = steps.filter((s) => s.status === 'performed');
    if (performed.length === 0) out.push({ controlId: cid, message: `${cid}: no performed step. Perform at least one examine, interview or test step.` });

    for (const d of control.determinations) {
      const r = packet.determinations.find((x) => x.controlId === cid && x.determinationId === d.id);
      if (!r || r.result === 'not-assessed') {
        out.push({ controlId: cid, ref: d.id, message: `${d.id}: no result recorded.` });
        continue;
      }
      const cited = r.stepIds.map((id) => steps.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && s.status === 'performed');
      if (cited.length === 0) out.push({ controlId: cid, ref: d.id, message: `${d.id}: result must cite at least one performed step for this control.` });
      for (const s of cited) {
        if (s.evidenceIds.length === 0) out.push({ controlId: cid, ref: s.id, message: `Step ${s.id} supports ${d.id} but has no evidence artifact attached.` });
      }
      if (r.result === 'other-than-satisfied') {
        const fs = packet.findings.filter((f) => f.controlId === cid && f.determinationId === d.id);
        if (fs.length === 0) out.push({ controlId: cid, ref: d.id, message: `${d.id} is other-than-satisfied but has no finding with a corrective action.` });
        for (const f of fs) {
          if (!f.action.owner.trim()) out.push({ controlId: cid, ref: f.id, message: `Finding ${f.id}: corrective action has no owner.` });
          if (f.action.status !== 'completed' && f.action.dueOn < asOf) out.push({ controlId: cid, ref: f.id, message: `Finding ${f.id}: due date ${f.action.dueOn} is before the packet date ${asOf}.` });
        }
      }
    }
  }

  for (const f of packet.findings) {
    const r = packet.determinations.find((x) => x.controlId === f.controlId && x.determinationId === f.determinationId);
    if (r && r.result === 'satisfied') {
      out.push({ controlId: f.controlId, ref: f.id, message: `Finding ${f.id} points at ${f.determinationId}, which is recorded as satisfied — resolve the finding or the result.` });
    }
  }
  return out;
}

export function assertEditable(packet: Packet): void {
  if (packet.state === 'approved') throw new Error('This packet is approved and immutable. Export it, or start a new packet.');
  if (packet.state === 'ready-for-review') throw new Error('This packet is awaiting review. Return it to drafting before editing.');
}

const ALLOWED: Record<PacketState, PacketState[]> = {
  drafting: ['ready-for-review'],
  'ready-for-review': ['approved', 'returned'],
  returned: ['drafting'],
  approved: [],
};

export function transition(packet: Packet, to: PacketState, actor: string, note: string, at: string): Packet {
  const reasons: string[] = [];
  if (!ALLOWED[packet.state].includes(to)) {
    reasons.push(`No transition from ${packet.state} to ${to}.`);
    throw new TransitionError(reasons);
  }
  const who = actor.trim();
  if (!who) reasons.push('An actor is required.');
  if (to === 'ready-for-review') {
    if (who !== packet.meta.assessor) reasons.push(`Only the assessor (${packet.meta.assessor}) can submit for review.`);
    const blockers = completeness(packet);
    for (const b of blockers) reasons.push(b.message);
  }
  if (to === 'approved') {
    if (who === packet.meta.assessor) reasons.push('Separation of duties: the assessor cannot approve their own packet.');
    else if (who !== packet.meta.approver) reasons.push(`Only the named approver (${packet.meta.approver}) can approve.`);
  }
  if (to === 'returned' && note.trim().length === 0) reasons.push('A return note explaining what to fix is required.');
  const chain = verifyHistoryChain(packet);
  if (!chain.ok) reasons.push(`History chain is broken at #${(chain.brokenAt ?? 0) + 1} (${chain.reason}); refusing to extend a tampered history.`);
  if (reasons.length) throw new TransitionError(reasons);
  // A legacy (unhashed) history is chained retroactively here: the chain then vouches for those entries as they stand now, not for their past.
  const prior = chain.chained ? packet.history : chainHistory(packet.history);
  const prevHash = prior.at(-1)?.hash ?? GENESIS_PREV_HASH;
  const body = { at, from: packet.state, to, actor: who, note: note.trim() };
  const entry: HistoryEntry = { ...body, prevHash, hash: historyEntryHash(body, prevHash) };
  return { ...packet, state: to, history: [...prior, entry] };
}

// ---- Hash-chained history (October 2026 upgrade round) ----
// Every transition appends an entry whose `hash` is SHA-256 over the canonical JSON of {at, from, to, actor, note, prevHash},
// where prevHash is the previous entry's hash (64 zeros for the first). Editing, dropping, inserting or reordering an entry
// of an exported packet breaks the chain. This is tamper-EVIDENCE for the record, not proof of who acted: there is no key
// material, so anyone can recompute every hash and produce a consistent forgery.

/** prevHash of the first chained history entry. */
export const GENESIS_PREV_HASH = '0'.repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;

export interface ChainVerification {
  ok: boolean; // false only when the chain is broken
  chained: boolean; // true when the entries carry hashes
  brokenAt: number | null; // 0-based history index of the first entry that fails, or null
  reason: string | null; // null when ok and chained; 'history not chained (legacy)' for unhashed histories
}

/** SHA-256 (hex, lower-case) over canonical({ at, from, to, actor, note, prevHash }). */
export function historyEntryHash(e: Pick<HistoryEntry, 'at' | 'from' | 'to' | 'actor' | 'note'>, prevHash: string): string {
  return sha256Hex(canonical({ at: e.at, from: e.from, to: e.to, actor: e.actor, note: e.note, prevHash }));
}

/** Hash every entry in order. Used when a legacy (unhashed) history receives its first chained transition. Input is not mutated. */
export function chainHistory(history: HistoryEntry[]): HistoryEntry[] {
  let prev = GENESIS_PREV_HASH;
  return history.map((h) => {
    const hash = historyEntryHash(h, prev);
    const entry: HistoryEntry = { at: h.at, from: h.from, to: h.to, actor: h.actor, note: h.note, prevHash: prev, hash };
    prev = hash;
    return entry;
  });
}

export function verifyHistoryChain(packet: Pick<Packet, 'history'>): ChainVerification {
  const history = packet.history;
  if (history.length === 0) return { ok: true, chained: false, brokenAt: null, reason: null };
  if (!history.some((h) => h.hash !== undefined || h.prevHash !== undefined)) return { ok: true, chained: false, brokenAt: null, reason: 'history not chained (legacy)' };
  let prev = GENESIS_PREV_HASH;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const broken = (reason: string): ChainVerification => ({ ok: false, chained: true, brokenAt: i, reason });
    if (h.hash === undefined || h.prevHash === undefined) return broken(`history[${i}] carries no hash while other entries are hashed (mixed hashed/unhashed history)`);
    const prevHash = h.prevHash.toLowerCase();
    const hash = h.hash.toLowerCase();
    if (!HEX64.test(prevHash) || !HEX64.test(hash)) return broken(`history[${i}] hash fields must be 64 hex characters`);
    if (prevHash !== prev) return broken(i === 0 ? 'history[0].prevHash must be the genesis value (64 zeros)' : `history[${i}].prevHash does not equal the hash of history[${i - 1}] (an entry was dropped, inserted or reordered)`);
    if (historyEntryHash(h, prevHash) !== hash) return broken(`history[${i}] hash does not match its content (at, from, to, actor, note or prevHash was edited)`);
    prev = hash;
  }
  return { ok: true, chained: true, brokenAt: null, reason: null };
}

/** One-line chain status shared by the Gate badge, the print memo and the Markdown memo. */
export function describeChain(packet: Pick<Packet, 'history'>): { kind: 'empty' | 'verified' | 'broken' | 'legacy'; label: string; detail: string } {
  const c = verifyHistoryChain(packet);
  if (packet.history.length === 0) return { kind: 'empty', label: 'no history yet', detail: 'No transitions recorded.' };
  if (!c.chained) return { kind: 'legacy', label: 'legacy history (unchained)', detail: 'These entries predate history hashing and cannot be verified; the next transition will chain them as they stand now.' };
  if (!c.ok) return { kind: 'broken', label: `history chain broken at #${(c.brokenAt ?? 0) + 1}`, detail: c.reason ?? '' };
  return { kind: 'verified', label: 'history chain verified', detail: `${packet.history.length} entr${packet.history.length === 1 ? 'y' : 'ies'} linked by SHA-256; genesis prevHash is 64 zeros.` };
}

/** Canonical JSON: sorted keys, stable arrays. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Digest over everything that carries assessment meaning (artifact content is represented by its hash). */
export function packetDigest(packet: Packet): string {
  const body = {
    meta: packet.meta,
    selectedControls: packet.selectedControls,
    steps: packet.steps,
    artifacts: packet.artifacts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, capturedOn: a.capturedOn, sha256: a.sha256 })),
    determinations: packet.determinations,
    findings: packet.findings,
  };
  return sha256Hex(canonical(body));
}

export function memoMarkdown(packet: Packet): string {
  const lines: string[] = [];
  lines.push(`# Assessment packet memo — ${packet.meta.systemName}`);
  lines.push('');
  lines.push(`Educational prototype output on synthetic data. This memo is not a FedRAMP, federal authorization or any other compliance determination.`);
  lines.push('');
  lines.push(`- Catalog: ${CATALOG_VERSION}`);
  lines.push(`- Procedures: ${PROCEDURES_VERSION}`);
  lines.push(`- Scope: ${SUBSET_LABEL}`);
  lines.push(`- Assessor: ${packet.meta.assessor} · Approver: ${packet.meta.approver} · As of: ${packet.meta.asOf}`);
  lines.push(`- Packet state: ${packet.state}`);
  lines.push(`- Packet digest (SHA-256 over canonical content; excludes state and history): \`${packetDigest(packet)}\``);
  lines.push('');
  lines.push('## Control results');
  lines.push('');
  lines.push('| Control | Title | Status | Determinations | Steps performed | Artifacts |');
  lines.push('|---|---|---|---|---|---|');
  for (const cid of packet.selectedControls) {
    const c = CATALOG.find((x) => x.id === cid);
    if (!c) continue;
    const steps = packet.steps.filter((s) => s.controlId === cid);
    const performed = steps.filter((s) => s.status === 'performed');
    const arts = new Set(performed.flatMap((s) => s.evidenceIds));
    const dets = c.determinations
      .map((d) => {
        const r = packet.determinations.find((x) => x.controlId === cid && x.determinationId === d.id);
        return `${d.id}: ${r?.result ?? 'not-assessed'}`;
      })
      .join('<br>');
    lines.push(`| ${cid} | ${c.title} | ${controlStatus(packet, cid)} | ${dets} | ${performed.length}/${steps.length} | ${arts.size} |`);
  }
  lines.push('');
  lines.push('## Findings and corrective actions');
  lines.push('');
  if (packet.findings.length === 0) lines.push('None recorded.');
  else {
    lines.push('| Finding | Control / determination | Severity | Description | Action | Owner | Due | Status |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const f of packet.findings) {
      lines.push(`| ${f.id} | ${f.controlId} / ${f.determinationId} | ${f.severity} | ${f.description} | ${f.action.description} | ${f.action.owner} | ${f.action.dueOn} | ${f.action.status} |`);
    }
  }
  lines.push('');
  lines.push('## Evidence artifacts');
  lines.push('');
  lines.push('| Artifact | Kind | Captured | SHA-256 |');
  lines.push('|---|---|---|---|');
  for (const a of packet.artifacts) lines.push(`| ${a.id} — ${a.name} | ${a.kind} | ${a.capturedOn} | \`${a.sha256}\` |`);
  lines.push('');
  const blockers = completeness(packet);
  lines.push('## Completeness');
  lines.push('');
  lines.push(blockers.length === 0 ? 'No blockers: the packet satisfies the completeness gate.' : `${blockers.length} blocker(s):`);
  for (const b of blockers) lines.push(`- ${b.message}`);
  lines.push('');
  lines.push('## History');
  lines.push('');
  const chainStatus = describeChain(packet);
  if (packet.history.length === 0) lines.push('No transitions yet.');
  else {
    lines.push(`History chain: ${chainStatus.label} — ${chainStatus.detail} The chain is tamper-evident for this exported record; it does not prove who acted.`);
    lines.push('');
  }
  for (const h of packet.history) lines.push(`- ${h.at}: ${h.from} → ${h.to} by ${h.actor}${h.note ? ` — ${h.note}` : ''}${h.hash ? ` · hash \`${h.hash.slice(0, 12)}…\`` : ''}`);
  lines.push('');
  lines.push('Determination statements in this packet are paraphrased for teaching and are not the authoritative SP 800-53A procedures.');
  return lines.join('\n');
}
