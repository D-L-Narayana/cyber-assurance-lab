import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/engine/catalog';
import { sha256Hex } from '../src/engine/sha256';
import { canonical, emptyPacket, GENESIS_PREV_HASH, historyEntryHash, makeArtifact, memoMarkdown, packetDigest, transition, TransitionError, verifyHistoryChain } from '../src/engine/packet';
import { validatePacket } from '../src/engine/validate';
import type { HistoryEntry, Packet } from '../src/engine/types';

// Hash-chained history (October 2026 upgrade round). Each history entry carries
//   prevHash = hash of the previous entry (64 zeros for the first one)
//   hash     = SHA-256(canonical({ at, from, to, actor, note, prevHash }))
// so an exported packet's history is tamper-evident: editing, dropping or reordering an entry breaks the chain.
// It is NOT proof of who acted — there are no keys, so a forger who rewrites every hash still produces a valid chain.

const AS_OF = '2026-10-01';

/** A packet for AC-2 that satisfies every completeness rule (same shape as engine.test.ts). */
function complete(): Packet {
  const p = emptyPacket({ systemName: 'Dispatch Portal (synthetic)', assessor: 'a.mensah', approver: 'p.lindqvist', asOf: AS_OF });
  p.selectedControls = ['AC-2'];
  p.artifacts = [makeArtifact({ id: 'ART-1', name: 'Policy excerpt', kind: 'document-excerpt', content: 'Accounts: ...', capturedOn: '2026-09-20' })];
  p.steps = [
    { id: 'S1', controlId: 'AC-2', method: 'examine', object: 'Account policy', status: 'performed', evidenceIds: ['ART-1'], notes: '' },
    { id: 'S2', controlId: 'AC-2', method: 'interview', object: 'Admin', status: 'performed', evidenceIds: ['ART-1'], notes: '' },
  ];
  p.determinations = CATALOG.find((c) => c.id === 'AC-2')!.determinations.map((d) => ({ controlId: 'AC-2', determinationId: d.id, result: 'satisfied' as const, stepIds: ['S1'], rationale: 'Observed.' }));
  return p;
}

/** drafting → ready-for-review → returned → drafting: three chained entries written by `transition`. */
function threeTransitions(): Packet {
  const a = transition(complete(), 'ready-for-review', 'a.mensah', 'Submitted', '2026-10-01');
  const b = transition(a, 'returned', 'p.lindqvist', 'AC-2.h needs the test step performed.', '2026-10-02');
  return transition(b, 'drafting', 'a.mensah', 'Reopened', '2026-10-03');
}

/** What a pre-chain ("legacy") export looks like: the same entry without prevHash/hash. */
const strip = (h: HistoryEntry): HistoryEntry => ({ at: h.at, from: h.from, to: h.to, actor: h.actor, note: h.note });

