import { useEffect, useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { takeSnapshot, diffSnapshots, verifyChain, validateManifest, LIMITS, type FileEntry, type Snapshot } from './engine/snapshot';
import { classifyFile, type Label } from './engine/classify';
import { decideEgress, DEFAULT_POLICY, CHANNEL_LABEL, RULES, type Channel, type Policy, type DlpResult } from './engine/dlp';
import { emptyLedger, applyEvent, closeCase, type Ledger } from './engine/ledger';
import { SAMPLE_FILES } from './engine/fixtures';
import { sha256Hex } from './engine/hash';

const LABELS: Label[] = ['public', 'internal', 'confidential', 'restricted'];
const short = (h: string) => h.slice(0, 10);
const now = () => new Date().toISOString();

export function App() {
  const [files, setFiles] = useState<FileEntry[]>(SAMPLE_FILES);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger());
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [selectedPath, setSelectedPath] = useState<string>(SAMPLE_FILES[4].path);
  const [draft, setDraft] = useState<string>(SAMPLE_FILES[4].content);
  const [channel, setChannel] = useState<Channel>('email_external');
  const [recipient, setRecipient] = useState('webmail.example');
  const [actor, setActor] = useState('ana.example');
  const [lastDecision, setLastDecision] = useState<(DlpResult & { path: string; hash: string; eventId: string }) | null>(null);
  const [chainStatus, setChainStatus] = useState<string>('No snapshots yet.');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newContent, setNewContent] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [caseNote, setCaseNote] = useState('');
  const [tamper, setTamper] = useState(false);
  const [egressCount, setEgressCount] = useState(0);

  const file = files.find(f => f.path === selectedPath) ?? null;
  useEffect(() => { setDraft(file?.content ?? ''); }, [selectedPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const classifications = useMemo(() => new Map(files.map(f => [f.path, classifyFile(f)])), [files]);
  const cls = file ? classifications.get(file.path)! : null;
  const latest = snaps[snaps.length - 1] ?? null;
  const previous = snaps[snaps.length - 2] ?? null;
  const diff = latest && previous ? diffSnapshots(previous, latest) : null;
  const latestEntry = latest && file ? latest.entries.find(e => e.path === file.path) ?? null : null;
  const dirty = !!file && draft !== file.content;

  async function snapshot() {
    setBusy(true);
    const s = await takeSnapshot(files, latest, now());
    const next = [...snaps, s];
    setSnaps(next);
    if (latest) {
      const d = diffSnapshots(latest, s);
      let led = ledger;
      for (const m of d.modified) led = applyEvent(led, { id: `chg-${s.chainHash.slice(0, 8)}-${m.path}`, at: s.takenAt, kind: 'change', path: m.path, hash: m.after.hash, decision: 'observed', ruleId: 'FIM-MODIFIED', because: [`hash ${short(m.before.hash)}… → ${short(m.after.hash)}…`, `size ${m.before.size} → ${m.after.size} bytes`], actor: 'snapshot' });
      for (const a of d.added) led = applyEvent(led, { id: `add-${s.chainHash.slice(0, 8)}-${a.path}`, at: s.takenAt, kind: 'change', path: a.path, hash: a.hash, decision: 'observed', ruleId: 'FIM-ADDED', because: [`new file, ${a.size} bytes`], actor: 'snapshot' });
      for (const r of d.removed) led = applyEvent(led, { id: `rm-${s.chainHash.slice(0, 8)}-${r.path}`, at: s.takenAt, kind: 'change', path: r.path, hash: r.hash, decision: 'observed', ruleId: 'FIM-REMOVED', because: ['file no longer present'], actor: 'snapshot' });
      for (const p of d.permissionChanged) led = applyEvent(led, { id: `perm-${s.chainHash.slice(0, 8)}-${p.path}`, at: s.takenAt, kind: 'change', path: p.path, hash: p.after.hash, decision: 'observed', ruleId: 'FIM-PERMISSION', because: [`mode ${p.before.mode} → ${p.after.mode}`, `owner ${p.before.owner} → ${p.after.owner}`], actor: 'snapshot' });
      setLedger(led);
      setStatus(`Snapshot ${s.id}: ${d.added.length} added, ${d.removed.length} removed, ${d.modified.length} modified, ${d.permissionChanged.length} permission changes, ${d.unchanged} unchanged.`);
    } else setStatus(`Baseline snapshot ${s.id} with ${s.entries.length} files.`);
    const v = await verifyChain(next);
    setChainStatus(v.ok ? `Chain intact across ${next.length} snapshot${next.length === 1 ? '' : 's'}.` : `Chain broken at #${v.brokenAt}: ${v.reason}`);
    setBusy(false);
  }
  async function verify() {
    const v = await verifyChain(snaps);
    setChainStatus(snaps.length === 0 ? 'No snapshots yet.' : v.ok ? `Chain intact across ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}.` : `Chain broken at #${v.brokenAt}: ${v.reason}`);
    setStatus('Chain verification ran.');
  }
  async function toggleTamper() {
    if (!snaps.length) return;
    if (!tamper) {
      const copy = snaps.map((s, i) => i === 0 ? { ...s, entries: s.entries.map((e, j) => j === 0 ? { ...e, hash: '0'.repeat(64) } : e) } : s);
      setSnaps(copy); setTamper(true); setStatus('Tampered with the first entry hash of snapshot #0 (demo). Run verify.');
    } else {
      // Rebuild the chain honestly from current files is not possible for history; instead restore by recomputing entries from the stored entries is impossible—so we clear the demo tamper by resetting snapshots.
      setSnaps([]); setTamper(false); setLedger(emptyLedger()); setChainStatus('No snapshots yet.'); setStatus('Demo tamper cleared by resetting snapshot history.');
    }
  }
  function saveEdit() {
    if (!file) return;
    if (draft.length > LIMITS.maxContentChars) { setStatus(`Content exceeds ${LIMITS.maxContentChars.toLocaleString()} characters.`); return; }
    setFiles(fs => fs.map(f => f.path === file.path ? { ...f, content: draft } : f));
    setStatus(`Saved edit to ${file.path}. Take a snapshot to record the change.`);
  }
  function changeMode(mode: string) {
    if (!file || !/^0[0-7]{3}$/.test(mode)) return;
    setFiles(fs => fs.map(f => f.path === file.path ? { ...f, mode } : f));
  }
  function removeFile() {
    if (!file) return;
    setFiles(fs => fs.filter(f => f.path !== file.path));
    setSelectedPath(files.find(f => f.path !== file.path)?.path ?? '');
    setStatus(`Removed ${file.path} from the fixture directory.`);
  }
  function addFile() {
    const candidate: FileEntry = { path: newPath.trim(), content: newContent, mode: '0644', owner: 'svc-user' };
    const v = validateManifest([...files, candidate]);
    if (!v.ok) { setAddError(v.errors[0]); return; }
    setFiles(fs => [...fs, candidate]); setSelectedPath(candidate.path); setAddOpen(false); setNewPath(''); setNewContent(''); setAddError(null);
    setStatus(`Added ${candidate.path}.`);
  }
  async function simulateEgress() {
    if (!file || !cls) return;
    const hash = latestEntry?.hash ?? await sha256Hex(file.content);
    const n = egressCount + 1; setEgressCount(n);
    const id = `egress-${n}-${file.path}-${channel}-${recipient}`;
    const result = decideEgress({ id, path: file.path, channel, actor, recipientDomain: channel === 'email_external' ? recipient : undefined }, cls, policy);
    const before = ledger;
    const after = applyEvent(before, { id, at: now(), kind: 'egress', path: file.path, hash, decision: result.decision, ruleId: result.ruleId, because: result.because, channel, actor });
    setLedger(after);
    setLastDecision({ ...result, path: file.path, hash, eventId: id });
    setStatus(after.replaysRejected > before.replaysRejected ? `Replay rejected: event ${id} was already recorded.` : `Egress ${result.decision} by ${result.ruleId}${result.decision !== 'allow' ? ' — case opened' : ''}.`);
  }
  function replayLast() {
    if (!lastDecision) return;
    const before = ledger;
    const after = applyEvent(before, { id: lastDecision.eventId, at: now(), kind: 'egress', path: lastDecision.path, hash: lastDecision.hash, decision: lastDecision.decision, ruleId: lastDecision.ruleId, because: lastDecision.because, channel, actor });
    setLedger(after);
    setStatus(after.replaysRejected > before.replaysRejected ? `Replay rejected: event ${lastDecision.eventId} already in the ledger (${after.replaysRejected} rejected so far).` : 'Event applied.');
  }
  function exportReport() {
    const report = {
      schema: 'hashledger.report/1', generatedAt: now(), tool: 'Hashledger educational FIM/DLP simulator',
      dataNotice: 'Synthetic fixture files hashed in the browser. No host filesystem access, no real egress.',
      policy, summary: { files: files.length, snapshots: snaps.length, events: ledger.events.length, cases: ledger.cases.length, openCases: ledger.cases.filter(c => c.status === 'open').length, replaysRejected: ledger.replaysRejected, chain: chainStatus },
      classifications: files.map(f => ({ path: f.path, ...classifications.get(f.path)! })),
      snapshots: snaps.map(s => ({ id: s.id, takenAt: s.takenAt, prevChainHash: s.prevChainHash, chainHash: s.chainHash, entries: s.entries })),
      events: ledger.events, cases: ledger.cases,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `hashledger-report-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    setStatus('Exported ledger report.');
  }

  return (
    <div className="shell">
      <a className="skip" href="#files">Skip to file list</a>
      <header className="top">
        <div>
          <h1>Hashledger</h1>
          <p className="sub">File-integrity and DLP policy simulator · synthetic fixture directory only · educational prototype</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={snapshot} disabled={busy}>Take snapshot</button>
          <button type="button" className="btn ghost" onClick={verify} disabled={!snaps.length}>Verify chain</button>
          <button type="button" className="btn ghost" onClick={exportReport}>Export JSON</button>
        </div>
      </header>
      <p className="status" role="status" aria-live="polite">{status}</p>

      <section className="rail" aria-label="Snapshot chain" tabIndex={0}>
        <ol className="chain">
          <li className="block genesis"><span className="block-id">genesis</span><span className="block-hash">no previous link</span></li>
          {snaps.map((s, i) => (
            <li key={s.id} className={`block ${tamper && i === 0 ? 'is-tampered' : ''}`}>
              <span className="link" aria-hidden="true">→</span>
              <span className="block-id">{s.id}</span>
              <span className="block-hash" title={s.chainHash}>chain {short(s.chainHash)}…</span>
              <span className="block-meta">{s.entries.length} files · {s.takenAt.slice(11, 19)}Z</span>
            </li>
          ))}
          {snaps.length === 0 && <li className="block hint">Take a baseline snapshot to start the chain.</li>}
        </ol>
        <p className={`chain-status ${chainStatus.startsWith('Chain broken') ? 'bad' : chainStatus.startsWith('Chain intact') ? 'good' : ''}`}>{chainStatus}{snaps.length > 0 && <> · <button type="button" className="linkbtn" onClick={toggleTamper}>{tamper ? 'reset demo' : 'simulate tamper'}</button></>}</p>
      </section>

      <main className="grid">
        <section className="files" id="files" aria-labelledby="files-h">
          <div className="files-head"><h2 id="files-h">Fixture directory</h2>
            <Dialog.Root open={addOpen} onOpenChange={o => { setAddOpen(o); setAddError(null); }}>
              <Dialog.Trigger asChild><button type="button" className="btn ghost small">Add file</button></Dialog.Trigger>
              <Dialog.Portal><Dialog.Overlay className="overlay" />
                <Dialog.Content className="dialog">
                  <Dialog.Title>Add a synthetic file</Dialog.Title>
                  <Dialog.Description className="muted">Relative path (no "..", ≤ {LIMITS.maxPathChars} chars) and content ≤ {LIMITS.maxContentChars.toLocaleString()} characters. Up to {LIMITS.maxFiles} files. Invent the content — never paste real data.</Dialog.Description>
                  <label>Path <input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="team/notes.md" /></label>
                  <label>Content <textarea rows={6} value={newContent} onChange={e => setNewContent(e.target.value)} /></label>
                  {addError && <p role="alert" className="error">{addError}</p>}
                  <div className="row end"><Dialog.Close asChild><button type="button" className="btn ghost">Cancel</button></Dialog.Close><button type="button" className="btn" onClick={addFile}>Add</button></div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
          <ul className="file-list">
            {files.map(f => {
              const c = classifications.get(f.path)!; const e = latest?.entries.find(x => x.path === f.path);
              const changed = diff && (diff.modified.some(m => m.path === f.path) || diff.added.some(a => a.path === f.path) || diff.permissionChanged.some(p => p.path === f.path));
              return (
                <li key={f.path}>
                  <button type="button" className={`file ${f.path === selectedPath ? 'is-selected' : ''}`} aria-pressed={f.path === selectedPath} onClick={() => setSelectedPath(f.path)}>
                    <span className="file-path">{f.path}{changed && <span className="dot" title="changed in latest snapshot" />}</span>
                    <span className="file-meta"><span className={`label label-${c.label}`}>{c.label}</span><span className="hash">{e ? short(e.hash) : 'unhashed'}</span><span className="mode">{f.mode}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="inspect" aria-labelledby="inspect-h">
          {!file || !cls ? <p className="empty">Select a file.</p> : (
            <>
              <h2 id="inspect-h"><span className="mono">{file.path}</span></h2>
              <div className="facts">
                <div><span className="k">Label</span><span className={`label label-${cls.label}`}>{cls.label}</span></div>
                <div><span className="k">Latest hash</span><span className="hash">{latestEntry ? `${short(latestEntry.hash)}…` : 'not yet snapshotted'}</span></div>
                <div><span className="k">Mode</span><input className="mode-input" aria-label="File mode (octal)" value={file.mode} onChange={e => changeMode(e.target.value)} maxLength={4} /></div>
                <div><span className="k">Owner</span><span className="mono">{file.owner}</span></div>
              </div>
              <h3>Classification signals</h3>
              {cls.signals.length === 0 ? <p className="muted">No sensitive patterns matched; default label is internal.</p> : (
                <ul className="signals">{cls.signals.map(s => <li key={s.id}><span className={`label label-${s.label}`}>{s.label}</span> <span className="mono">{s.id}</span> — {s.detail}</li>)}</ul>
              )}
              <h3>Content (editable, synthetic)</h3>
              <label htmlFor="content" className="visually-hidden">File content</label>
              <textarea id="content" className="editor" rows={7} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
              <div className="row">
                <button type="button" className="btn small" onClick={saveEdit} disabled={!dirty}>Save edit</button>
                <button type="button" className="btn ghost small" onClick={() => setDraft(file.content)} disabled={!dirty}>Discard</button>
                <button type="button" className="btn ghost small danger" onClick={removeFile}>Remove file</button>
                <span className="muted small-text">{draft.length.toLocaleString()} / {LIMITS.maxContentChars.toLocaleString()} chars{dirty ? ' · unsaved' : ''}</span>
              </div>

              <h3>Simulate egress</h3>
              <div className="egress">
                <label>Egress channel
                  <select value={channel} onChange={e => setChannel(e.target.value as Channel)}>{(Object.keys(CHANNEL_LABEL) as Channel[]).map(c => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
                </label>
                {channel === 'email_external' && <label>Recipient domain <input value={recipient} onChange={e => setRecipient(e.target.value.slice(0, 80))} /></label>}
                <label>Actor <input value={actor} onChange={e => setActor(e.target.value.slice(0, 80))} /></label>
                <div className="row"><button type="button" className="btn" onClick={simulateEgress}>Simulate egress</button><button type="button" className="btn ghost" onClick={replayLast} disabled={!lastDecision}>Replay last event</button></div>
              </div>
              {lastDecision && (
                <div className={`decision decision-${lastDecision.decision}`} role="region" aria-label="Decision trace">
                  <p className="decision-head">{lastDecision.decision.toUpperCase()} <span className="mono">{lastDecision.ruleId}</span> · <span className="mono">{lastDecision.path}</span></p>
                  <p className="k">{lastDecision.decision === 'allow' ? 'Allowed because' : 'Blocked because'}</p>
                  <ol className="because">{lastDecision.because.map((b, i) => <li key={i}>{b}</li>)}</ol>
                  <p className="hash">evidence hash {lastDecision.hash}</p>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="side">
          <Tabs.Root defaultValue="diff">
            <Tabs.List className="tabs" aria-label="Ledger panels">
              <Tabs.Trigger value="diff">Diff</Tabs.Trigger>
              <Tabs.Trigger value="cases">Cases ({ledger.cases.filter(c => c.status === 'open').length})</Tabs.Trigger>
              <Tabs.Trigger value="chain">Chain</Tabs.Trigger>
              <Tabs.Trigger value="policy">Policy</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="diff" className="panel" tabIndex={0}>
              {!diff ? <p className="empty">Two snapshots are needed for a diff. Edit a file, save, and take another snapshot.</p> : (
                <>
                  <p className="diff-summary">{previous!.id} → {latest!.id}: <strong>{diff.added.length}</strong> added · <strong>{diff.removed.length}</strong> removed · <strong>{diff.modified.length}</strong> modified · <strong>{diff.permissionChanged.length}</strong> permission · {diff.unchanged} unchanged</p>
                  <table className="difftable">
                    <thead><tr><th scope="col">Change</th><th scope="col">Path</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                    <tbody>
                      {diff.added.map(a => <tr key={'a' + a.path} className="row-add"><td>added</td><td className="mono">{a.path}</td><td>—</td><td className="hash">{short(a.hash)} · {a.size} B</td></tr>)}
                      {diff.removed.map(r => <tr key={'r' + r.path} className="row-rm"><td>removed</td><td className="mono">{r.path}</td><td className="hash">{short(r.hash)}</td><td>—</td></tr>)}
                      {diff.modified.map(m => <tr key={'m' + m.path} className="row-mod"><td>modified</td><td className="mono">{m.path}</td><td className="hash">{short(m.before.hash)} · {m.before.size} B</td><td className="hash">{short(m.after.hash)} · {m.after.size} B</td></tr>)}
                      {diff.permissionChanged.map(p => <tr key={'p' + p.path} className="row-perm"><td>permission</td><td className="mono">{p.path}</td><td className="mono">{p.before.mode} {p.before.owner}</td><td className="mono">{p.after.mode} {p.after.owner}</td></tr>)}
                    </tbody>
                  </table>
                </>
              )}
            </Tabs.Content>
            <Tabs.Content value="cases" className="panel">
              {ledger.cases.length === 0 ? <p className="empty">No cases. Blocked or quarantined egress opens one with hash evidence.</p> : ledger.cases.map(c => (
                <article key={c.id} className={`case case-${c.decision} ${c.status}`}>
                  <p className="case-head"><span className="mono">{c.id}</span> · {c.decision} · {c.status}</p>
                  <p className="mono small-text">{c.path} · {c.ruleId} · {c.evidence.channel} · {c.evidence.actor}</p>
                  <p className="hash">{c.evidence.hash}</p>
                  {c.status === 'open' ? (
                    <form className="row" onSubmit={e => { e.preventDefault(); setLedger(l => closeCase(l, c.id, caseNote)); setCaseNote(''); setStatus(`Closed ${c.id}.`); }}>
                      <label className="grow">Resolution note <input value={caseNote} onChange={e => setCaseNote(e.target.value)} placeholder="≥ 3 characters" /></label>
                      <button type="submit" className="btn small">Close case</button>
                    </form>
                  ) : <p className="muted small-text">Resolution: {c.note}</p>}
                </article>
              ))}
              {ledger.replaysRejected > 0 && <p className="muted small-text">{ledger.replaysRejected} replayed event(s) rejected.</p>}
            </Tabs.Content>
            <Tabs.Content value="chain" className="panel">
              <p className={`chain-status ${chainStatus.startsWith('Chain broken') ? 'bad' : 'good'}`}>{chainStatus}</p>
              <ol className="chain-list">{snaps.map((s, i) => <li key={s.id}><span className="mono">#{i} {s.id}</span><br /><span className="hash">prev {s.prevChainHash ? short(s.prevChainHash) + '…' : 'genesis'}</span><br /><span className="hash">this {s.chainHash}</span></li>)}</ol>
              <h3>Events ({ledger.events.length})</h3>
              <ul className="events">{ledger.events.slice(-30).reverse().map(e => <li key={e.id}><span className={`tag tag-${e.decision}`}>{e.decision}</span> <span className="mono">{e.ruleId}</span> {e.path}<br /><span className="hash">{short(e.hash)}… · {e.at.slice(11, 19)}Z</span></li>)}</ul>
            </Tabs.Content>
            <Tabs.Content value="policy" className="panel">
              <label>Partner domains (comma-separated)<input value={policy.partnerDomains.join(', ')} onChange={e => setPolicy(p => ({ ...p, partnerDomains: e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20) }))} /></label>
              <label>USB allowed up to<select value={policy.usbAllowedUpTo} onChange={e => setPolicy(p => ({ ...p, usbAllowedUpTo: e.target.value as Label }))}>{LABELS.map(l => <option key={l}>{l}</option>)}</select></label>
              <label>Cloud share allowed up to<select value={policy.cloudAllowedUpTo} onChange={e => setPolicy(p => ({ ...p, cloudAllowedUpTo: e.target.value as Label }))}>{LABELS.map(l => <option key={l}>{l}</option>)}</select></label>
              <button type="button" className="btn ghost small" onClick={() => setPolicy(DEFAULT_POLICY)}>Reset policy</button>
              <h3>Rules in order</h3>
              <ol className="rules">{RULES.map(r => <li key={r.id}><span className="mono">{r.id}</span> — {r.text}</li>)}</ol>
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </main>
      <footer className="foot">Educational prototype. Hashes are real SHA-256 over synthetic text in this tab; the "filesystem" is an in-memory fixture list, the egress is simulated, and nothing is uploaded. Not an FIM/DLP product. State resets on refresh — export JSON to keep it.</footer>
    </div>
  );
}
