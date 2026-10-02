import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';
import { takeSnapshot, diffSnapshots, verifyChain, validateManifest, type FileEntry } from './snapshot';
import { classifyFile, luhnValid } from './classify';
import { decideEgress, DEFAULT_POLICY } from './dlp';
import { emptyLedger, applyEvent } from './ledger';
import { SAMPLE_FILES } from './fixtures';

const f = (path: string, content: string, mode = '0644', owner = 'svc-app'): FileEntry => ({ path, content, mode, owner });

describe('hashing', () => {
  it('matches the SHA-256 test vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('snapshots', () => {
  it('hashes every entry and chains to the previous snapshot', async () => {
    const s1 = await takeSnapshot([f('a.txt', 'one')], null, '2026-10-01T00:00:00Z');
    const s2 = await takeSnapshot([f('a.txt', 'one')], s1, '2026-10-01T01:00:00Z');
    expect(s1.entries[0].hash).toBe(await sha256Hex('one'));
    expect(s1.prevChainHash).toBeNull();
    expect(s2.prevChainHash).toBe(s1.chainHash);
    expect(s2.chainHash).not.toBe(s1.chainHash);
    expect(s2.entries[0].size).toBe(3);
  });
  it('diffs added, removed, modified and permission-only changes', async () => {
    const a = await takeSnapshot([f('keep.txt', 'k'), f('gone.txt', 'g'), f('edit.txt', 'v1'), f('chmod.sh', 'x', '0644')], null, 't0');
    const b = await takeSnapshot([f('keep.txt', 'k'), f('new.txt', 'n'), f('edit.txt', 'v2'), f('chmod.sh', 'x', '0777')], a, 't1');
    const d = diffSnapshots(a, b);
    expect(d.added.map(e => e.path)).toEqual(['new.txt']);
    expect(d.removed.map(e => e.path)).toEqual(['gone.txt']);
    expect(d.modified.map(e => e.path)).toEqual(['edit.txt']);
    expect(d.permissionChanged.map(e => e.path)).toEqual(['chmod.sh']);
    expect(d.unchanged).toBe(1);
  });
  it('detects a tampered entry hash in the chain', async () => {
    const s1 = await takeSnapshot([f('a.txt', 'one')], null, 't0');
    const s2 = await takeSnapshot([f('a.txt', 'two')], s1, 't1');
    expect((await verifyChain([s1, s2])).ok).toBe(true);
    const tampered = { ...s1, entries: [{ ...s1.entries[0], hash: '00'.repeat(32) }] };
    const v = await verifyChain([tampered, s2]);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.brokenAt).toBe(0);
  });
  it('binds takenAt and id into the chain so forged metadata fails verification', async () => {
    const s1 = await takeSnapshot([f('a.txt', 'one')], null, '2026-10-01T08:00:00Z');
    const s2 = await takeSnapshot([f('a.txt', 'two'), f('b.txt', 'three')], s1, '2026-10-01T09:00:00Z');
    expect((await verifyChain([s1, s2])).ok).toBe(true);
    const forgedTime = await verifyChain([{ ...s1, takenAt: '2020-01-01T00:00:00Z' }, s2]);
    expect(forgedTime.ok).toBe(false);
    expect(!forgedTime.ok && forgedTime.brokenAt).toBe(0);
    expect(!forgedTime.ok && forgedTime.reason).toMatch(/takenAt|chain hash/);
    const forgedId = await verifyChain([{ ...s1, id: 'snap-forged' }, s2]);
    expect(forgedId.ok).toBe(false);
    expect(!forgedId.ok && forgedId.reason).toMatch(/id/);
    const reordered = await verifyChain([s1, { ...s2, entries: [...s2.entries].reverse() }]);
    expect(reordered.ok).toBe(false);
  });
  it('rejects "." path segments as well as ".."', () => {
    expect(validateManifest([f('a/./b.txt', 'x')]).ok).toBe(false);
    expect(validateManifest([f('a\\..\\b.txt', 'x')]).ok).toBe(false);
  });
  it('bounds manifest size and rejects traversal paths', () => {
    expect(validateManifest(Array.from({ length: 201 }, (_, i) => f(`f${i}.txt`, 'x'))).ok).toBe(false);
    expect(validateManifest([f('../etc/passwd', 'x')]).ok).toBe(false);
    expect(validateManifest([f('big.txt', 'x'.repeat(70_000))]).ok).toBe(false);
    expect(validateManifest([f('ok.txt', 'x')]).ok).toBe(true);
  });
});

