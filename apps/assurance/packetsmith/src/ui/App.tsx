import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, CATALOG_VERSION, PROCEDURES_VERSION, SUBSET_LABEL } from '../engine/catalog';
import { assertEditable, completeness, controlStatus, emptyPacket, memoMarkdown, packetDigest, transition, TransitionError, verifyArtifacts } from '../engine/packet';
import { MAX_PACKET_BYTES, validatePacket, validatePacketObject } from '../engine/validate';
import type { Artifact, DeterminationResult, Finding, Packet, PacketState, Step } from '../engine/types';
import demo from '../fixtures/dispatch-portal-packet.json';
import { downloadText, readTextFile } from './files';
import { Worksheet } from './Worksheet';
import { Locker } from './Locker';
import { Gate } from './Gate';
import { MemoView } from './MemoView';

export type Notice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] } | null;

function loadDemo(): Packet {
  const r = validatePacketObject(demo);
  if (!r.ok) throw new Error('Bundled fixture invalid: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.packet;
}

function readHash(): string | null {
  const m = /^#\/([A-Z]{2}-\d+)$/.exec(location.hash);
  return m && CATALOG.some((c) => c.id === m[1]) ? m[1] : null;
}

export default function App() {
  const [packet, setPacket] = useState<Packet>(loadDemo);
  const [selected, setSelected] = useState<string>(() => readHash() ?? 'AC-2');
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded the synthetic Dispatch Portal packet. It is deliberately incomplete: work the gate on the right.' });
  const [memoOpen, setMemoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const blockers = useMemo(() => completeness(packet), [packet]);
  const integrity = useMemo(() => verifyArtifacts(packet.artifacts), [packet.artifacts]);
  const digest = useMemo(() => packetDigest(packet), [packet]);
  const editable = packet.state === 'drafting' || packet.state === 'returned';

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h) setSelected(h);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  function select(id: string) {
    setSelected(id);
    if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
  }

  /** All edits go through here so the immutability rule is enforced in one place. */
  function edit(label: string, fn: (p: Packet) => Packet) {
    try {
      assertEditable(packet);
      const next = fn(packet);
      const check = validatePacketObject(next);
      if (!check.ok) {
        setNotice({ kind: 'error', text: `${label} rejected.`, details: check.issues.map((i) => `${i.path}: ${i.message}`) });
        return;
      }
      setPacket(check.packet);
      setNotice({ kind: 'success', text: label + '.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function doTransition(to: PacketState, actor: string, note: string) {
    try {
      const next = transition(packet, to, actor, note, packet.meta.asOf);
      setPacket(next);
      setNotice({ kind: 'success', text: `Packet moved ${packet.state} → ${to} by ${actor.trim()}.` });
    } catch (e) {
      if (e instanceof TransitionError) setNotice({ kind: 'error', text: `Transition to ${to} refused (${e.reasons.length} reason${e.reasons.length === 1 ? '' : 's'}).`, details: e.reasons });
      else setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_PACKET_BYTES);
      const r = validatePacket(text);
      if (!r.ok) {
        setNotice({ kind: 'error', text: `Import rejected: ${r.issues.length} issue(s). Nothing changed.`, details: r.issues.map((i) => `${i.path || 'packet'} — ${i.message}`) });
        return;
      }
      setPacket(r.packet);
      if (r.packet.selectedControls[0]) select(r.packet.selectedControls[0]);
      setNotice({ kind: 'success', text: `Imported packet for ${r.packet.meta.systemName} (${r.packet.state}).` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const control = CATALOG.find((c) => c.id === selected)!;
  const inScope = packet.selectedControls.includes(selected);
  const stamp = packet.meta.asOf.replace(/-/g, '');

  return (
    <div className="app">
      <a className="skip" href="#worksheet">Skip to worksheet</a>
      <header className="top">
        <div className="brand">
          <h1>Packetsmith</h1>
          <p className="brand__sub">
            Assessment packet builder · {CATALOG_VERSION} · {PROCEDURES_VERSION} · {SUBSET_LABEL}. Educational prototype on synthetic data — not a FedRAMP or federal authorization.
          </p>
        </div>
        <div className="meta">
          <label>
            <span>System</span>
            <input value={packet.meta.systemName} maxLength={200} disabled={!editable} onChange={(e) => edit('Updated system name', (p) => ({ ...p, meta: { ...p.meta, systemName: e.target.value } }))} />
          </label>
          <label>
            <span>Assessor</span>
            <input value={packet.meta.assessor} maxLength={80} disabled={!editable} onChange={(e) => edit('Updated assessor', (p) => ({ ...p, meta: { ...p.meta, assessor: e.target.value } }))} />
          </label>
          <label>
            <span>Approver</span>
            <input value={packet.meta.approver} maxLength={80} disabled={!editable} onChange={(e) => edit('Updated approver', (p) => ({ ...p, meta: { ...p.meta, approver: e.target.value } }))} />
          </label>
          <label>
            <span>Packet date</span>
            <input type="date" value={packet.meta.asOf} disabled={!editable} onChange={(e) => e.target.value && edit('Updated packet date', (p) => ({ ...p, meta: { ...p.meta, asOf: e.target.value } }))} />
          </label>
        </div>
        <div className="actions" role="group" aria-label="Packet actions">
          <button type="button" onClick={() => { setPacket(loadDemo()); select('AC-2'); setNotice({ kind: 'info', text: 'Reloaded the synthetic packet.' }); }}>Load demo packet</button>
          <button type="button" onClick={() => { setPacket(emptyPacket({ systemName: 'New system (synthetic)', assessor: 'assessor', approver: 'approver', asOf: new Date().toISOString().slice(0, 10) })); setNotice({ kind: 'info', text: 'Started an empty packet. Add controls to scope from the index.' }); }}>New packet</button>
          <button type="button" onClick={() => fileRef.current?.click()}>Import packet</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
          <button type="button" onClick={() => downloadText(`packetsmith-${stamp}.json`, JSON.stringify(packet, null, 2))}>Export packet JSON</button>
          <button type="button" onClick={() => downloadText(`packetsmith-memo-${stamp}.md`, memoMarkdown(packet), 'text/markdown')}>Export memo (.md)</button>
          <button type="button" className="primary" onClick={() => setMemoOpen(true)}>Open print memo</button>
        </div>
      </header>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.text}</p>
          {notice.details && (
            <ul>
              {notice.details.slice(0, 15).map((d, i) => <li key={i}>{d}</li>)}
              {notice.details.length > 15 && <li>…and {notice.details.length - 15} more</li>}
            </ul>
          )}
        </div>
      )}

      <div className="bench">
        <nav className="index" aria-label="Control index">
          <h2>Controls</h2>
          <p className="muted small">{packet.selectedControls.length} of {CATALOG.length} in scope</p>
          <ul>
            {CATALOG.map((c) => {
              const scoped = packet.selectedControls.includes(c.id);
              const st = controlStatus(packet, c.id);
              const n = blockers.filter((b) => b.controlId === c.id).length;
              return (
                <li key={c.id}>
                  <button type="button" className={`idx ${selected === c.id ? 'is-selected' : ''} ${scoped ? '' : 'idx--out'}`} aria-pressed={selected === c.id} onClick={() => select(c.id)}>
                    <span className="idx__id">{c.id}</span>
                    <span className="idx__title">{c.title}</span>
                    <span className={`idx__st st--${scoped ? st : 'out'}`}>{scoped ? st : 'not in scope'}</span>
                    {scoped && n > 0 && <span className="idx__n" aria-label={`${n} blockers`}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="sheet" id="worksheet">
          <Worksheet
            key={control.id + packet.state}
            control={control}
            packet={packet}
            inScope={inScope}
            editable={editable}
            integrity={integrity}
            blockers={blockers.filter((b) => b.controlId === control.id)}
            onScope={(on) => edit(on ? `Added ${control.id} to scope` : `Removed ${control.id} from scope`, (p) => ({
              ...p,
              selectedControls: on ? [...p.selectedControls, control.id] : p.selectedControls.filter((x) => x !== control.id),
            }))}
            onStep={(s: Step) => edit(`Saved step ${s.id}`, (p) => ({ ...p, steps: [...p.steps.filter((x) => x.id !== s.id), s] }))}
            onRemoveStep={(id) => edit(`Removed step ${id}`, (p) => ({ ...p, steps: p.steps.filter((x) => x.id !== id), determinations: p.determinations.map((d) => ({ ...d, stepIds: d.stepIds.filter((x) => x !== id) })) }))}
            onResult={(r: DeterminationResult) => edit(`Recorded ${r.determinationId}: ${r.result}`, (p) => ({ ...p, determinations: [...p.determinations.filter((x) => x.determinationId !== r.determinationId), r] }))}
            onFinding={(f: Finding) => edit(`Saved finding ${f.id}`, (p) => ({ ...p, findings: [...p.findings.filter((x) => x.id !== f.id), f] }))}
            onRemoveFinding={(id) => edit(`Removed finding ${id}`, (p) => ({ ...p, findings: p.findings.filter((x) => x.id !== id) }))}
          />
        </main>

        <aside className="side">
          <Gate packet={packet} blockers={blockers} digest={digest} onTransition={doTransition} onJump={select} />
          <Locker
            packet={packet}
            integrity={integrity}
            editable={editable}
            onAdd={(a: Artifact) => edit(`Added artifact ${a.id}`, (p) => ({ ...p, artifacts: [...p.artifacts, a] }))}
            onRemove={(id) => edit(`Removed artifact ${id}`, (p) => ({ ...p, artifacts: p.artifacts.filter((a) => a.id !== id) }))}
          />
        </aside>
      </div>

      <footer className="foot">
        <p>
          Memory-only session; export the packet to keep it. Control identifiers/titles from NIST SP 800-53 Rev. 5; determination statements and assessment objects are paraphrased for teaching (see README). Hashes are SHA-256 over UTF-8 content, computed locally.
        </p>
      </footer>

      {memoOpen && <MemoView packet={packet} digest={digest} blockers={blockers} onClose={() => setMemoOpen(false)} />}
    </div>
  );
}
