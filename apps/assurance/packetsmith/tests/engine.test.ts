import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/engine/sha256';
import { CATALOG } from '../src/engine/catalog';
import {
  controlStatus,
  completeness,
  transition,
  TransitionError,
  packetDigest,
  memoMarkdown,
  makeArtifact,
  verifyArtifacts,
  assertEditable,
  emptyPacket,
} from '../src/engine/packet';
import { validatePacket, MAX_PACKET_BYTES } from '../src/engine/validate';
import type { Packet, Step, DeterminationResult, Finding } from '../src/engine/types';

const AS_OF = '2026-10-01';

describe('sha256', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('hashes UTF-8 bytes (multi-byte and long inputs) identically to node:crypto', () => {
    for (const input of ['é', 'naïve café — ☃ 𝄞', 'x'.repeat(1000), 'y'.repeat(64), 'z'.repeat(55), 'w'.repeat(56)]) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });
  it('agrees with WebCrypto when available', async () => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return;
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode('packetsmith'));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(sha256Hex('packetsmith')).toBe(hex);
  });
});

function base(): Packet {
  const p = emptyPacket({ systemName: 'Dispatch Portal (synthetic)', assessor: 'a.mensah', approver: 'p.lindqvist', asOf: AS_OF });
  p.selectedControls = ['AC-2'];
  return p;
}

function step(partial: Partial<Step> & { id: string }): Step {
  return { controlId: 'AC-2', method: 'examine', object: 'Account policy', status: 'performed', evidenceIds: ['ART-1'], notes: '', ...partial };
}

function det(partial: Partial<DeterminationResult> & { determinationId: string }): DeterminationResult {
  return { controlId: 'AC-2', result: 'satisfied', stepIds: ['S1'], rationale: 'Observed.', ...partial };
}

function finding(partial: Partial<Finding> = {}): Finding {
  return {
    id: 'F-1',
    controlId: 'AC-2',
    determinationId: 'AC-2.h',
    description: 'Two leavers still enabled after 30 days.',
    severity: 'moderate',
    action: { description: 'Disable and add leaver feed.', owner: 'it.ops', dueOn: '2026-11-15', status: 'open' },
    ...partial,
  };
}

/** A packet for AC-2 that satisfies every completeness rule. */
function complete(): Packet {
  const p = base();
  p.artifacts = [makeArtifact({ id: 'ART-1', name: 'Policy excerpt', kind: 'document-excerpt', content: 'Accounts: ...', capturedOn: '2026-09-20' })];
  p.steps = [step({ id: 'S1' }), step({ id: 'S2', method: 'interview', object: 'Admin', evidenceIds: ['ART-1'] })];
  p.determinations = CATALOG.find((c) => c.id === 'AC-2')!.determinations.map((d) => det({ determinationId: d.id }));
  return p;
}

describe('catalog', () => {
  it('has 12 unique controls with 2–3 paraphrased determinations and all three methods each', () => {
    expect(CATALOG.length).toBe(12);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(12);
    for (const c of CATALOG) {
      expect(c.determinations.length).toBeGreaterThanOrEqual(2);
      expect(c.determinations.length).toBeLessThanOrEqual(3);
      expect(c.objects.examine.length).toBeGreaterThan(0);
      expect(c.objects.interview.length).toBeGreaterThan(0);
      expect(c.objects.test.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^[A-Z]{2}-\d+$/);
    }
  });
});