describe('classification', () => {
  it('validates card-like numbers with Luhn so order numbers are not false positives', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });
  it('labels payroll data restricted, a private-key header restricted, source internal and a README public', () => {
    const payroll = classifyFile(f('hr/payroll_q3.csv', 'name,id,pay\nAna Example,123-45-6789,5200\nBo Example,987-65-4321,4800'));
    expect(payroll.label).toBe('restricted');
    expect(payroll.signals.map(s => s.id)).toContain('national-id-pattern');
    const key = classifyFile(f('ops/deploy.pem', '-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC-FIXTURE-NOT-A-KEY\n-----END RSA PRIVATE KEY-----'));
    expect(key.label).toBe('restricted');
    expect(classifyFile(f('src/app.ts', 'export const x = 1;')).label).toBe('internal');
    expect(classifyFile(f('README.md', '# Hello\nPublic docs')).label).toBe('public');
  });
  it('does not treat Luhn-invalid 16-digit order numbers as payment data (false-positive fixture)', () => {
    const c = classifyFile(f('sales/orders.csv', 'order\n4111111111111112\n5500000000000005'));
    expect(c.signals.map(s => s.id)).not.toContain('payment-card');
  });
  it('treats an explicit CONFIDENTIAL marker as confidential', () => {
    expect(classifyFile(f('legal/memo.txt', 'CONFIDENTIAL - internal legal memo')).label).toBe('confidential');
  });
});

describe('DLP decisions', () => {
  const restricted = { label: 'restricted' as const, signals: [] };
  const confidential = { label: 'confidential' as const, signals: [] };
  const pub = { label: 'public' as const, signals: [] };
  it('blocks restricted data on USB and external email', () => {
    const d = decideEgress({ id: 'e1', path: 'hr/payroll.csv', channel: 'usb', actor: 'ana' }, restricted, DEFAULT_POLICY);
    expect(d.decision).toBe('block');
    expect(d.ruleId).toBe('DLP-RESTRICTED-EGRESS');
    expect(d.because.join(' ')).toMatch(/restricted/i);
  });
  it('allows confidential mail to an allowlisted partner domain but quarantines other external domains', () => {
    const ok = decideEgress({ id: 'e2', path: 'legal/memo.txt', channel: 'email_external', actor: 'ana', recipientDomain: 'partner.example' }, confidential, DEFAULT_POLICY);
    expect(ok.decision).toBe('allow');
    const q = decideEgress({ id: 'e3', path: 'legal/memo.txt', channel: 'email_external', actor: 'ana', recipientDomain: 'webmail.example' }, confidential, DEFAULT_POLICY);
    expect(q.decision).toBe('quarantine');
  });
  it('allows public files anywhere and internal files on internal channels', () => {
    expect(decideEgress({ id: 'e4', path: 'README.md', channel: 'cloud_share', actor: 'ana' }, pub, DEFAULT_POLICY).decision).toBe('allow');
    expect(decideEgress({ id: 'e5', path: 'src/a.ts', channel: 'internal_share', actor: 'ana' }, { label: 'internal', signals: [] }, DEFAULT_POLICY).decision).toBe('allow');
  });
});

describe('ledger', () => {
  it('ignores a replayed event id and opens one case per blocked egress with hash evidence', () => {
    let st = emptyLedger();
    const ev = { id: 'evt-1', at: 't0', kind: 'egress' as const, path: 'hr/payroll.csv', hash: 'ab'.repeat(32), decision: 'block' as const, ruleId: 'DLP-RESTRICTED-EGRESS', because: ['restricted'], channel: 'usb', actor: 'ana' };
    st = applyEvent(st, ev);
    st = applyEvent(st, ev);
    expect(st.events).toHaveLength(1);
    expect(st.cases).toHaveLength(1);
    expect(st.cases[0].evidence.hash).toBe('ab'.repeat(32));
    expect(st.replaysRejected).toBe(1);
  });
  it('does not open a case for allowed egress', () => {
    const st = applyEvent(emptyLedger(), { id: 'evt-2', at: 't0', kind: 'egress', path: 'README.md', hash: 'cd'.repeat(32), decision: 'allow', ruleId: 'DLP-PUBLIC', because: [], channel: 'cloud_share', actor: 'ana' });
    expect(st.cases).toHaveLength(0);
  });
});

describe('fixtures', () => {
  it('ship synthetic content only and validate', () => {
    expect(validateManifest(SAMPLE_FILES).ok).toBe(true);
    expect(SAMPLE_FILES.some(x => x.path.includes('payroll'))).toBe(true);
  });
});
