import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import rel140 from './fixtures/release-1.4.0.json';
import rel141 from './fixtures/release-1.4.1.json';
import policyFixture from './fixtures/policy-default.json';
import { LIMITS, parseManifest, parsePolicy, validateManifest, validatePolicy } from './engine/schema';
import { evaluateRelease } from './engine/gate';
import { buildBundle, bundleToMarkdown } from './engine/bundle';
import type { Evaluation, Evidence, EvidenceType, Manifest, Policy, RequirementResult } from './engine/types';

type StageId = 'intake' | 'threat-model' | 'code-review' | 'verification' | 'acceptance';
const STAGES: { id: StageId; name: string; types: EvidenceType[] }[] = [
  { id: 'intake', name: 'Change intake', types: [] },
  { id: 'threat-model', name: 'Threat model', types: ['threat-model'] },
  { id: 'code-review', name: 'Code review', types: ['code-review'] },
  { id: 'verification', name: 'Verification', types: ['unit-tests', 'sast', 'secret-scan', 'dependency-review', 'security-retest'] },
  { id: 'acceptance', name: 'Risk acceptance', types: [] },
];
const TYPE_LABEL: Record<EvidenceType, string> = {
  'threat-model': 'Threat model', 'code-review': 'Code review', 'unit-tests': 'Unit tests', sast: 'Static analysis',
  'dependency-review': 'Dependency review', 'secret-scan': 'Secret scan', 'security-retest': 'Security retest',
};

const must = <T,>(r: { ok: true } & Record<string, unknown> | { ok: false; errors: string[] }, key: string): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return (r as Record<string, unknown>)[key] as T;
};
const DEMOS: Record<string, Manifest> = {
  'rel-140': must<Manifest>(validateManifest(rel140), 'manifest'),
  'rel-141': must<Manifest>(validateManifest(rel141), 'manifest'),
};
const DEFAULT_POLICY = must<Policy>(validatePolicy(policyFixture), 'policy');

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
const short = (iso: string) => iso.slice(0, 10);
const signalFor = (reqs: RequirementResult[], warningsFor: (r: RequirementResult) => boolean): 'green' | 'amber' | 'red' | 'off' => {
  if (reqs.length === 0) return 'off';
  if (reqs.some((r) => !r.satisfied)) return 'red';
  if (reqs.some(warningsFor)) return 'amber';
  return 'green';
};

