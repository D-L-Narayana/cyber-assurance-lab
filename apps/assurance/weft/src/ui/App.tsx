import { useEffect, useMemo, useRef, useState } from 'react';
import { artifactsToCsvRows, findingsToCsvRows, toCsv } from '../engine/csv';
import { analyze, buildManifest, diffBundles, signOff, SignoffError, verifyManifest } from '../engine/lineage';
import { MAX_BUNDLE_BYTES, validateBundle, validateBundleObject, validateManifest } from '../engine/validate';
import type { Artifact, Assertion, Bundle, BundleDiff, Link, VerifyResult } from '../engine/types';
import demo from '../fixtures/harbourline-bundle.json';
import { downloadText, readTextFile } from './files';
import { Weave } from './Weave';
import { ArtifactPanel, AssertionPanel, Ledger } from './Panels';

export type Notice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] } | null;
type Selection = { type: 'assertion'; id: string } | { type: 'artifact'; id: string } | null;

function loadDemo(): Bundle {
  const r = validateBundleObject(demo);
  if (!r.ok) throw new Error('Bundled fixture invalid: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.value;
}

function readHash(bundle: Bundle): Selection {
  const m = /^#\/(assertion|artifact)\/([A-Za-z0-9_.-]{1,64})$/.exec(location.hash);
  if (!m) return null;
  const list = m[1] === 'assertion' ? bundle.assertions : bundle.artifacts;
  return list.some((x) => x.id === m[2]) ? ({ type: m[1] as 'assertion' | 'artifact', id: m[2] }) : null;
}

export default function App() {
  const [bundle, setBundle] = useState<Bundle>(loadDemo);
  const [sel, setSel] = useState<Selection>(() => readHash(loadDemo()) ?? { type: 'assertion', id: 'AS-02' });
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded the synthetic Harbourline Q3 bundle. It contains planted defects: a tampered artifact, a duplicate, an orphan, a broken link, out-of-period evidence and a stale sign-off.' });
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [diff, setDiff] = useState<{ other: string; result: BundleDiff } | null>(null);
  const bundleRef = useRef<HTMLInputElement>(null);
  const manifestRef = useRef<HTMLInputElement>(null);
  const diffRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyze(bundle), [bundle]);

  useEffect(() => {
    const onHash = () => setSel(readHash(bundle));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [bundle]);

  function select(s: Selection) {
    setSel(s);
    const target = s ? `#/${s.type}/${s.id}` : '#';
    if (location.hash !== target) history.replaceState(null, '', target);
  }

  function apply(label: string, fn: (b: Bundle) => Bundle) {
    try {
      const next = fn(bundle);
      const check = validateBundleObject(next);
      if (!check.ok) {
        setNotice({ kind: 'error', text: `${label} rejected.`, details: check.issues.map((i) => `${i.path}: ${i.message}`) });
        return;
      }
      setBundle(check.value);
      setVerify(null);
      setNotice({ kind: 'success', text: label + '.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function doSignOff(assertionId: string, reviewer: string) {
    try {
      setBundle(signOff(bundle, assertionId, reviewer, bundle.asOf));
      setNotice({ kind: 'success', text: `${assertionId} signed by ${reviewer.trim()}; the binding hash is recorded.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof SignoffError ? `Sign-off refused: ${e.message}` : String(e) });
    }
  }

  async function importFile(file: File | undefined, what: 'bundle' | 'manifest' | 'diff') {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_BUNDLE_BYTES);
      if (what === 'manifest') {
        const r = validateManifest(text);
        if (!r.ok) return setNotice({ kind: 'error', text: `Manifest rejected: ${r.issues.length} issue(s).`, details: r.issues.map((i) => `${i.path || 'manifest'} — ${i.message}`) });
        const v = verifyManifest(bundle, r.value);
        setVerify(v);
        setNotice(v.intact ? { kind: 'success', text: `Bundle matches manifest ${r.value.root.slice(0, 12)}… — intact.` } : { kind: 'error', text: `Bundle does NOT match the manifest.`, details: [
          ...(!v.rootMatches ? ['Manifest root does not match its own entries (the manifest itself was altered).'] : []),
          ...v.modified.map((id) => `modified: ${id}`), ...v.missing.map((id) => `missing: ${id}`), ...v.added.map((id) => `added: ${id}`), ...v.bindingChanged.map((id) => `binding changed: ${id}`), ...v.missingAssertions.map((id) => `assertion missing: ${id}`), ...v.addedAssertions.map((id) => `assertion added (unbound): ${id}`), ...v.renamed.map((id) => `renamed (content unchanged): ${id}`), ...v.signoffsChanged.map((id) => `sign-off changed (added, removed, re-attributed or re-dated): ${id}`), ...(v.bundleNameChanged ? ['bundle name changed'] : []),
        ] });
        return;
      }
      const r = validateBundle(text);
      if (!r.ok) return setNotice({ kind: 'error', text: `Bundle rejected: ${r.issues.length} issue(s). Nothing changed.`, details: r.issues.map((i) => `${i.path || 'bundle'} — ${i.message}`) });
      if (what === 'diff') {
        setDiff({ other: r.value.name, result: diffBundles(bundle, r.value) });
        setNotice({ kind: 'info', text: `Compared the current bundle with “${r.value.name}”.` });
        return;
      }
      setBundle(r.value);
      setVerify(null);
      setDiff(null);
      select(r.value.assertions[0] ? { type: 'assertion', id: r.value.assertions[0].id } : null);
      setNotice({ kind: 'success', text: `Imported “${r.value.name}”: ${r.value.assertions.length} assertions, ${r.value.artifacts.length} artifacts, ${r.value.links.length} links.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      for (const ref of [bundleRef, manifestRef, diffRef]) if (ref.current) ref.current.value = '';
    }
  }

  const stamp = bundle.asOf.replace(/-/g, '');
  const selAssertion = sel?.type === 'assertion' ? bundle.assertions.find((a) => a.id === sel.id) : undefined;
  const selArtifact = sel?.type === 'artifact' ? bundle.artifacts.find((a) => a.id === sel.id) : undefined;
  const high = analysis.issues.filter((i) => i.severity === 'high').length;

  return (
    <div className="app">
      <a className="skip" href="#weave">Skip to weave</a>
      <header className="top">
        <div className="brand">
          <h1>Weft</h1>
          <p className="brand__sub">Control-to-evidence lineage and integrity bundle. Which evidence supports which assertion, is it still the evidence that was signed, and what is in the bundle that nobody can explain? Educational prototype on synthetic text artifacts.</p>
        </div>
        <div className="meta">
          <label><span>Bundle</span><input value={bundle.name} maxLength={200} onChange={(e) => apply('Renamed bundle', (b) => ({ ...b, name: e.target.value }))} /></label>
          <label><span>As of</span><input type="date" value={bundle.asOf} onChange={(e) => e.target.value && apply('Changed date', (b) => ({ ...b, asOf: e.target.value }))} /></label>
          <div className="btns" role="group" aria-label="Bundle actions">
            <button type="button" onClick={() => { setBundle(loadDemo()); setVerify(null); setDiff(null); select({ type: 'assertion', id: 'AS-02' }); setNotice({ kind: 'info', text: 'Reloaded the synthetic bundle.' }); }}>Load demo bundle</button>
            <button type="button" onClick={() => bundleRef.current?.click()}>Import bundle</button>
            <input ref={bundleRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void importFile(e.target.files?.[0], 'bundle')} />
            <button type="button" onClick={() => downloadText(`weft-bundle-${stamp}.json`, JSON.stringify(bundle, null, 2))}>Export bundle</button>
            <button type="button" className="primary" onClick={() => { const m = buildManifest(bundle, bundle.asOf); downloadText(`weft-manifest-${stamp}.json`, JSON.stringify(m, null, 2)); setNotice({ kind: 'success', text: `Manifest generated — root ${m.root.slice(0, 16)}… over ${m.entries.length} artifacts, ${m.bindings.length} bindings and ${m.signoffs.length} sign-offs.` }); }}>Generate manifest</button>
            <button type="button" onClick={() => manifestRef.current?.click()}>Verify against manifest</button>
            <input ref={manifestRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void importFile(e.target.files?.[0], 'manifest')} />
            <button type="button" onClick={() => diffRef.current?.click()}>Diff with another bundle</button>
            <input ref={diffRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void importFile(e.target.files?.[0], 'diff')} />
            <button type="button" onClick={() => downloadText(`weft-analysis-${stamp}.json`, JSON.stringify({ schema: 'weft.analysis/1', bundle: bundle.name, asOf: bundle.asOf, ...analysis }, null, 2))}>Export analysis</button>
            <button type="button" onClick={() => downloadText(`weft-artifacts-${stamp}.csv`, toCsv(artifactsToCsvRows(bundle, analysis)), 'text/csv')}>Export artifacts CSV</button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.text}</p>
          {notice.details && <ul>{notice.details.slice(0, 14).map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}

      <div className="layout">
        <main className="main" id="weave">
          <section className="weave-pane" aria-labelledby="weave-h">
            <div className="pane-head">
              <h2 id="weave-h">The weave</h2>
              <p className="small muted">Columns are assertions (warp), rows are artifacts (weft). A knot marks a link: ● in period, ○ out of period, ⊗ tainted (hash mismatch), ✕ broken. Select a column or row header.</p>
            </div>
            <Weave bundle={bundle} analysis={analysis} sel={sel} onSelect={select} onToggleLink={(assertionId, artifactId) => apply(bundle.links.some((l) => l.assertionId === assertionId && l.artifactId === artifactId) ? `Unlinked ${artifactId} from ${assertionId}` : `Linked ${artifactId} to ${assertionId}`, (b) => toggleLink(b, assertionId, artifactId))} />
          </section>

          <section className="detail" aria-live="polite">
            {selAssertion ? (
              <AssertionPanel key={selAssertion.id} assertion={selAssertion} info={analysis.assertions.find((a) => a.id === selAssertion.id)!} bundle={bundle}
                onSignOff={(reviewer) => doSignOff(selAssertion.id, reviewer)}
                onWithdraw={() => apply(`Withdrew sign-off on ${selAssertion.id}`, (b) => ({ ...b, signoffs: b.signoffs.filter((s) => s.assertionId !== selAssertion.id) }))}
                onEdit={(patch) => apply(`Edited ${selAssertion.id}`, (b) => ({ ...b, assertions: b.assertions.map((a) => (a.id === selAssertion.id ? { ...a, ...patch } : a)) }))}
                onRemove={() => { apply(`Removed ${selAssertion.id}`, (b) => ({ ...b, assertions: b.assertions.filter((a) => a.id !== selAssertion.id), links: b.links.filter((l) => l.assertionId !== selAssertion.id), signoffs: b.signoffs.filter((s) => s.assertionId !== selAssertion.id) })); select(null); }}
                onJump={(id) => select({ type: 'artifact', id })} />
            ) : selArtifact ? (
              <ArtifactPanel key={selArtifact.id} artifact={selArtifact} info={analysis.artifacts.find((a) => a.id === selArtifact.id)!}
                onEdit={(patch) => apply(`Edited ${selArtifact.id}`, (b) => ({ ...b, artifacts: b.artifacts.map((a) => (a.id === selArtifact.id ? { ...a, ...patch } : a)) }))}
                onRemove={() => { apply(`Removed ${selArtifact.id}`, (b) => ({ ...b, artifacts: b.artifacts.filter((a) => a.id !== selArtifact.id), links: b.links.filter((l) => l.artifactId !== selArtifact.id) })); select(null); }}
                onJump={(id) => select({ type: 'assertion', id })} />
            ) : (
              <div className="empty-detail">
                <h2>Nothing selected</h2>
                <p>Select an assertion column to see its evidence, binding hash and sign-off, or an artifact row to see its hash, duplicates and content. Editing an artifact's content changes its hash immediately — try it on a signed assertion's evidence.</p>
                <AddForms bundle={bundle} onAdd={apply} />
              </div>
            )}
          </section>
        </main>

        <aside className="side">
          <Ledger
            issues={analysis.issues}
            high={high}
            onJump={(ref) => select(bundle.assertions.some((a) => a.id === ref) ? { type: 'assertion', id: ref } : bundle.artifacts.some((a) => a.id === ref) ? { type: 'artifact', id: ref } : null)}
            onExport={() => downloadText(`weft-findings-${stamp}.csv`, toCsv(findingsToCsvRows(analysis.issues)), 'text/csv')}
          />
          {verify && (
            <section className="tool" aria-labelledby="verify-h">
              <h2 id="verify-h">Manifest verification</h2>
              <p className={verify.intact ? 'ok' : 'bad'}>{verify.intact ? 'Intact: every artifact, name, binding and sign-off matches the manifest.' : 'Drift detected.'}</p>
              <ul className="small">
                <li>Manifest self-consistent: {verify.rootMatches ? 'yes' : 'no (root mismatch)'}</li>
                <li>Modified: {verify.modified.join(', ') || '—'}</li>
                <li>Missing: {verify.missing.join(', ') || '—'}</li>
                <li>Added: {verify.added.join(', ') || '—'}</li>
                <li>Bindings changed: {verify.bindingChanged.join(', ') || '—'}</li>
                <li>Assertions missing: {verify.missingAssertions.join(', ') || '—'}</li>
                <li>Assertions added (unbound): {verify.addedAssertions.join(', ') || '—'}</li>
                <li>Renamed (same content): {verify.renamed.join(', ') || '—'}</li>
                <li>Sign-offs changed: {verify.signoffsChanged.join(', ') || '—'}</li>
                <li>Bundle name: {verify.bundleNameChanged ? 'changed' : 'unchanged'}</li>
              </ul>
            </section>
          )}
          {diff && (
            <section className="tool" aria-labelledby="diff-h">
              <h2 id="diff-h">Diff vs “{diff.other}”</h2>
              <ul className="small">
                {Object.entries(diff.result).map(([k, v]) => <li key={k}><span className="mono">{k}</span>: {(v as string[]).join(', ') || '—'}</li>)}
              </ul>
            </section>
          )}
          {(selAssertion || selArtifact) && <AddForms bundle={bundle} onAdd={apply} />}
        </aside>
      </div>

      <footer className="foot">
        <p>Hashes are SHA-256 over UTF-8 text, computed locally; a hash proves the content has not changed since it was hashed — not who produced it or whether it is genuine. Memory-only session; export the bundle and manifest to keep them.</p>
      </footer>
    </div>
  );
}

function toggleLink(b: Bundle, assertionId: string, artifactId: string): Bundle {
  const exists = b.links.some((l) => l.assertionId === assertionId && l.artifactId === artifactId);
  const links: Link[] = exists ? b.links.filter((l) => !(l.assertionId === assertionId && l.artifactId === artifactId)) : [...b.links, { assertionId, artifactId }];
  return { ...b, links };
}

function AddForms({ bundle, onAdd }: { bundle: Bundle; onAdd: (label: string, fn: (b: Bundle) => Bundle) => void }) {
  const [aRef, setARef] = useState('CSF 2.0 ');
  const [aText, setAText] = useState('');
  const [start, setStart] = useState('2026-07-01');
  const [end, setEnd] = useState('2026-09-30');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [captured, setCaptured] = useState(bundle.asOf);
  return (
    <div className="forms">
      <form className="addform" onSubmit={(e) => {
        e.preventDefault();
        const a: Assertion = { id: `AS-${String(bundle.assertions.length + 1).padStart(2, '0')}`, controlRef: aRef.trim(), statement: aText.trim(), owner: '', periodStart: start, periodEnd: end };
        onAdd(`Added ${a.id}`, (b) => ({ ...b, assertions: [...b.assertions, a] }));
        setAText('');
      }}>
        <h3>Add assertion</h3>
        <label><span>Control reference</span><input required maxLength={200} value={aRef} onChange={(e) => setARef(e.target.value)} /></label>
        <label><span>Statement</span><input required maxLength={2000} value={aText} onChange={(e) => setAText(e.target.value)} /></label>
        <div className="grid2">
          <label><span>Period start</span><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label><span>Period end</span><input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <button type="submit">Add assertion</button>
      </form>
      <form className="addform" onSubmit={(e) => {
        e.preventDefault();
        const a: Artifact = { id: `AR-${String(bundle.artifacts.length + 1).padStart(2, '0')}`, name: name.trim(), kind: 'note', capturedOn: captured, content };
        onAdd(`Added ${a.id}`, (b) => ({ ...b, artifacts: [...b.artifacts, a] }));
        setName(''); setContent('');
      }}>
        <h3>Add artifact</h3>
        <label><span>Name</span><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>Captured on</span><input type="date" required value={captured} onChange={(e) => setCaptured(e.target.value)} /></label>
        <label><span>Synthetic content (hashed)</span><textarea required rows={3} maxLength={50000} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <button type="submit">Add artifact</button>
      </form>
    </div>
  );
}
