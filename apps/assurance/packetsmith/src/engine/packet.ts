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
  if (reasons.length) throw new TransitionError(reasons);
  const entry: HistoryEntry = { at, from: packet.state, to, actor: who, note: note.trim() };
  return { ...packet, state: to, history: [...packet.history, entry] };
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
  lines.push(`- Packet digest (SHA-256 over canonical content): \`${packetDigest(packet)}\``);
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
  if (packet.history.length === 0) lines.push('No transitions yet.');
  for (const h of packet.history) lines.push(`- ${h.at}: ${h.from} → ${h.to} by ${h.actor}${h.note ? ` — ${h.note}` : ''}`);
  lines.push('');
  lines.push('Determination statements in this packet are paraphrased for teaching and are not the authoritative SP 800-53A procedures.');
  return lines.join('\n');
}
