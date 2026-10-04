import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import demoJson from '../fixtures/demo.json';
import {
  applyDecision, buildCampaign, bulkDecision, closeCampaign, completion, exportCertificationWithDigest, routeItem, validateFixture, CAMPAIGN_OWNER,
} from '../engine/campaign';
import type { Campaign, Decision, Fixture, ReviewItem, RiskHint } from '../engine/types';
import { parseBoundedJson } from '../engine/safe';
import { downloadText } from './download';

type Filter = 'pending' | 'flagged' | 'all';
type Notice = { tone: 'ok' | 'error' | 'warn'; text: string } | null;

const HINT_LABEL: Record<RiskHint['kind'], string> = {
  sod_conflict: 'SoD conflict', orphan: 'Orphaned', dormant: 'Dormant', never_used: 'Never used', privileged: 'Privileged', no_reviewer: 'No reviewer', self_review: 'Self-review blocked',
};

function useFixtureCampaign() {
  const initial = useMemo(() => {
    const v = validateFixture(demoJson);
    if (!v.ok) throw new Error('Bundled demo fixture failed validation: ' + v.errors.join('; '));
    return v.fixture;
  }, []);
  const [fixture, setFixture] = useState<Fixture>(initial);
  const [dormantAfterDays, setDormant] = useState(90);
  const [campaign, setCampaign] = useState<Campaign>(() => buildCampaign(initial, { dormantAfterDays: 90, asOf: initial.asOf }));
  const rebuild = useCallback((f: Fixture, days: number) => {
    setFixture(f);
    setDormant(days);
    setCampaign(buildCampaign(f, { dormantAfterDays: days, asOf: f.asOf }));
  }, []);
  return { fixture, dormantAfterDays, campaign, setCampaign, rebuild };
}