describe('artifacts and integrity', () => {
  it('makeArtifact computes the hash of the content', () => {
    const a = makeArtifact({ id: 'A', name: 'n', kind: 'log-excerpt', content: 'abc', capturedOn: AS_OF });
    expect(a.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('verifyArtifacts reports tampered content as a mismatch', () => {
    const a = makeArtifact({ id: 'A', name: 'n', kind: 'log-excerpt', content: 'abc', capturedOn: AS_OF });
    const tampered = { ...a, content: 'abd' };
    const r = verifyArtifacts([a, tampered]);
    expect(r.get('A')).toBe(false); // last one wins in a map keyed by id — duplicate ids are a validation matter
    expect(verifyArtifacts([a]).get('A')).toBe(true);
  });
});

describe('control status rollup', () => {
  it('is not-assessed with no results, in-progress when some are missing', () => {
    const p = base();
    expect(controlStatus(p, 'AC-2')).toBe('not-assessed');
    p.determinations = [det({ determinationId: 'AC-2.a' })];
    expect(controlStatus(p, 'AC-2')).toBe('in-progress');
  });
  it('is satisfied only when every determination is satisfied; any other-than-satisfied dominates', () => {
    const p = complete();
    expect(controlStatus(p, 'AC-2')).toBe('satisfied');
    p.determinations[2] = det({ determinationId: 'AC-2.h', result: 'other-than-satisfied' });
    expect(controlStatus(p, 'AC-2')).toBe('other-than-satisfied');
  });
  it('treats a not-assessed result as missing', () => {
    const p = complete();
    p.determinations[0] = det({ determinationId: 'AC-2.a', result: 'not-assessed' });
    expect(controlStatus(p, 'AC-2')).toBe('in-progress');
  });
});

describe('completeness gate', () => {
  it('passes a complete packet with no blockers', () => {
    expect(completeness(complete())).toEqual([]);
  });
  it('requires at least one performed step per selected control', () => {
    const p = complete();
    p.steps = p.steps.map((s) => ({ ...s, status: 'planned' as const }));
    expect(completeness(p).some((b) => /no performed step/i.test(b.message))).toBe(true);
  });
  it('requires every determination to have a result that is not not-assessed', () => {
    const p = complete();
    p.determinations.pop();
    expect(completeness(p).some((b) => b.ref === 'AC-2.h' && /no result/i.test(b.message))).toBe(true);
  });
  it('requires each result to cite a performed step with evidence', () => {
    const p = complete();
    p.determinations[0] = det({ determinationId: 'AC-2.a', stepIds: [] });
    expect(completeness(p).some((b) => b.ref === 'AC-2.a' && /cite/i.test(b.message))).toBe(true);
    p.determinations[0] = det({ determinationId: 'AC-2.a', stepIds: ['S1'] });
    p.steps[0] = step({ id: 'S1', evidenceIds: [] });
    expect(completeness(p).some((b) => b.ref === 'S1' && /evidence/i.test(b.message))).toBe(true);
  });
  it('requires an other-than-satisfied result to have a finding with owner and a due date not in the past', () => {
    const p = complete();
    p.determinations[2] = det({ determinationId: 'AC-2.h', result: 'other-than-satisfied' });
    expect(completeness(p).some((b) => b.ref === 'AC-2.h' && /finding/i.test(b.message))).toBe(true);
    p.findings = [finding({ action: { description: 'x', owner: '', dueOn: '2026-01-01', status: 'open' } })];
    const bl = completeness(p);
    expect(bl.some((b) => b.ref === 'F-1' && /owner/i.test(b.message))).toBe(true);
    expect(bl.some((b) => b.ref === 'F-1' && /due/i.test(b.message))).toBe(true);
    p.findings = [finding()];
    expect(completeness(p)).toEqual([]);
  });
  it('requires skipped steps to have a reason and flags tampered or missing artifacts', () => {
    const p = complete();
    p.steps.push(step({ id: 'S3', method: 'test', status: 'skipped', evidenceIds: [] }));
    expect(completeness(p).some((b) => b.ref === 'S3' && /reason/i.test(b.message))).toBe(true);
    p.steps[2].skipReason = 'Test environment unavailable; compensated by examine of job logs.';
    p.artifacts[0] = { ...p.artifacts[0], content: 'changed after hashing' };
    expect(completeness(p).some((b) => b.ref === 'ART-1' && /hash/i.test(b.message))).toBe(true);
    p.artifacts = [];
    expect(completeness(p).some((b) => b.ref === 'S1' && /unknown artifact/i.test(b.message))).toBe(true);
  });
  it('flags a finding whose determination is actually satisfied as stale', () => {
    const p = complete();
    p.findings = [finding()];
    expect(completeness(p).some((b) => b.ref === 'F-1' && /satisfied/i.test(b.message))).toBe(true);
  });
});

describe('packet state machine', () => {
  it('drafting → ready-for-review only when complete, by the assessor', () => {
    const p = complete();
    p.steps[0].status = 'planned';
    expect(() => transition(p, 'ready-for-review', 'a.mensah', 'done', AS_OF)).toThrow(TransitionError);
    const ok = transition(complete(), 'ready-for-review', 'a.mensah', 'Submitted', AS_OF);
    expect(ok.state).toBe('ready-for-review');
    expect(ok.history.at(-1)).toMatchObject({ from: 'drafting', to: 'ready-for-review', actor: 'a.mensah' });
  });
  it('ready-for-review → approved requires the named approver who is not the assessor', () => {
    const p = transition(complete(), 'ready-for-review', 'a.mensah', 'Submitted', AS_OF);
    expect(() => transition(p, 'approved', 'a.mensah', '', AS_OF)).toThrow(/separation of duties|approver/i);
    expect(() => transition(p, 'approved', 'someone.else', '', AS_OF)).toThrow(/approver/i);
    expect(transition(p, 'approved', 'p.lindqvist', 'Approved', AS_OF).state).toBe('approved');
  });
  it('ready-for-review → returned requires a note and returned → drafting reopens editing', () => {
    const p = transition(complete(), 'ready-for-review', 'a.mensah', 'Submitted', AS_OF);
    expect(() => transition(p, 'returned', 'p.lindqvist', '   ', AS_OF)).toThrow(/note/i);
    const r = transition(p, 'returned', 'p.lindqvist', 'AC-2.h evidence is a screenshot description only; perform the test.', AS_OF);
    expect(r.state).toBe('returned');
    expect(() => assertEditable(r)).not.toThrow();
    const d = transition(r, 'drafting', 'a.mensah', 'Reopened', AS_OF);
    expect(d.state).toBe('drafting');
  });
  it('approved packets are immutable: no edits, no transitions', () => {
    const p = transition(transition(complete(), 'ready-for-review', 'a.mensah', 'x', AS_OF), 'approved', 'p.lindqvist', 'ok', AS_OF);
    expect(() => assertEditable(p)).toThrow(/approved/i);
    expect(() => transition(p, 'drafting', 'a.mensah', 'reopen', AS_OF)).toThrow(TransitionError);
  });
  it('rejects undefined transitions and lists reasons', () => {
    try {
      transition(complete(), 'approved', 'p.lindqvist', '', AS_OF);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      expect((e as TransitionError).reasons.length).toBeGreaterThan(0);
    }
  });
  it('does not mutate the input packet', () => {
    const p = complete();
    const snapshot = JSON.stringify(p);
    transition(p, 'ready-for-review', 'a.mensah', 'x', AS_OF);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('digest and memo', () => {
  it('digest is stable across key order and changes when any artifact content changes', () => {
    const p = complete();
    const d1 = packetDigest(p);
    const reordered = JSON.parse(JSON.stringify({ ...p, meta: { asOf: p.meta.asOf, approver: p.meta.approver, assessor: p.meta.assessor, systemName: p.meta.systemName } }));
    expect(packetDigest(reordered)).toBe(d1);
    p.artifacts[0] = makeArtifact({ ...p.artifacts[0], content: 'different' });
    expect(packetDigest(p)).not.toBe(d1);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('memo lists control status, findings and the packet digest and labels the subset honestly', () => {
    const p = complete();
    p.determinations[2] = det({ determinationId: 'AC-2.h', result: 'other-than-satisfied' });
    p.findings = [finding()];
    const memo = memoMarkdown(p);
    expect(memo).toContain('AC-2');
    expect(memo).toContain('other-than-satisfied');
    expect(memo).toContain('F-1');
    expect(memo).toContain(packetDigest(p));
    expect(memo).toMatch(/educational/i);
    expect(memo).toMatch(/not .*(FedRAMP|federal|authorization)/i);
    expect(memo).toContain('SP 800-53 Rev. 5');
  });
});

describe('import validation', () => {
  it('accepts a complete packet round-tripped through JSON', () => {
    const r = validatePacket(JSON.stringify(complete()));
    expect(r.ok).toBe(true);
  });
  it('rejects oversized input measured in UTF-8 bytes', () => {
    expect(validatePacket('€'.repeat(Math.ceil(MAX_PACKET_BYTES / 3) + 1)).ok).toBe(false);
  });
  it('rejects unknown control ids, unknown determination ids and bad methods with paths', () => {
    const p = complete();
    p.selectedControls = ['ZZ-9'];
    p.determinations[0].determinationId = 'AC-2.z';
    (p.steps[0] as unknown as { method: string }).method = 'guess';
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.path === 'selectedControls[0]')).toBe(true);
      expect(r.issues.some((i) => i.path === 'determinations[0].determinationId')).toBe(true);
      expect(r.issues.some((i) => i.path === 'steps[0].method')).toBe(true);
    }
  });
  it('rejects a malformed sha256, duplicate ids and an unknown state', () => {
    const p = complete();
    p.artifacts[0].sha256 = 'nothex';
    p.steps.push({ ...p.steps[0] });
    (p as unknown as { state: string }).state = 'shipped';
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const m = r.issues.map((i) => i.message).join('|');
      expect(m).toMatch(/sha256/);
      expect(m).toMatch(/duplicate/i);
      expect(m).toMatch(/state/);
    }
  });
  it('rejects more than 400 steps or 300 artifacts and content over 20000 characters', () => {
    const p = complete();
    p.steps = Array.from({ length: 401 }, (_, i) => step({ id: 'S' + i }));
    expect(validatePacket(JSON.stringify(p)).ok).toBe(false);
    const q = complete();
    q.artifacts[0] = makeArtifact({ ...q.artifacts[0], content: 'x'.repeat(20001) });
    expect(validatePacket(JSON.stringify(q)).ok).toBe(false);
  });
  it('does not throw on non-object JSON', () => {
    expect(validatePacket('[1,2,3]').ok).toBe(false);
    expect(validatePacket('null').ok).toBe(false);
    expect(validatePacket('{').ok).toBe(false);
  });
});

describe('bundled fixture', () => {
  it('validates, is incomplete on purpose, and contains the planned adversarial defects', async () => {
    const demo = (await import('../src/fixtures/dispatch-portal-packet.json')).default;
    const r = validatePacket(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bl = completeness(r.packet);
    const msgs = bl.map((b) => b.message).join('\n');
    expect(msgs).toMatch(/hash/i); // tampered artifact
    expect(msgs).toMatch(/finding/i); // OTS without finding
    expect(msgs).toMatch(/due/i); // past due date
    expect(msgs).toMatch(/reason/i); // skipped without reason
    expect(msgs).toMatch(/unknown artifact/i); // dangling evidence id
    expect(() => transition(r.packet, 'ready-for-review', r.packet.meta.assessor, 'try', r.packet.meta.asOf)).toThrow(TransitionError);
  });
});

describe('sixth-Fable review regressions — separation of duties up front, imported history consistency', () => {
  it('the completeness gate flags assessor == approver as a blocker before anyone tries to approve', () => {
    const p = complete();
    p.meta.approver = p.meta.assessor;
    const b = completeness(p);
    expect(b.some((x) => x.ref === 'meta.approver' && /same person|separation of duties/i.test(x.message))).toBe(true);
    // the explicit SoD demo still works: a distinct approver attempting to approve as the assessor is refused at the transition
    const q = complete();
    expect(() => transition(q, 'ready-for-review', q.meta.assessor, '', '2026-10-02')).not.toThrow();
  });
  it('the validator refuses a packet whose assessor and approver are the same non-empty name', () => {
    const p = complete();
    p.meta.approver = p.meta.assessor;
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'meta.approver' && /assessor/i.test(i.message))).toBe(true);
  });
  it('the validator refuses an imported packet whose history reached approved while its state says otherwise', () => {
    const p = complete();
    p.state = 'drafting';
    p.history = [{ at: '2026-10-02', from: 'ready-for-review', to: 'approved', actor: 'p.lindqvist', note: '' }];
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'state' && /approved/i.test(i.message))).toBe(true);
    // consistent approved packet is accepted
    p.state = 'approved';
    expect(validatePacket(JSON.stringify(p)).ok).toBe(true);
  });
  it('the validator refuses a history whose transitions do not chain (from ≠ previous to, last to ≠ state)', () => {
    const p = complete();
    p.state = 'ready-for-review';
    p.history = [
      { at: '2026-10-02', from: 'drafting', to: 'ready-for-review', actor: 'a', note: '' },
      { at: '2026-10-03', from: 'drafting', to: 'returned', actor: 'b', note: 'x' }, // from does not chain
    ];
    const r = validatePacket(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['history[1].from', 'state']));
  });
});