export default function App() {
  const [manifestKey, setManifestKey] = useState<string>('rel-140');
  const [imported, setImported] = useState<Manifest | null>(null);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [policyDraft, setPolicyDraft] = useState(JSON.stringify(policyFixture, null, 2));
  const [policyErrors, setPolicyErrors] = useState<string[]>([]);
  const [policyNotice, setPolicyNotice] = useState('');
  const [asOfOverride, setAsOfOverride] = useState<string>('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const manifest = manifestKey === 'imported' && imported ? imported : DEMOS[manifestKey] ?? DEMOS['rel-140'];
  const asOf = asOfOverride ? `${asOfOverride}T00:00:00Z` : manifest.release.createdAt;

  useEffect(() => {
    let cancelled = false;
    evaluateRelease(manifest, policy, { asOf }).then((ev) => { if (!cancelled) setEvaluation(ev); });
    return () => { cancelled = true; };
  }, [manifest, policy, asOf]);

  const evidenceById = useMemo(() => new Map(manifest.evidence.map((e) => [e.id, e])), [manifest]);
  const reqByType = useMemo(() => new Map((evaluation?.requirements ?? []).map((r) => [r.type, r])), [evaluation]);
  const unverified = (r: RequirementResult) => r.hashStatus === 'unverified';

  function applyPolicy() {
    const r = parsePolicy(policyDraft);
    if (!r.ok) { setPolicyErrors(r.errors); setPolicyNotice(''); return; }
    setPolicy(r.policy); setPolicyErrors([]); setPolicyNotice(`Policy "${r.policy.name}" applied; the gate re-evaluated.`);
  }
  function resetPolicy() {
    setPolicyDraft(JSON.stringify(policyFixture, null, 2)); setPolicy(DEFAULT_POLICY); setPolicyErrors([]); setPolicyNotice('Default policy restored.');
  }
  function applyImport() {
    const r = parseManifest(draft);
    if (!r.ok) { setImportErrors(r.errors); return; }
    setImported(r.manifest); setManifestKey('imported'); setImportErrors([]); setImportOpen(false); setSelected(null); setAsOfOverride('');
  }
  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.maxBytes) { setImportErrors([`File is ${file.size} bytes; the limit is ${LIMITS.maxBytes}.`]); return; }
    setDraft(await file.text()); setImportErrors([]);
  }
  async function exportBundle(kind: 'json' | 'md') {
    if (!evaluation) return;
    const bundle = await buildBundle(manifest, policy, evaluation);
    if (kind === 'json') download(`provgate-${manifest.release.version}-bundle.json`, JSON.stringify(bundle, null, 2), 'application/json');
    else download(`provgate-${manifest.release.version}-gate.md`, bundleToMarkdown(bundle), 'text/markdown');
  }

  const selectedEvidence: Evidence | undefined = selected ? evidenceById.get(selected) : undefined;
  const selectedReq = evaluation?.requirements.find((r) => r.evidenceId === selected);
  const blockingFindings = evaluation?.findings.filter((f) => f.blocking) ?? [];
  const acceptedFindings = evaluation?.findings.filter((f) => !f.blocking && f.acceptance) ?? [];
  const otherFindings = evaluation?.findings.filter((f) => !f.blocking && !f.acceptance) ?? [];
  const acceptanceSignal: 'green' | 'amber' | 'red' | 'off' = !evaluation || evaluation.findings.length === 0 ? 'off' : blockingFindings.length ? 'red' : acceptedFindings.length ? 'amber' : 'green';

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">Provenance Gate<small>Secure-SDLC evidence gate · policy as code · browser-local</small></div>
        <div className="controls">
          <label htmlFor="release-select">Release</label>
          <select id="release-select" value={manifestKey} onChange={(e) => { setManifestKey(e.target.value); setSelected(null); setAsOfOverride(''); }}>
              <option value="rel-140">{DEMOS['rel-140'].release.name} — demo, vulnerable</option>
              <option value="rel-141">{DEMOS['rel-141'].release.name} — demo, remediated</option>
              {imported && <option value="imported">{imported.release.name} — imported</option>}
          </select>
          <label htmlFor="asof">Evaluate as of</label>
          <input id="asof" type="date" value={asOfOverride || short(manifest.release.createdAt)} min="2020-01-01" max="2099-12-31" onChange={(e) => setAsOfOverride(e.target.value)} />
          {asOfOverride && <button className="btn small" onClick={() => setAsOfOverride('')}>Use release date</button>}
          <button className="btn" onClick={() => { setDraft(JSON.stringify(manifest, null, 2)); setImportErrors([]); setImportOpen(true); }}>Import manifest…</button>
          <button className="btn" onClick={() => void exportBundle('md')} disabled={!evaluation}>Export gate memo (.md)</button>
          <button className="btn primary" onClick={() => void exportBundle('json')} disabled={!evaluation}>Export bundle (.json)</button>
        </div>
      </header>

      <div className="release-line">
        <h1>{manifest.release.name}</h1>
        <span className="meta">version <code>{manifest.release.version}</code> · commit <code>{manifest.release.commit}</code> · author <code>{manifest.release.author}</code> · created {short(manifest.release.createdAt)} · as of <code>{short(asOf)}</code></span>
        <span className="badge">Educational prototype · synthetic release metadata · not a compliance attestation</span>
      </div>

      {evaluation && (
        <p className="verdict-banner" role="status">
          <span className={`verdict v-${evaluation.verdict}`}>{evaluation.verdict.replace(/-/g, ' ')}</span>
          <span>{evaluation.blockers.length ? `${evaluation.blockers.length} blocker${evaluation.blockers.length === 1 ? '' : 's'} — scroll the train sideways for stage signals` : 'no blockers — scroll the train sideways for stage signals'}</span>
        </p>
      )}
      <section className="track" aria-label="Release train" tabIndex={0}>
        <ol>
          {STAGES.map((s) => {
            const reqs = (evaluation?.requirements ?? []).filter((r) => s.types.includes(r.type));
            const sig = s.id === 'intake' ? (evaluation ? 'green' : 'off') : s.id === 'acceptance' ? acceptanceSignal : signalFor(reqs, unverified);
            const sub = s.id === 'intake' ? `${manifest.changes.length} changed paths · ${evaluation?.classes.length ?? 0} classes`
              : s.id === 'acceptance' ? `${evaluation?.findings.length ?? 0} findings · ${blockingFindings.length} blocking`
              : reqs.length === 0 ? 'not required' : `${reqs.filter((r) => r.satisfied).length}/${reqs.length} satisfied`;
            return (
              <li key={s.id}>
                <span className={`signal s-${sig}`} role="img" aria-label={`${s.name}: ${sig === 'off' ? 'nothing required' : sig}`} />
                <span className="stage-name">{s.name}</span>
                <span className="stage-sub">{sub}</span>
              </li>
            );
          })}
          <li className="gate">
            <span className={`signal s-${evaluation?.verdict === 'blocked' ? 'red' : evaluation?.verdict === 'release-with-accepted-risk' ? 'amber' : evaluation ? 'green' : 'off'}`} role="img" aria-label={`Gate: ${evaluation?.verdict ?? 'evaluating'}`} />
            <span className="stage-name">Gate</span>
            <span className={`verdict v-${evaluation?.verdict ?? ''}`}>{evaluation ? evaluation.verdict.replace(/-/g, ' ') : 'evaluating…'}</span>
          </li>
        </ol>
      </section>

      <section className="yard" aria-label="Evidence tickets by stage" tabIndex={0}>
        <div className="cols">
          <div className="col">
            <h2>Changes & classes</h2>
            <div className="ticket t-ok">
              <div className="t-type">Matched classes</div>
              {evaluation?.classes.length ? evaluation.classes.map((c) => (
                <div key={c.id} className="t-prov"><strong>{c.label}</strong><ul className="change-list">{c.paths.map((p) => <li key={p}><code>{p}</code></li>)}</ul></div>
              )) : <span className="t-prov">No change class matched; baseline evidence only.</span>}
              <span className="t-prov">Reviewers required: <strong>{evaluation?.minReviewers ?? policy.minReviewers}</strong></span>
            </div>
            <div className="ticket">
              <div className="t-type">All changed paths</div>
              <ul className="change-list">{manifest.changes.map((c) => <li key={c.path}><code>{c.path}</code> <span className="chip">{c.kind}</span></li>)}</ul>
            </div>
          </div>

          {STAGES.filter((s) => s.types.length).map((s) => (
            <div className="col" key={s.id}>
              <h2>{s.name}</h2>
              {s.types.map((t) => {
                const r = reqByType.get(t);
                if (!r) return null;
                return <Ticket key={t} req={r} evidence={r.evidenceId ? evidenceById.get(r.evidenceId) : undefined} selected={selected === r.evidenceId && !!r.evidenceId} onSelect={() => setSelected(r.evidenceId ?? null)} />;
              })}
              {s.types.every((t) => !reqByType.has(t)) && <p className="empty">Nothing required at this stage for these changes.</p>}
            </div>
          ))}

          <div className="col">
            <h2>Risk acceptance</h2>
            {evaluation && evaluation.findings.length === 0 && <p className="empty">No findings recorded in the evidence.</p>}
            {evaluation?.findings.map((f) => (
              <div key={f.id} className={`ticket ${f.blocking ? 't-bad' : f.acceptance ? 't-warn' : 't-ok'}`}>
                <div className="t-type"><span>{f.id}</span><span className={`chip sev-${f.severity}`}>{f.severity}</span></div>
                <span className="t-prov">{f.title}</span>
                <span className="t-prov">status <code>{f.status}</code> · from <code>{f.source}</code></span>
                {f.blocking ? <ul className="problems"><li><b>blocking</b>{f.reason}</li></ul> : <span className="ok">{f.reason}</span>}
                {f.acceptance?.problems.map((p) => <ul className="problems" key={p.code}><li><b>{p.code}</b>{p.detail}</li></ul>)}
              </div>
            ))}
          </div>

          <div className="col">
            <h2>Gate decision</h2>
            <div className="gatecard">
              <span className={`verdict v-${evaluation?.verdict ?? ''}`}>{evaluation?.verdict.replace(/-/g, ' ') ?? '…'}</span>
              {evaluation && evaluation.blockers.length > 0 && (<><strong>Blockers</strong><ul>{evaluation.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>)}
              {evaluation && evaluation.blockers.length === 0 && <span className="why">Every required evidence item is present, current, for the right commit and produced by eligible people{acceptedFindings.length ? `; ${acceptedFindings.length} finding(s) carried under a valid, time-boxed risk acceptance.` : '.'}</span>}
              {evaluation && evaluation.warnings.length > 0 && (<><strong>Warnings (non-blocking)</strong><ul className="warnings">{evaluation.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>)}
              {otherFindings.length > 0 && <span className="why">{otherFindings.length} finding(s) below threshold or fixed.</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="lower">
        <div className="panel">
          <Tabs.Root defaultValue="policy">
            <Tabs.List className="tabs-list" aria-label="Policy and inputs">
              <Tabs.Trigger className="tab" value="policy">Policy as code</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="evidence">All evidence ({manifest.evidence.length})</Tabs.Trigger>
              <Tabs.Trigger className="tab" value="people">Identities ({manifest.identities.length})</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="policy">
              <p>Edit the JSON and apply. Required: evidence age limit, same-commit types, baseline types, change classes with globs and reviewer minimums, blocking severity and acceptance rules.</p>
              <label className="sr-only" htmlFor="policy-json">Policy JSON</label>
              <textarea id="policy-json" className="code" value={policyDraft} onChange={(e) => setPolicyDraft(e.target.value)} spellCheck={false} />
              <div className="row">
                <button className="btn small primary" onClick={applyPolicy}>Apply policy</button>
                <button className="btn small" onClick={resetPolicy}>Restore default</button>
                <span className="spacer" />
                <span className="chip">active: {policy.name}</span>
              </div>
              {policyErrors.length > 0 && <ul className="errors" role="alert">{policyErrors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}</ul>}
              {policyNotice && <p className="notice" role="status">{policyNotice}</p>}
            </Tabs.Content>
            <Tabs.Content value="evidence">
              <ul className="change-list">
                {manifest.evidence.map((e) => (
                  <li key={e.id}><button className="btn small" onClick={() => setSelected(e.id)} aria-pressed={selected === e.id}>{e.id}</button> {TYPE_LABEL[e.type]} · {short(e.producedAt)} · commit <code>{e.commit}</code> · by <code>{e.producedBy}</code>{reqByType.get(e.type)?.evidenceId === e.id ? '' : reqByType.has(e.type) ? ' · not selected (weaker candidate)' : ' · not required by policy'}</li>
                ))}
              </ul>
            </Tabs.Content>
            <Tabs.Content value="people">
              <ul className="change-list">{manifest.identities.map((i) => <li key={i.id}><code>{i.id}</code> {i.label} — roles: {i.roles.join(', ')}{i.id === manifest.release.author ? ' · release author' : ''}</li>)}</ul>
              <p>Fictional identities. Separation of duties: the author cannot review or accept risk on their own release; duplicates count once.</p>
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <div className="panel detail" aria-live="polite">
          <h2>Evidence detail</h2>
          {!selectedEvidence && <p className="empty">Select a ticket to see its provenance, problems and the inline artifact that was hashed.</p>}
          {selectedEvidence && (
            <>
              <dl>
                <dt>Id</dt><dd><code>{selectedEvidence.id}</code> · {TYPE_LABEL[selectedEvidence.type]}</dd>
                <dt>Produced</dt><dd>{selectedEvidence.producedAt} by <code>{selectedEvidence.producedBy}</code>{selectedReq?.ageDays !== undefined ? ` · ${selectedReq.ageDays} days before as-of` : ''}</dd>
                <dt>Commit</dt><dd><code>{selectedEvidence.commit}</code>{selectedEvidence.commit !== manifest.release.commit ? ` (release is ${manifest.release.commit})` : ' (matches release)'}</dd>
                {selectedEvidence.reviewers && <><dt>Reviewers</dt><dd>{selectedEvidence.reviewers.join(', ')}</dd></>}
                {selectedEvidence.scope && <><dt>Scope</dt><dd>{selectedEvidence.scope.join(', ')}</dd></>}
                {selectedEvidence.result && <><dt>Result</dt><dd>{selectedEvidence.result}</dd></>}
                <dt>Hash</dt><dd><span className={`hash ${selectedReq?.hashStatus ?? 'unverified'}`}>{selectedReq?.hashStatus ?? 'unverified'}</span> {selectedEvidence.artifactHash ? <code>{selectedEvidence.artifactHash.slice(0, 16)}…</code> : 'no artifactHash recorded'}</dd>
                {selectedReq?.alternatives.length ? <><dt>Alternatives</dt><dd>{selectedReq.alternatives.join(', ')} (weaker candidates of the same type)</dd></> : null}
              </dl>
              {selectedReq && selectedReq.problems.length > 0 && <ul className="problems" style={{ marginBottom: 10 }}>{selectedReq.problems.map((p) => <li key={p.code}><b>{p.code}</b>{p.detail}</li>)}</ul>}
              {selectedEvidence.artifact !== undefined ? <pre tabIndex={0}>{selectedEvidence.artifact}</pre> : <p className="empty">No inline artifact; the hash cannot be verified here. Treated as recorded, flagged "unverified".</p>}
              {selectedEvidence.findings && selectedEvidence.findings.length > 0 && (
                <ul className="change-list" style={{ marginTop: 10 }}>{selectedEvidence.findings.map((f) => <li key={f.id}><span className={`chip sev-${f.severity}`}>{f.severity}</span> {f.id} {f.title} — {f.status}</li>)}</ul>
              )}
            </>
          )}
        </div>
      </section>

      <footer className="foot">
        Provenance Gate evaluates a release manifest against a local policy: required evidence per change class, freshness, same-commit, SHA-256 artifact integrity, separation of duties and time-boxed risk acceptance. Everything runs in this tab; nothing is uploaded. Exported bundles carry a content digest, which is not a signature. State resets on refresh.
      </footer>

      <Dialog.Root open={importOpen} onOpenChange={setImportOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog" aria-describedby="import-desc">
            <Dialog.Title asChild><h2>Import a release manifest</h2></Dialog.Title>
            <Dialog.Description id="import-desc">Paste or choose a <code>provgate.release/1</code> JSON document (max {Math.round(LIMITS.maxBytes / 1024)} KB, {LIMITS.maxEvidence} evidence items). Use synthetic data only; do not paste real commit logs or names.</Dialog.Description>
            <label className="sr-only" htmlFor="manifest-text">Manifest JSON</label>
            <textarea id="manifest-text" className="code" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <div className="row">
              <label className="btn small" htmlFor="manifest-file">Choose file…<input id="manifest-file" type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
              <span className="spacer" />
              <Dialog.Close asChild><button className="btn small">Cancel</button></Dialog.Close>
              <button className="btn small primary" onClick={applyImport}>Validate and load</button>
            </div>
            {importErrors.length > 0 && <ul className="errors" role="alert">{importErrors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Ticket({ req, evidence, selected, onSelect }: { req: RequirementResult; evidence?: Evidence; selected: boolean; onSelect: () => void }) {
  const tone = !req.satisfied ? 't-bad' : req.hashStatus === 'unverified' ? 't-warn' : 't-ok';
  return (
    <button className={`ticket ${tone}${selected ? ' selected' : ''}`} onClick={onSelect} aria-pressed={selected} disabled={!evidence}>
      <span className="t-type"><span>{TYPE_LABEL[req.type]}</span><span className={`hash ${req.hashStatus}`}>{req.hashStatus}</span></span>
      {evidence ? (
        <span className="t-prov"><code>{evidence.id}</code> · {short(evidence.producedAt)} · <code>{evidence.commit}</code> · {evidence.producedBy}{evidence.reviewers ? ` · reviewers: ${evidence.reviewers.join(', ')}` : ''}</span>
      ) : <span className="t-prov">required by {req.requiredBy.join(', ')}</span>}
      {req.problems.length ? (
        <ul className="problems">{req.problems.map((p) => <li key={p.code}><b>{p.code}</b>{p.detail}</li>)}</ul>
      ) : <span className="ok">Satisfies policy (required by {req.requiredBy.join(', ')}).</span>}
    </button>
  );
}