export function App() {
  const { fixture, dormantAfterDays, campaign, setCampaign, rebuild } = useFixtureCampaign();
  const [actor, setActor] = useState<string>(() => campaign.reviewers[0]?.id ?? '');
  const [filter, setFilter] = useState<Filter>('pending');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const [reason, setReason] = useState('');
  const [overrideText, setOverrideText] = useState('');
  const [delegateTo, setDelegateTo] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [routeTarget, setRouteTarget] = useState('');
  const [routeReason, setRouteReason] = useState('');
  // Campaign closure (October 2026): note dialog state and the live certification digest.
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [ackPending, setAckPending] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const closed = campaign.closed ?? null;
  const unrouted = useMemo(() => campaign.items.filter((i) => i.reviewerId === null), [campaign]);
  const route = (itemId: string) => {
    const r = routeItem(campaign, { itemId, toReviewer: routeTarget, reason: routeReason });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setCampaign(r.campaign);
    setNotice({ tone: 'ok', text: `Routed ${itemId} to ${routeTarget} as ${CAMPAIGN_OWNER}; the audit log records it as a delegation.` });
  };
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const summary = useMemo(() => completion(campaign), [campaign]);
  const pendingCount = summary.total - summary.decided;
  useEffect(() => {
    // The digest is recomputed from the current campaign so the masthead always shows what an export right now would carry.
    let live = true;
    exportCertificationWithDigest(campaign).then((out) => { if (live) setDigest(out.json.digest); }).catch(() => { if (live) setDigest(null); });
    return () => { live = false; };
  }, [campaign]);
  const doClose = () => {
    const r = closeCampaign(campaign, { actor: CAMPAIGN_OWNER, note: closeNote, acknowledgePending: ackPending });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setCampaign(r.campaign); setCloseOpen(false); setCloseNote(''); setAckPending(false); setSelected(new Set());
    const c = r.campaign.closed!;
    setNotice({ tone: 'ok', text: `Campaign closed by ${c.by} on ${c.at}${c.pendingAtClose > 0 ? ` with ${c.pendingAtClose} undecided item${c.pendingAtClose === 1 ? '' : 's'} acknowledged` : ''}. Decisions are frozen; export the certification.` });
  };
  const myItems = useMemo(() => campaign.items.filter((i) => i.reviewerId === actor), [campaign, actor]);
  const visible = useMemo(() => myItems.filter((i) =>
    filter === 'all' ? true : filter === 'pending' ? i.state === 'pending' : i.hints.length > 0), [myItems, filter]);
  const focused = campaign.items.find((i) => i.id === focusId) ?? null;

  useEffect(() => {
    if (!campaign.reviewers.some((r) => r.id === actor)) setActor(campaign.reviewers[0]?.id ?? '');
  }, [campaign, actor]);
  useEffect(() => {
    if (focusId && !visible.some((i) => i.id === focusId)) setFocusId(visible[0]?.id ?? null);
    if (!focusId && visible[0]) setFocusId(visible[0].id);
  }, [visible, focusId]);

  const decide = (decision: Decision, item: ReviewItem | null = focused) => {
    if (!item) return;
    const itemSod = item.hints.find((h): h is Extract<RiskHint, { kind: 'sod_conflict' }> => h.kind === 'sod_conflict');
    const r = applyDecision(campaign, {
      itemId: item.id, actor, decision, reason,
      ...(overrideText.trim() && itemSod ? { sodOverride: { ruleId: itemSod.ruleId, rationale: overrideText } } : {}),
      ...(decision === 'delegate' ? { delegateTo } : {}),
    });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setCampaign(r.campaign);
    setNotice({ tone: 'ok', text: `${decision === 'approve' ? 'Approved' : decision === 'revoke' ? 'Revoked' : 'Delegated'} ${item.entitlement.privilege} for ${item.identity.displayName}.` });
    setReason(''); setOverrideText('');
    const idx = visible.findIndex((i) => i.id === item.id);
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null;
    if (filter === 'pending') setFocusId(next?.id ?? null);
  };

  const bulk = (decision: Decision) => {
    const ids = [...selected];
    const r = bulkDecision(campaign, ids, { actor, decision, reason, ...(decision === 'delegate' ? { delegateTo } : {}) });
    if (!r.ok) { setNotice({ tone: 'error', text: r.error }); return; }
    setCampaign(r.campaign);
    setSelected(new Set());
    setNotice({ tone: 'ok', text: `${ids.length} items ${decision === 'approve' ? 'approved' : decision === 'revoke' ? 'revoked' : 'delegated'} with one shared reason.` });
    setReason('');
  };

  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, item: ReviewItem) => {
    const idx = visible.findIndex((i) => i.id === item.id);
    const go = (n: number) => { const t = visible[n]; if (t) { setFocusId(t.id); rowRefs.current.get(t.id)?.focus(); } };
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); go(idx + 1); break;
      case 'ArrowUp': case 'k': e.preventDefault(); go(idx - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(visible.length - 1); break;
      case ' ': e.preventDefault(); setSelected((s) => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; }); break;
      case 'a': case 'r': case 'd': e.preventDefault(); setFocusId(item.id); if (item.hints.length > 0 || e.key === 'd') reasonRef.current?.focus(); else decide(e.key === 'a' ? 'approve' : 'revoke', item); break;
      case 'Enter': e.preventDefault(); setFocusId(item.id); reasonRef.current?.focus(); break;
    }
  };

  const onImport = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    const text = await file.text();
    const parsed = parseBoundedJson(text);
    if (!parsed.ok) { setImportError(parsed.error); return; }
    const v = validateFixture(parsed.value);
    if (!v.ok) { setImportError('Fixture rejected: ' + v.errors.slice(0, 5).join(' · ')); return; }
    rebuild(v.fixture, dormantAfterDays);
    setSelected(new Set()); setFocusId(null);
    setNotice({ tone: 'ok', text: `Loaded "${v.fixture.label}" with ${v.fixture.entitlements.length} entitlements. Decisions were reset.` });
  };

  const exportAll = async (kind: 'json' | 'csv') => {
    const out = await exportCertificationWithDigest(campaign);
    if (kind === 'json') downloadText('attestline-certification.json', JSON.stringify(out.json, null, 2), 'application/json');
    else downloadText('attestline-certification.csv', out.csv, 'text/csv');
    setNotice({ tone: 'ok', text: `Exported ${kind.toUpperCase()} (${out.json.items.length} items, ${out.json.decisions.length} decisions${kind === 'json' ? `; digest sha256:${out.json.digest.slice(0, 16)}…` : ''}).` });
  };

  const delegateTargets = campaign.reviewers.filter((r) => r.id !== actor);
  const sodHint = focused?.hints.find((h): h is Extract<RiskHint, { kind: 'sod_conflict' }> => h.kind === 'sod_conflict');
  const counterpart = sodHint ? campaign.items.find((i) => i.entitlement.id === sodHint.counterpartEntitlementId) : null;

  return (
    <div className="app">
      <header className="masthead">
        <h1>Attestline<small>Access-review decision engine · educational prototype on synthetic data</small></h1>
        <p className="campaign"><strong>{campaign.fixtureLabel}</strong><br />as of {campaign.config.asOf} · {summary.decided}/{summary.total} decided ({summary.percent}%) · {summary.sodOverrides} SoD override{summary.sodOverrides === 1 ? '' : 's'} · {summary.unrouted} unrouted{closed ? ' · closed' : ''}<br /><span className="digest-label">certification digest</span> <code className="digest">{digest ? `sha256:${digest}` : 'computing…'}</code></p>
        <div className="controls">
          <label className="field">Acting as reviewer
            <select value={actor} onChange={(e) => { setActor(e.target.value); setSelected(new Set()); setFocusId(null); }}>
              {campaign.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
            </select>
          </label>
          <label className="field">Dormant after (days)
            <input type="number" min={1} max={3650} value={dormantAfterDays}
              onChange={(e) => { const v = Math.min(3650, Math.max(1, Number(e.target.value) || 1)); rebuild(fixture, v); setNotice({ tone: 'warn', text: `Threshold changed to ${v} days; risk hints recomputed and decisions reset.` }); }} />
          </label>
          <button className="btn ghost" onClick={() => exportAll('json')}>Export JSON</button>
          <button className="btn ghost" onClick={() => exportAll('csv')}>Export CSV</button>
          <button className="btn ghost" onClick={() => { rebuild(fixture, dormantAfterDays); setSelected(new Set()); setCloseOpen(false); setNotice({ tone: 'warn', text: 'All decisions cleared. Campaign rebuilt from the loaded fixture.' }); }}>Reset decisions</button>
          <button className="btn" onClick={() => setCloseOpen((o) => !o)} aria-expanded={closeOpen} aria-controls="close-panel" disabled={!!closed}>Close campaign</button>
        </div>
        {closeOpen && !closed && (
          <section id="close-panel" className="close-panel" aria-labelledby="close-h">
            <h2 id="close-h">Close this campaign</h2>
            <p>Closing freezes every decision and routing action. The closing record (who, when, note, undecided count) is written into the certification export and covered by its digest. {pendingCount > 0 ? `${pendingCount} item${pendingCount === 1 ? ' is' : 's are'} still undecided.` : 'Every item has been decided.'}</p>
            <label>Closing note (at least 10 characters)
              <textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Why the campaign is being closed in this state" />
            </label>
            {pendingCount > 0 && (
              <label className="check"><input type="checkbox" checked={ackPending} onChange={(e) => setAckPending(e.target.checked)} /> Acknowledge the {pendingCount} undecided item{pendingCount === 1 ? '' : 's'} and record that count in the closing record</label>
            )}
            <div className="actions">
              <button type="button" className="btn revoke" onClick={doClose}>Confirm close</button>
              <button type="button" className="btn ghost" onClick={() => { setCloseOpen(false); setCloseNote(''); setAckPending(false); }}>Cancel</button>
            </div>
          </section>
        )}
        {closed && (
          <p className="notice warn closed-banner" role="status"><strong>Campaign closed</strong> by <span className="mono">{closed.by}</span> on <span className="mono">{closed.at}</span>{closed.pendingAtClose > 0 ? ` with ${closed.pendingAtClose} item${closed.pendingAtClose === 1 ? '' : 's'} left undecided` : ''} — “{closed.note}”. Decisions and routing are frozen; export the certification (its digest covers the closing record). “Reset decisions” starts a new campaign.</p>
        )}
        <div className="progress" role="group" aria-label="Progress by reviewer">
          {summary.byReviewer.map((r) => (
            <button key={r.reviewerId} className="reviewer-chip" aria-pressed={r.reviewerId === actor} onClick={() => { setActor(r.reviewerId); setSelected(new Set()); setFocusId(null); }}>
              <span className="name">{r.name}</span>
              <span className="bar" aria-hidden="true"><span style={{ width: `${r.pending + r.done === 0 ? 0 : Math.round((r.done / (r.pending + r.done)) * 100)}%` }} /></span>
              <span className="count">{r.done} done · {r.pending} pending</span>
            </button>
          ))}
        </div>
      </header>

      <main className="workbench">
        <section className="queue" aria-labelledby="queue-h">
          <div className="queue-head">
            <h2 id="queue-h">Review queue</h2>
            <div className="filters" role="group" aria-label="Filter">
              {(['pending', 'flagged', 'all'] as Filter[]).map((f) => (
                <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'pending' ? `Pending (${myItems.filter((i) => i.state === 'pending').length})` : f === 'flagged' ? `Flagged (${myItems.filter((i) => i.hints.length > 0).length})` : `All (${myItems.length})`}</button>
              ))}
            </div>
            <p className="legend">Keys: <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> select · <kbd>A</kbd> approve · <kbd>R</kbd> revoke · <kbd>D</kbd> delegate · <kbd>Enter</kbd> reason</p>
          </div>

          <details className="import">
            <summary>Load a different fixture (JSON, max 512 KB)</summary>
            <div className="import-body">
              <label>Fixture file <input type="file" accept="application/json,.json" onChange={(e) => onImport(e.target.files?.[0])} /></label>
              <span>Schema: <code className="mono">attestline fixture v1</code> — identities, resources, entitlements, sodRules. Processed in this tab only; nothing is uploaded. The bundled demo was produced by <code className="mono">scripts/generate-fixture.mjs</code>.</span>
              {importError && <p className="notice error" role="alert">{importError}</p>}
            </div>
          </details>

          {unrouted.length > 0 && (
            <details className="import">
              <summary>Route unrouted items as campaign owner ({unrouted.length})</summary>
              <div className="import-body">
                <span>These entitlements have no manager and no known resource owner, so nobody can decide them. The campaign owner must assign a reviewer; this is logged as a delegation by <code className="mono">{CAMPAIGN_OWNER}</code>.</span>
                <label className="field">Route to
                  <select value={routeTarget} onChange={(e) => setRouteTarget(e.target.value)}>
                    <option value="">Choose a reviewer</option>
                    {campaign.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
                  </select>
                </label>
                <label className="field">Routing reason<input value={routeReason} onChange={(e) => setRouteReason(e.target.value)} placeholder="Why this reviewer" /></label>
                <ul className="log">
                  {unrouted.map((i) => <li key={i.id}><span className="seq mono">{i.entitlement.id}</span><span>{i.identity.displayName} · {i.entitlement.privilege} on {i.resource.name} <button className="btn small ghost" disabled={!routeTarget || !routeReason.trim() || !!closed} onClick={() => route(i.id)}>Route</button></span></li>)}
                </ul>
              </div>
            </details>
          )}

          {selected.size > 0 && (
            <div className="bulk" role="group" aria-label="Bulk actions">
              <strong>{selected.size} selected</strong>
              <button className="btn small approve" onClick={() => bulk('approve')} disabled={!!closed}>Approve selected</button>
              <button className="btn small revoke" onClick={() => bulk('revoke')} disabled={!!closed}>Revoke selected</button>
              <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
              <span>Bulk actions use the reason typed in the drawer; flagged items require one. All-or-nothing.</span>
            </div>
          )}

          <div className="table-wrap">
            {visible.length === 0 ? (
              <p className="empty">{myItems.length === 0 ? 'This reviewer has no items in the campaign.' : filter === 'pending' ? 'Nothing pending for this reviewer. Switch filter to “All” to see decided items or export the certification.' : 'No items match this filter.'}</p>
            ) : (
              <table className="review">
                <caption className="sr-only">Entitlements awaiting review for {campaign.reviewers.find((r) => r.id === actor)?.name}</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Select</span></th>
                    <th scope="col">Identity</th>
                    <th scope="col">Resource · privilege</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Risk hints</th>
                    <th scope="col">Risk</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id} tabIndex={item.id === focusId ? 0 : -1} ref={(el) => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id); }}
                      className={item.id === focusId ? 'focused' : ''} aria-selected={selected.has(item.id)}
                      onClick={() => setFocusId(item.id)} onFocus={() => setFocusId(item.id)} onKeyDown={(e) => onRowKey(e, item)}>
                      <td><input type="checkbox" aria-label={`Select ${item.entitlement.privilege} for ${item.identity.displayName}`} checked={selected.has(item.id)}
                        onChange={() => setSelected((s) => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })} onClick={(e) => e.stopPropagation()} /></td>
                      <td><div className="who"><span>{item.identity.displayName}</span><span className="sub mono">{item.identity.id} · {item.identity.roleType} · {item.identity.status}</span></div></td>
                      <td><div className="who"><span>{item.resource.name}</span><span className="sub mono">{item.entitlement.privilege}{item.entitlement.privileged ? ' · privileged' : ''}</span></div></td>
                      <td className="mono">{item.entitlement.lastUsed ?? 'never'}</td>
                      <td>{item.hints.length === 0 ? <span className="sub">none</span> : item.hints.map((h) => <span key={h.kind} className={`hint ${h.kind}`}>{HINT_LABEL[h.kind]}</span>)}</td>
                      <td className="risk" style={{ color: item.riskScore >= 50 ? 'var(--risk-high)' : item.riskScore >= 20 ? 'var(--risk-mid)' : 'var(--risk-low)' }}>{item.riskScore}</td>
                      <td><span className={`stamp ${item.state}`}>{item.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="drawer" aria-labelledby="drawer-h">
          <h2 id="drawer-h">Evidence &amp; decision</h2>
          {notice && <p className={`notice ${notice.tone}`} role="status">{notice.text}</p>}
          {!focused ? <p className="empty">Select a row to see why it was flagged and record a decision.</p> : (
            <>
              <dl className="subject">
                <dt>Entitlement</dt><dd><span className="mono">{focused.entitlement.id}</span> · {focused.entitlement.privilege} on {focused.resource.name} ({focused.resource.sensitivity} sensitivity)</dd>
                <dt>Identity</dt><dd>{focused.identity.displayName} · {focused.identity.department} · {focused.identity.roleType} · status {focused.identity.status} · last sign-in {focused.identity.lastSignIn ?? 'never'}</dd>
                <dt>Granted / last used</dt><dd className="mono">{focused.entitlement.grantedOn} / {focused.entitlement.lastUsed ?? 'never'}</dd>
                <dt>Reviewer</dt><dd className="mono">{focused.reviewerId ?? 'unrouted'}</dd>
              </dl>
              <h3>Why this is flagged (score {focused.riskScore})</h3>
              {focused.hints.length === 0 ? <p className="notice">No risk hints. Approval does not require a reason; a reason is still recorded if given.</p> : (
                <ul className="evidence">
                  {focused.hints.map((h) => <li key={h.kind} className={h.kind}><span className="k">{HINT_LABEL[h.kind]}</span>{h.detail}</li>)}
                </ul>
              )}
              {counterpart && <p className="notice warn">Counterpart <span className="mono">{counterpart.entitlement.id}</span> ({counterpart.entitlement.privilege}) is currently <strong>{counterpart.state}</strong>. Approving both sides needs a written SoD override.</p>}
              <h3>Decision</h3>
              <form className="decide" onSubmit={(e) => e.preventDefault()}>
                <label>Reason {focused.hints.length > 0 && <span aria-hidden="true">(required)</span>}
                  <textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} required={focused.hints.length > 0} aria-required={focused.hints.length > 0} placeholder="Business justification, or why access is being removed" />
                </label>
                {sodHint && (
                  <label>SoD override rationale (only if approving both sides)
                    <textarea value={overrideText} onChange={(e) => setOverrideText(e.target.value)} placeholder="Describe the compensating control, 10+ characters" />
                  </label>
                )}
                <label>Delegate to
                  <select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
                    <option value="">Choose a reviewer</option>
                    {delegateTargets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <div className="actions">
                  <button type="button" className="btn approve" onClick={() => decide('approve')} disabled={focused.reviewerId !== actor || !!closed}>Approve</button>
                  <button type="button" className="btn revoke" onClick={() => decide('revoke')} disabled={focused.reviewerId !== actor || !!closed}>Revoke</button>
                  <button type="button" className="btn delegate" onClick={() => decide('delegate')} disabled={focused.reviewerId !== actor || !delegateTo || !!closed}>Delegate</button>
                </div>
                {closed && <p className="notice warn">The campaign is closed; this item can no longer be decided or delegated.</p>}
                {!closed && focused.reviewerId !== actor && <p className="notice warn">Only {focused.reviewerId ?? 'an assigned reviewer'} can decide this item. Switch “Acting as reviewer” to simulate them.</p>}
              </form>
              <h3>Decision log for this item</h3>
              {campaign.decisions.filter((d) => d.itemId === focused.id).length === 0 ? <p className="sub">No decisions yet.</p> : (
                <ol className="log">
                  {campaign.decisions.filter((d) => d.itemId === focused.id).map((d) => (
                    <li key={d.seq}><span className="seq">#{d.seq}</span><span><strong>{d.decision}</strong> by <span className="mono">{d.actor}</span>{d.delegateTo ? <> → <span className="mono">{d.delegateTo}</span></> : null} — {d.reason || <em>no reason</em>}{d.sodOverride && <><br /><em>SoD override ({d.sodOverride.ruleId}):</em> {d.sodOverride.rationale}</>}</span></li>
                  ))}
                </ol>
              )}
            </>
          )}
        </aside>
      </main>
      <p className="footer-note">Attestline is an educational prototype. Identities, resources and entitlements are synthetic fixtures; nothing here reads a directory or changes any permission. Decisions live in memory and reset on refresh — export JSON/CSV to keep them. Not a compliance certification.</p>
    </div>
  );
}
