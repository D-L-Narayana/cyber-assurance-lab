import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import { parseRuleCsv, LIMITS, type Rule } from './engine/rules';
import { analyzeRules, analyzeCoverage, KIND_META, type Severity } from './engine/analyze';
import { proposeChange, applyProposals, diffRuleSets, type Proposal } from './engine/change';
import { explainRule } from './engine/explain';
import { toCsv, buildReport, findingRows, coverageLabel } from './engine/report';
import { SAMPLE_RULES_CSV } from './engine/fixtures';
import { Footprint, CoverageBar } from './ui/RuleRow';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const FIXTURE_LABEL = 'shipped synthetic fixture (41 rules)';

export function App() {
  const [rules, setRules] = useState<Rule[]>(() => parseRuleCsv(SAMPLE_RULES_CSV).rules);
  const [source, setSource] = useState(FIXTURE_LABEL);
  const [now, setNow] = useState('2026-10-01');
  const [staleDays, setStaleDays] = useState(90);
  const [jumpHost, setJumpHost] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [showDisabled, setShowDisabled] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const coverage = useMemo(() => analyzeCoverage(rules), [rules]);
  const findings = useMemo(() => analyzeRules(rules, { now, staleDays, coverage }), [rules, now, staleDays, coverage]);
  const proposals = useMemo<Proposal[]>(() => findings.map(f => ({ ...proposeChange(rules, f, { now, jumpHost }), approved: decisions[f.id] === true })), [findings, rules, decisions, now, jumpHost]);
  const after = useMemo(() => applyProposals(rules, proposals), [rules, proposals]);
  const changes = useMemo(() => diffRuleSets(rules, after), [rules, after]);
  const afterFindings = useMemo(() => analyzeRules(after, { now, staleDays }), [after, now, staleDays]);
  const current = findings.find(f => f.id === selected) ?? null;
  const currentRule = current?.ruleId ? rules.find(r => r.id === current.ruleId) ?? null : null;
  const currentProposal = current ? proposals.find(p => p.findingId === current.id)! : null;
  const bySev = SEVERITIES.map(s => ({ s, n: findings.filter(f => f.severity === s).length }));
  const visibleRules = rules.filter(r => showDisabled || r.enabled);
  const findingsForRule = (id: string) => findings.filter(f => f.ruleId === id);

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  function exportJson() { download(`ruleshadow-report-${Date.now()}.json`, JSON.stringify(buildReport({ rules, findings, proposals, generatedAt: new Date().toISOString(), now, coverage }), null, 2), 'application/json'); setStatus('Exported JSON report (includes per-rule coverage).'); }
  function exportCsv() { download(`ruleshadow-findings-${Date.now()}.csv`, toCsv(findingRows(findings, proposals, decisions, coverage)), 'text/csv'); setStatus('Exported findings CSV (formula-safe, with coverage column).'); }
  function doImport() {
    const r = parseRuleCsv(importText);
    if (r.errors.length) { setImportErrors(r.errors.map(e => `line ${e.line}: ${e.reason}`)); return; }
    if (!r.rules.length) { setImportErrors(['No rules parsed.']); return; }
    setRules(r.rules); setSource(`imported CSV (${r.rules.length} rules)`); setDecisions({}); setSelected(null); setImportOpen(false); setImportErrors([]);
    setStatus(`Loaded ${r.rules.length} rules.`);
  }
  function decideProposal(id: string, approved: boolean) { setDecisions(d => ({ ...d, [id]: approved })); setStatus(approved ? 'Proposal approved; change set updated.' : 'Proposal rejected.'); }
  function reset() { setRules(parseRuleCsv(SAMPLE_RULES_CSV).rules); setSource(FIXTURE_LABEL); setDecisions({}); setSelected(null); setStatus('Reset to the shipped fixture.'); }

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="wrap">
        <a className="skip" href="#findings">Skip to findings</a>
        <header className="head">
          <div>
            <h1>Ruleshadow</h1>
            <p className="lede">Firewall and VPN rule review without touching a device. Interval arithmetic finds shadowed, conflicting, overbroad, expired and unused rules; every finding comes with a plain-language reading of the rule and a proposed change you approve or reject into a diff.</p>
          </div>
          <div className="head-controls">
            <label>Review date <input type="date" value={now} onChange={e => e.target.value && setNow(e.target.value)} /></label>
            <label>Stale after (days) <input type="number" min={1} max={3650} value={staleDays} onChange={e => setStaleDays(Math.max(1, Math.min(3650, Number(e.target.value) || 90)))} /></label>
            <label>Admin jump host (CIDR, optional) <input value={jumpHost} onChange={e => setJumpHost(e.target.value.slice(0, 40))} placeholder="e.g. 10.0.5.10/32" /></label>
            <button type="button" className="btn ghost" onClick={() => { setImportOpen(true); setImportErrors([]); }}>Import CSV</button>
            <button type="button" className="btn ghost" onClick={exportCsv}>Export CSV</button>
            <button type="button" className="btn" onClick={exportJson}>Export JSON</button>
          </div>
        </header>
        <p className="status" role="status" aria-live="polite">{status}</p>
        <section className="summary" aria-label="Review summary">
          <span className="src">{source} · {rules.filter(r => r.enabled).length} enabled of {rules.length} · reviewed as of {now}</span>
          <span className="sev-chips">{bySev.filter(x => x.n).map(x => <span key={x.s} className={`chip sev-${x.s}`}>{x.n} {x.s}</span>)}{findings.length === 0 && <span className="chip">no findings</span>}</span>
          <span className="src">{proposals.filter(p => p.approved).length} approved · {changes.length} rule change{changes.length === 1 ? '' : 's'} in set · {proposals.filter(p => p.manualReview).length} need manual review</span>
          {source !== FIXTURE_LABEL && <button type="button" className="linkbtn" onClick={reset}>reset to fixture</button>}
        </section>

        <main className="layout">
          <section className="findings" id="findings" aria-labelledby="findings-h">
            <h2 id="findings-h">Findings</h2>
            {findings.length === 0 && <p className="empty">Nothing to report for this rule set.</p>}
            <ol className="finding-list">
              {findings.map(f => (
                <li key={f.id}>
                  <button type="button" className={`finding sev-${f.severity} ${selected === f.id ? 'is-selected' : ''} ${decisions[f.id] === true ? 'approved' : decisions[f.id] === false ? 'rejected' : ''}`} aria-pressed={selected === f.id} onClick={() => setSelected(f.id)}>
                    <span className="f-top"><span className="sev">{f.severity}</span><span className="kind">{KIND_META[f.kind].label}</span></span>
                    <span className="f-title">{f.title}</span>
                    {decisions[f.id] !== undefined && <span className="f-state">{decisions[f.id] ? 'approved' : 'rejected'}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="detail" aria-labelledby="detail-h">
            {!current ? (
              <>
                <h2 id="detail-h">Select a finding</h2>
                <p className="empty">The detail view shows what the engine measured, the rule in plain language, the rules that shadow it, and a proposed change you can approve into the change set.</p>
                <h3>Finding types</h3>
                <dl className="kinds">{(Object.keys(KIND_META) as (keyof typeof KIND_META)[]).map(k => <div key={k}><dt><span className={`chip sev-${KIND_META[k].severity}`}>{KIND_META[k].severity}</span> {KIND_META[k].label}</dt><dd>{KIND_META[k].explain}</dd></div>)}</dl>
              </>
            ) : (
              <>
                <h2 id="detail-h"><span className={`chip sev-${current.severity}`}>{current.severity}</span> {current.title}</h2>
                <p className="detail-text">{current.detail}</p>
                <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="linkbtn">Why does this matter?</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tip" sideOffset={6}>{KIND_META[current.kind].explain}<Tooltip.Arrow className="tip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>
                {currentRule && (
                  <>
                    <h3>Rule {currentRule.id} in plain language</h3>
                    <p className="plain">{explainRule(currentRule)}</p>
                    <div className="rule-card"><code>{currentRule.seq} {currentRule.action} {currentRule.proto} {currentRule.src} → {currentRule.dst} :{currentRule.ports} [{currentRule.zoneFrom}→{currentRule.zoneTo}] owner={currentRule.owner || '—'} expires={currentRule.expires || '—'} lastHit={currentRule.lastHit || 'never'}</code><Footprint rule={currentRule} /></div>
                    {coverage[currentRule.id] && (
                      <p className="cov-line">Coverage by earlier rules: <strong>{coverageLabel(coverage[currentRule.id])}</strong> of this rule's address × port space is already matched{coverage[currentRule.id].coveringRuleIds.length ? ` by ${coverage[currentRule.id].coveringRuleIds.join(', ')}` : ' (no earlier rule overlaps it)'}. <span className="muted">Union across address space — broader than the containment check behind shadow findings.{coverage[currentRule.id].approximate ? ' Approximate: the fragment budget was reached, so this is a lower bound.' : ''}</span></p>
                    )}
                  </>
                )}
                {current.relatedRuleIds.length > 0 && (
                  <>
                    <h3>{current.kind === 'partially-shadowed' ? `Covering earlier rule${current.relatedRuleIds.length > 1 ? 's' : ''} (union of their address space)` : `Covered by earlier rule${current.relatedRuleIds.length > 1 ? 's' : ''}`}</h3>
                    <ul className="related">{current.relatedRuleIds.map(id => { const r = rules.find(x => x.id === id)!; return <li key={id}><strong>{id}</strong> — {explainRule(r)}</li>; })}</ul>
                  </>
                )}
                {currentProposal && (
                  <div className={`proposal ${currentProposal.approved ? 'approved' : decisions[current.id] === false ? 'rejected' : ''}`}>
                    <h3>Proposed change · <span className="op">{currentProposal.manualReview ? 'manual review required' : currentProposal.op}</span></h3>
                    <p>{currentProposal.rationale}</p>
                    {currentProposal.after && <p className="mono small">after: {Object.entries(currentProposal.after).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</p>}
                    {currentProposal.newRule && <p className="mono small">new rule: {explainRule(currentProposal.newRule)}</p>}
                    {currentProposal.manualReview && <p className="muted small">No automatic change is generated for this finding, so approving is disabled and the re-analysis preview will still show it until a human resolves it.</p>}
                    <div className="row">
                      <button type="button" className="btn" onClick={() => decideProposal(current.id, true)} disabled={currentProposal.op === 'review' || currentProposal.approved}>Approve proposal</button>
                      <button type="button" className="btn ghost" onClick={() => decideProposal(current.id, false)} disabled={decisions[current.id] === false}>Reject</button>
                      {decisions[current.id] !== undefined && <button type="button" className="linkbtn" onClick={() => setDecisions(d => { const n = { ...d }; delete n[current.id]; return n; })}>clear decision</button>}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </main>

        <section className="tables">
          <Tabs.Root defaultValue="rules">
            <Tabs.List className="tabs" aria-label="Rule set views">
              <Tabs.Trigger value="rules">Rules ({visibleRules.length})</Tabs.Trigger>
              <Tabs.Trigger value="changes">Change set ({changes.length})</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="rules">
              <div className="table-tools">
                <label className="switch-label"><Switch.Root className="switch" checked={showDisabled} onCheckedChange={setShowDisabled} aria-label="Show disabled rules"><Switch.Thumb className="switch-thumb" /></Switch.Root>Show disabled rules</label>
                <span className="muted small">Footprint bars: source and destination block size (log scale) and port coverage across 0–65535. Coverage: share of the rule's address × port space already matched by earlier enabled rules (union, per protocol); "approx." marks a budget-limited lower bound.</span>
              </div>
              <div className="table-wrap" tabIndex={0} aria-label="Rules table, scrollable">
                <table className="rules">
                  <thead><tr><th scope="col">Seq</th><th scope="col">Rule</th><th scope="col">Action</th><th scope="col">Flow</th><th scope="col">Footprint</th><th scope="col">Coverage</th><th scope="col">Owner</th><th scope="col">Last hit</th><th scope="col">Findings</th></tr></thead>
                  <tbody>
                    {visibleRules.map(r => {
                      const fs = findingsForRule(r.id);
                      return (
                        <tr key={r.id} className={`${!r.enabled ? 'disabled' : ''} ${currentRule?.id === r.id ? 'is-current' : ''}`}>
                          <td className="mono">{r.seq}</td>
                          <th scope="row"><span className="mono">{r.id}</span><br /><span className="muted small">{r.comment}</span></th>
                          <td><span className={`act act-${r.action}`}>{r.action}</span></td>
                          <td className="mono small">{r.proto} {r.src} → {r.dst}<br />:{r.ports} · {r.zoneFrom}→{r.zoneTo}{r.expires ? ` · exp ${r.expires}` : ''}</td>
                          <td><Footprint rule={r} /></td>
                          <td><CoverageBar c={r.enabled ? coverage[r.id] : undefined} /></td>
                          <td className="small">{r.owner || '—'}</td>
                          <td className="mono small">{r.lastHit || 'never'}</td>
                          <td>{fs.length === 0 ? <span className="muted small">—</span> : fs.map(f => <button type="button" key={f.id} className={`chip sev-${f.severity} chip-btn`} onClick={() => setSelected(f.id)}>{f.kind}</button>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Tabs.Content>
            <Tabs.Content value="changes">
              {changes.length === 0 ? <p className="empty">Approve proposals to build a change set. The diff lists each modified field with before and after values.</p> : (
                <div className="table-wrap">
                  <p className="after-note">Re-analysing the rule set after these changes: <strong>{afterFindings.length}</strong> finding{afterFindings.length === 1 ? '' : 's'} would remain (now {findings.length}).{afterFindings.length ? ` Remaining: ${SEVERITIES.map(sv => ({ sv, n: afterFindings.filter(f => f.severity === sv).length })).filter(x => x.n).map(x => `${x.n} ${x.sv}`).join(', ')}.` : ''}</p>
                  <table className="diff">
                    <thead><tr><th scope="col">Rule</th><th scope="col">Change</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                    <tbody>
                      {changes.map(c => (
                        <tr key={c.ruleId} className="diff-row">
                          <th scope="row" className="mono">{c.ruleId}</th>
                          <td>{c.kind}{c.fields.length ? `: ${c.fields.join(', ')}` : ''}</td>
                          <td className="small">{c.before ? (c.fields.length ? c.fields.map(f => <div key={f}><span className="mono">{f}</span> = <del>{String(c.before![f])}</del></div>) : explainRule(c.before)) : '—'}</td>
                          <td className="small">{c.after ? (c.fields.length ? c.fields.map(f => <div key={f}><span className="mono">{f}</span> = <ins>{String(c.after![f])}</ins></div>) : explainRule(c.after)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">Plain-language after state: {after.filter(a => changes.some(c => c.ruleId === a.id)).map(a => <span key={a.id}><br />{a.id}: {explainRule(a)}</span>)}</p>
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </section>

        {importOpen && (
          <div className="backdrop" role="presentation" onClick={() => setImportOpen(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="imp-h" onClick={e => e.stopPropagation()}>
              <h2 id="imp-h">Import a rule set (CSV)</h2>
              <p className="muted">Header: <code>seq,id,action,src,dst,proto,ports,zoneFrom,zoneTo,enabled,owner,expires,lastHit,comment</code>. IPv4 CIDR or <code>any</code>; ports like <code>443</code>, <code>80-443</code>, <code>22,80</code>, <code>any</code>. Up to {LIMITS.maxRules} rules. Use synthetic exports only.</p>
              <label htmlFor="csv" className="visually-hidden">Rule CSV</label>
              <textarea id="csv" rows={10} value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false} />
              {importErrors.length > 0 && <ul role="alert" className="errors">{importErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <div className="row end"><button type="button" className="btn ghost" onClick={() => setImportText(SAMPLE_RULES_CSV)}>Load fixture text</button><button type="button" className="btn ghost" onClick={() => setImportOpen(false)}>Cancel</button><button type="button" className="btn" onClick={doImport}>Validate and load</button></div>
            </div>
          </div>
        )}
        <footer className="foot">Educational prototype. Static analysis of a synthetic rule table in the browser — no device connection, no packet generation, no deployment, not a configuration audit. State resets on refresh; export to keep it.</footer>
      </div>
    </Tooltip.Provider>
  );
}
