import { useMemo, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import fixture from './fixtures/ledgerly-lockgraph.json';
import sampleLock from './fixtures/sample-package-lock.json';
import { LIMITS, parseLockgraph, serialiseLockgraph, validateLockgraph } from './engine/schema';
import { buildGraph, NO_MATCH } from './engine/graph';
import { convertPackageLock } from './engine/lockfile';
import { reviewDependencies } from './engine/review';
import { buildReport, reportToMarkdown } from './engine/report';
import { splitId } from './engine/types';
import type { Lockgraph, ReviewRow } from './engine/types';

const DEMO: Lockgraph = (() => { const r = validateLockgraph(fixture); if (!r.ok) throw new Error(r.errors.join('\n')); return r.lockgraph; })();
type Filter = 'all' | 'advisories' | 'licence' | 'unknown' | 'flags';
type ImportMode = 'lockgraph' | 'package-lock';
/** Display budget for the duplicated tree view (a dense lockfile would otherwise expand exponentially). */
const TREE_ROW_LIMIT = 4000;
const parseNameList = (text: string): string[] => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface TreeNode { key: string; id: string; range: string; children: TreeNode[]; cycle: boolean; cut: boolean }

export default function App() {
  const [lock, setLock] = useState<Lockgraph>(DEMO);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>('deepset@1.0.4');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ImportMode>('lockgraph');
  const [draft, setDraft] = useState('');
  const [importsText, setImportsText] = useState('');
  const [includeDev, setIncludeDev] = useState(false);
  const [conversionNotes, setConversionNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('Demo snapshot loaded (synthetic packages and advisories).');

  const review = useMemo(() => reviewDependencies(lock), [lock]);
  const graph = useMemo(() => buildGraph(lock), [lock]);
  const rowById = useMemo(() => new Map(review.rows.map((r) => [r.id, r])), [review]);

  const { tree, treeCut } = useMemo((): { tree: TreeNode[]; treeCut: boolean } => {
    let rows = 0; let cut = false;
    const build = (id: string, range: string, path: string[]): TreeNode => {
      rows++;
      const node = graph.nodes.get(id)!;
      const cycle = path.includes(id);
      const key = [...path, id].join('>');
      const expandable = !cycle && path.length <= 10 && node.children.length > 0;
      let children: TreeNode[] = [];
      if (expandable && rows + node.children.length <= TREE_ROW_LIMIT) children = node.children.map((c) => build(c.to, c.range, [...path, id]));
      const wasCut = expandable && children.length === 0;
      if (wasCut) cut = true;
      return { key, id, range, cycle, children, cut: wasCut };
    };
    return { tree: graph.directIds.map((id) => build(id, lock.direct[splitId(id).name], [])), treeCut: cut };
  }, [graph, lock]);

  const matches = (r: ReviewRow): boolean =>
    filter === 'all' ? true : filter === 'advisories' ? r.advisories.length > 0 : filter === 'licence' ? r.license.verdict !== 'allow' : filter === 'unknown' ? r.reachability === 'unknown' || r.license.verdict === 'unknown' : r.flags.length > 0;
  const subtreeMatches = (n: TreeNode): boolean => matches(rowById.get(n.id)!) || n.children.some(subtreeMatches);

  function load(next: Lockgraph) { setLock(next); setErrors([]); setSelected(null); setCollapsed(new Set()); }
  function applyImport() {
    if (mode === 'package-lock') {
      const r = convertPackageLock(draft, { imports: parseNameList(importsText), includeDev });
      if (!r.ok) { setErrors(r.errors); setConversionNotes([]); return; }
      load(r.lockgraph); setConversionNotes(r.notes);
      setNotice(`Converted package-lock.json offline → ${r.lockgraph.root.name}@${r.lockgraph.root.version}: ${r.lockgraph.packages.length} packages, ${r.lockgraph.imports.length} import-evidence name${r.lockgraph.imports.length === 1 ? '' : 's'}, no advisories (none fetched).`);
      return;
    }
    const r = parseLockgraph(draft);
    if (!r.ok) { setErrors(r.errors); return; }
    load(r.lockgraph); setConversionNotes(r.lockgraph.source?.notes ?? []);
    setNotice(`Loaded "${r.lockgraph.name}": ${r.lockgraph.packages.length} packages, ${r.lockgraph.advisories.length} advisories.`);
  }
  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.maxBytes) { setErrors([`File is ${file.size} bytes; the limit is ${LIMITS.maxBytes}.`]); return; }
    setDraft(await file.text()); setErrors([]);
    // Announced feedback for the visually hidden file input: the file is only read into the editor, nothing is parsed until the button is pressed.
    setNotice(`Read ${file.name} (${file.size} bytes) into the editor — press ${mode === 'package-lock' ? 'Convert' : 'Validate'} and load to apply it.`);
  }
  function loadExample() {
    setDraft(JSON.stringify(mode === 'package-lock' ? sampleLock : fixture, null, 2)); setErrors([]);
  }
  function exportReport(kind: 'json' | 'md') {
    const report = buildReport(lock, review);
    if (kind === 'json') download('rootstock-review.json', JSON.stringify(report, null, 2), 'application/json');
    else download('rootstock-review.md', reportToMarkdown(report), 'text/markdown');
  }
  /** The loaded snapshot itself (rootstock.lockgraph/1) — edit it offline (e.g. add an advisory list) and re-import it. */
  function exportSnapshot() { download('rootstock-lockgraph.json', serialiseLockgraph(lock), 'application/json'); }
  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const sel = selected ? rowById.get(selected) : undefined;
  const s = review.summary;
  const isLockfile = lock.source?.kind === 'package-lock.json';

  return (
    <div>
      <header className="masthead">
        <h1>Rootstock Review<small>dependency and supply-chain risk explainer</small></h1>
        <span className="badge">educational · synthetic snapshot or an offline package-lock.json · not a scanner or legal opinion</span>
        <div className="right">
          <button className="btn" onClick={exportSnapshot}>Export snapshot (.json)</button>
          <button className="btn" onClick={() => exportReport('md')}>Export plan (.md)</button>
          <button className="btn primary" onClick={() => exportReport('json')}>Export evidence (.json)</button>
        </div>
      </header>
      <div className="tally" aria-label="Counts derived from the snapshot">
        <span><b>{s.packages}</b> packages</span>
        <span><b>{s.vulnerable}</b> with advisories</span>
        <span><b>{s.blocking}</b> blocking (≥ {lock.policy.blockSeverity})</span>
        <span><b>{s.licenseDeny}</b> licence deny</span>
        <span><b>{s.licenseReview}</b> licence review</span>
        <span><b>{s.unknownLicense}</b> licence unknown</span>
        <span><b>{s.reachabilityUnknown}</b> reachability unknown</span>
        <span><b>{s.unresolvedEdges}</b> unresolved edge{s.unresolvedEdges === 1 ? '' : 's'}</span>
        {review.truncated && <span className="tag l-review" role="status">traversal budget exhausted — path lists incomplete</span>}
        <span className="src">derived from {lock.name} · root {lock.root.name}@{lock.root.version}{isLockfile ? ` · ${lock.advisories.length} advisories supplied, none fetched` : ''}</span>
      </div>

      <main className="layout">
        <section className="panel" aria-labelledby="tree-h">
          <h2 id="tree-h">Graft tree</h2>
          <div className="toolbar">
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Show</span>
            <ToggleGroup.Root type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="toggle-group" aria-label="Filter">
              <ToggleGroup.Item value="all" className="toggle-item">all</ToggleGroup.Item>
              <ToggleGroup.Item value="advisories" className="toggle-item">advisories</ToggleGroup.Item>
              <ToggleGroup.Item value="licence" className="toggle-item">licence issues</ToggleGroup.Item>
              <ToggleGroup.Item value="unknown" className="toggle-item">unknowns</ToggleGroup.Item>
              <ToggleGroup.Item value="flags" className="toggle-item">provenance flags</ToggleGroup.Item>
            </ToggleGroup.Root>
            <button className="btn small" onClick={() => setCollapsed(new Set())}>Expand all</button>
          </div>
          <div className="row" style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }} aria-hidden>
            <span /><span>package · declared range</span><span>reach</span><span>licence</span><span className="col-adv">advisories</span><span className="col-plan">plan · flags</span>
          </div>
          <ul className="tree" role="tree" aria-label="Resolved dependency tree">
            {tree.filter(subtreeMatches).map((n) => <Branch key={n.key} node={n} rowById={rowById} collapsed={collapsed} toggle={toggle} selected={selected} select={setSelected} show={subtreeMatches} />)}
          </ul>
          {tree.filter(subtreeMatches).length === 0 && <p className="empty">No package matches this filter.</p>}
          {treeCut && <p className="treecut" role="note">Tree display limited to {TREE_ROW_LIMIT.toLocaleString('en-GB')} rows for this dense graph; branches marked “not expanded” have children that are not drawn here. Select a package to see its parents and paths — the review itself covers every package.</p>}
          {review.truncated && <p className="treecut" role="note">{review.notes.traversal}</p>}
          {review.unresolved.length > 0 && (
            <div className="unresolved"><strong>Unresolved edges ({review.unresolved.length}):</strong> {review.unresolved.map((u) => <span key={`${u.from}-${u.name}-${u.range}`}><code>{u.from}</code> → <code>{u.name} {u.range}</code> — {u.reason ?? NO_MATCH}; treated as an unknown node, not ignored. </span>)}</div>
          )}
          <p className="legend"><span className="glyph r-known"><i />known: direct + imported</span><span className="glyph r-inferred"><i />inferred: via an imported direct dependency</span><span className="glyph r-unknown"><i />unknown: no import evidence</span><span>· reachability is not exploitability</span></p>
        </section>

        <aside className="panel detail" aria-live="polite">
          {!sel && <p className="empty">Select a package to see its paths to the root, advisory ranges, licence decision and upgrade plan.</p>}
          {sel && (
            <>
              <h3>{sel.name} <small style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--ink-3)' }}>{sel.version}</small></h3>
              <div className="sub">{sel.isDirect ? 'direct dependency' : `transitive · depth ${sel.depth}`} · {sel.parents.length} parent edge{sel.parents.length === 1 ? '' : 's'}</div>
              <dl>
                <dt>reachability</dt><dd><span className={`glyph r-${sel.reachability}`}><i />{sel.reachability}</span><br /><span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{sel.reachabilityDetail}</span></dd>
                <dt>licence</dt><dd><span className={`tag l-${sel.license.verdict}`}>{sel.license.verdict}</span> <code>{sel.license.expression || '(none declared)'}</code><br /><span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{sel.license.detail}</span></dd>
                <dt>paths to root</dt><dd><ul className="paths">{sel.paths.length ? sel.paths.map((p) => <li key={p.join('>')}>{lock.root.name} › {p.join(' › ')}</li>) : <li>none (not reachable from root)</li>}</ul>{review.truncated && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Shortest path shown; the full list is incomplete because the traversal budget was exhausted.</span>}</dd>
                <dt>advisories</dt>
                <dd>
                  {sel.advisories.length === 0 && <span style={{ color: 'var(--ink-3)' }}>{isLockfile && lock.advisories.length === 0 ? 'no advisory data supplied — nothing was fetched' : `none match ${sel.version}`}</span>}
                  {sel.advisories.map((a) => (
                    <div key={a.id} className={`advcard${a.blocking ? '' : ' soft'}`}>
                      <b>{a.id} · {a.severity}{a.blocking ? ' · blocking' : ''}{a.cwe ? ` · ${a.cwe}` : ''}</b>
                      {a.title}<br />
                      <span style={{ color: 'var(--ink-2)' }}>vulnerable <code>{a.vulnerable}</code> · patched <code>{a.patched || '(none published)'}</code></span>
                    </div>
                  ))}
                </dd>
                {sel.plan && <><dt>plan</dt><dd><div className="plancard"><strong className={`p-${sel.plan.kind}`}>{sel.plan.kind.replace(/-/g, ' ')}{sel.plan.target ? ` → ${sel.plan.target}` : ''}</strong><br />{sel.plan.detail}{sel.plan.blockedBy?.length ? <ul>{sel.plan.blockedBy.map((b) => <li key={b.parent}><code>{b.parent}</code> requires <code>{b.range}</code></li>)}</ul> : null}</div></dd></>}
                <dt>flags</dt><dd>{sel.flags.length ? sel.flags.map((f) => <span key={f} className="flag">{f}</span>) : <span style={{ color: 'var(--ink-3)' }}>none</span>}<br /><span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Flags are review prompts (install scripts run on install; deprecated packages stop receiving fixes; multiple versions inflate the surface). They are not verdicts.</span></dd>
              </dl>
            </>
          )}
        </aside>
      </main>

      <details className="import">
        <summary>Import — a synthetic snapshot (rootstock.lockgraph/1) or an offline package-lock.json (lockfileVersion 2/3) · max {LIMITS.maxBytes / (1024 * 1024)} MiB, {LIMITS.maxPackages} packages</summary>
        <div className="toolbar modes">
          <span id="import-mode-label" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Format</span>
          <ToggleGroup.Root type="single" value={mode} onValueChange={(v) => { if (v) { setMode(v as ImportMode); setErrors([]); } }} className="toggle-group" aria-labelledby="import-mode-label">
            <ToggleGroup.Item value="lockgraph" className="toggle-item">lock snapshot (rootstock.lockgraph/1)</ToggleGroup.Item>
            <ToggleGroup.Item value="package-lock" className="toggle-item">package-lock.json (v2 / v3)</ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
        <label className="sr-only" htmlFor="lock-json">{mode === 'package-lock' ? 'package-lock.json text' : 'Lock snapshot JSON'}</label>
        <textarea id="lock-json" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} placeholder={mode === 'package-lock' ? 'Paste a package-lock.json (lockfileVersion 2 or 3), or load the synthetic sample. Only the "packages" map is read; nothing is fetched.' : 'Paste a rootstock.lockgraph/1 document, or load the demo to edit it.'} />
        {mode === 'package-lock' && (
          <div className="field">
            <label htmlFor="import-evidence">Import evidence</label>
            <input id="import-evidence" type="text" value={importsText} onChange={(e) => setImportsText(e.target.value)} placeholder="direct dependencies your code imports, comma-separated (optional)" aria-describedby="import-evidence-help" spellCheck={false} />
            <label className="check"><input type="checkbox" checked={includeDev} onChange={(e) => setIncludeDev(e.target.checked)} /> include devDependencies</label>
            <span id="import-evidence-help" className="help">Nothing is inferred without evidence: with an empty list every package is labelled unknown. Advisories are never fetched; to review against an offline advisory list, export the snapshot, add the records to its advisories array and re-import it in lock-snapshot mode.</span>
          </div>
        )}
        <div className="rowx">
          <button className="btn small" onClick={loadExample}>{mode === 'package-lock' ? 'Load sample package-lock.json' : 'Load demo into editor'}</button>
          <label className="btn small" htmlFor="lock-file">Choose file…<input id="lock-file" type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
          <button className="btn small primary" onClick={applyImport}>{mode === 'package-lock' ? 'Convert and load' : 'Validate and load'}</button>
          <span className="notice" role="status">{notice}</span>
        </div>
        {errors.length > 0 && <ul className="errors" role="alert">{errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {conversionNotes.length > 0 && (
          <section className="notes" aria-labelledby="notes-h">
            <h3 id="notes-h">Conversion notes ({conversionNotes.length})</h3>
            <ol>{conversionNotes.map((n, i) => <li key={i}>{n}</li>)}</ol>
          </section>
        )}
      </details>

      <footer className="foot">
        Rootstock Review resolves a lock snapshot into a graph, matches advisories with semver ranges, applies a licence policy, labels reachability from import evidence and derives an upgrade plan that names version conflicts. A real package-lock.json can be converted offline in the browser; even then no registry or advisory database is contacted, so advisories and import evidence are only what you supply. State resets on refresh.
      </footer>
    </div>
  );
}