describe('hash-chained history — construction by transitions', () => {
  it('writes prevHash/hash on every transition: genesis prevHash is 64 zeros and hash = SHA-256(canonical({at, from, to, actor, note, prevHash}))', () => {
    const p = transition(complete(), 'ready-for-review', 'a.mensah', 'Submitted', AS_OF);
    const h = p.history[0];
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64));
    expect(h.prevHash).toBe(GENESIS_PREV_HASH);
    expect(h.hash).toBe(sha256Hex(canonical({ at: h.at, from: h.from, to: h.to, actor: h.actor, note: h.note, prevHash: GENESIS_PREV_HASH })));
    expect(h.hash).toBe(historyEntryHash(h, GENESIS_PREV_HASH));
    expect(h.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('links each later entry to the previous hash so the whole chain verifies', () => {
    const p = threeTransitions();
    expect(p.history.length).toBe(3);
    expect(p.history[1].prevHash).toBe(p.history[0].hash);
    expect(p.history[2].prevHash).toBe(p.history[1].hash);
    expect(verifyHistoryChain(p)).toEqual({ ok: true, chained: true, brokenAt: null, reason: null });
  });
  it('is deterministic: the same transitions produce the same hashes', () => {
    const a = threeTransitions().history;
    const b = threeTransitions().history;
    expect(a[2].hash).toBeDefined();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('hash-chained history — verification', () => {
  it('detects an edited note at the right (0-based) index', () => {
    const p = threeTransitions();
    p.history[1] = { ...p.history[1], note: 'Looks fine, approving soon.' };
    const v = verifyHistoryChain(p);
    expect(v.ok).toBe(false);
    expect(v.chained).toBe(true);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toMatch(/history\[1\].*hash/);
  });
  it('detects a dropped entry: the entry that follows no longer links to its predecessor', () => {
    const p = threeTransitions();
    p.history = [p.history[0], p.history[2]];
    const v = verifyHistoryChain(p);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toMatch(/prevHash/);
  });
  it('detects reordered entries at the first displaced position', () => {
    const p = threeTransitions();
    p.history = [p.history[1], p.history[0], p.history[2]];
    const v = verifyHistoryChain(p);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
  });
  it('treats a legacy history without any hashes as unchained but not broken', () => {
    const p = threeTransitions();
    p.history = p.history.map(strip);
    expect(verifyHistoryChain(p)).toEqual({ ok: true, chained: false, brokenAt: null, reason: 'history not chained (legacy)' });
  });
  it('treats a mix of hashed and unhashed entries as broken at the first unhashed entry', () => {
    const p = threeTransitions();
    p.history[2] = strip(p.history[2]);
    const v = verifyHistoryChain(p);
    expect(v.ok).toBe(false);
    expect(v.chained).toBe(true);
    expect(v.brokenAt).toBe(2);
    expect(v.reason).toMatch(/history\[2\]/);
  });
  it('reports an empty history as neither chained nor broken', () => {
    expect(verifyHistoryChain(complete())).toMatchObject({ ok: true, chained: false, brokenAt: null });
  });
});

describe('hash-chained history — transitions on legacy and broken chains', () => {
  it('a transition on a legacy packet chains the existing entries in order (retroactively) and appends a linked entry, without mutating the input', () => {
    const legacy = threeTransitions();
    legacy.history = legacy.history.map(strip);
    const snapshot = JSON.stringify(legacy);
    const next = transition(legacy, 'ready-for-review', 'a.mensah', 'Resubmitted', '2026-10-04');
    expect(next.history.length).toBe(4);
    expect(next.history[0].prevHash).toBe(GENESIS_PREV_HASH);
    expect(verifyHistoryChain(next)).toEqual({ ok: true, chained: true, brokenAt: null, reason: null });
    // retroactive chaining adds hashes but does not rewrite what the legacy entries say
    expect(next.history.slice(0, 3).map(strip)).toEqual(legacy.history);
    expect(JSON.stringify(legacy)).toBe(snapshot);
  });
  it('refuses to extend a broken chain and names the break', () => {
    const p = threeTransitions();
    p.history[1] = { ...p.history[1], note: 'edited after the fact' };
    expect(() => transition(p, 'ready-for-review', 'a.mensah', 'x', '2026-10-04')).toThrow(TransitionError);
    expect(() => transition(p, 'ready-for-review', 'a.mensah', 'x', '2026-10-04')).toThrow(/chain/i);
  });
});

describe('hash-chained history — import validation', () => {
  it('a chained packet round-trips through JSON, keeps its hashes and imports without warnings', () => {
    const r = validatePacket(JSON.stringify(threeTransitions()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.packet.history[0].hash).toBeDefined();
      expect(verifyHistoryChain(r.packet).ok).toBe(true);
    }
  });
  it('refuses a chained packet whose history was tampered with, addressing the broken entry', () => {
    const p = threeTransitions();
    p.history[1] = { ...p.history[1], actor: 'a.mensah' }; // the approver's return rewritten to the assessor
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'history[1]' && /hash/.test(i.message))).toBe(true);
  });
  it('imports a legacy (unhashed) history with a warning instead of refusing it', () => {
    const p = threeTransitions();
    p.history = p.history.map(strip);
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => /history not chained \(legacy\)/.test(w))).toBe(true);
      expect(r.packet.history.every((h) => h.hash === undefined && h.prevHash === undefined)).toBe(true);
    }
  });
  it('refuses a mix of hashed and unhashed entries, and a hash that is not 64 hex characters, with paths', () => {
    const p = threeTransitions();
    p.history[2] = strip(p.history[2]);
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'history[2]')).toBe(true);
    const q = threeTransitions();
    q.history[0] = { ...q.history[0], hash: 'nothex' };
    const r2 = validatePacket(JSON.stringify(q));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues.some((i) => i.path === 'history[0].hash')).toBe(true);
  });
  it('refuses an entry that carries only one of prevHash/hash', () => {
    const p = threeTransitions();
    const h0 = p.history[0];
    p.history[0] = { at: h0.at, from: h0.from, to: h0.to, actor: h0.actor, note: h0.note, prevHash: h0.prevHash };
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path.startsWith('history[0]'))).toBe(true);
  });
});

describe('hash-chained history — digest, memo and bundled fixture', () => {
  it('the packet digest still excludes state and history; the memo states the chain status', () => {
    const before = complete();
    const after = threeTransitions();
    expect(packetDigest(after)).toBe(packetDigest(before));
    expect(memoMarkdown(after)).toMatch(/history chain.*verified/i);
    const legacy = { ...after, history: after.history.map(strip) };
    expect(memoMarkdown(legacy)).toMatch(/legacy|not chained/i);
  });
  it('the bundled fixture carries a valid hash chain and still imports without warnings', async () => {
    const demo = (await import('../src/fixtures/dispatch-portal-packet.json')).default;
    const r = validatePacket(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.packet.history.length).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
    expect(verifyHistoryChain(r.packet)).toEqual({ ok: true, chained: true, brokenAt: null, reason: null });
    expect(r.packet.state).toBe('drafting');
  });
});