function Branch(props: { node: TreeNode; rowById: Map<string, ReviewRow>; collapsed: Set<string>; toggle: (k: string) => void; selected: string | null; select: (id: string) => void; show: (n: TreeNode) => boolean }) {
  const { node, rowById, collapsed, toggle, selected, select, show } = props;
  const r = rowById.get(node.id)!;
  const open = !collapsed.has(node.key);
  const kids = node.children.filter(show);
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={selected === node.id}>
      <div className="row" data-selected={selected === node.id} role="presentation">
        <button className={`twisty${kids.length ? '' : ' leaf'}`} aria-label={open ? 'collapse' : 'expand'} onClick={() => toggle(node.key)} tabIndex={kids.length ? 0 : -1}>{open ? '−' : '+'}</button>
        <button className="name" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', font: 'inherit', fontWeight: 700 }} onClick={() => select(node.id)}>
          {r.name} <small>{r.version} · {node.range}</small>{node.cycle && <span className="cyc"> (cycle)</span>}{node.cut && <span className="cyc"> (not expanded: display budget)</span>}
        </button>
        <span className={`glyph r-${r.reachability}`}><i />{r.reachability}</span>
        <span><span className={`tag l-${r.license.verdict}`}>{r.license.verdict}</span></span>
        <span className="col-adv">{r.advisories.length ? r.advisories.map((a) => <span key={a.id} className={`adv${a.blocking ? '' : ' soft'}`}>{a.id} {a.severity} </span>) : <span style={{ color: 'var(--ink-3)' }}>—</span>}</span>
        <span className="col-plan">{r.plan && <span className={`plan-chip p-${r.plan.kind}`}>{r.plan.kind.replace(/-/g, ' ')}{r.plan.target ? ` → ${r.plan.target}` : ''} </span>}{r.flags.map((f) => <span key={f} className="flag">{f}</span>)}</span>
      </div>
      {open && kids.length > 0 && <ul role="group">{kids.map((c) => <Branch key={c.key} {...props} node={c} />)}</ul>}
    </li>
  );
}
