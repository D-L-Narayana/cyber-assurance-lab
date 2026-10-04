// Generates src/fixtures/dispatch-portal-packet.json with real SHA-256 hashes (one deliberately tampered) and a
// hash-chained history (October 2026 round). Run from the app directory: node qa/make-fixture.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// Same canonical form as src/engine/packet.ts `canonical` for a flat object of strings: sorted keys, JSON-encoded values.
const canonical = (o) => '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + JSON.stringify(o[k])).join(',') + '}';
// Same chain as the engine: hash = SHA-256(canonical({ at, from, to, actor, note, prevHash })), genesis prevHash = 64 zeros.
const chain = (entries) => {
  let prev = '0'.repeat(64);
  return entries.map((e) => {
    const hash = h(canonical({ ...e, prevHash: prev }));
    const out = { ...e, prevHash: prev, hash };
    prev = hash;
    return out;
  });
};
const art = (id, name, kind, capturedOn, content) => ({ id, name, kind, content, capturedOn, sha256: h(content) });
const artifacts = [
  art('ART-01', 'Account management procedure §3 excerpt', 'document-excerpt', '2026-09-18', 'Section 3. Account types: individual, shared-service (prohibited except break-glass), service, emergency. Approval by application owner recorded in ticket before provisioning. Disable within 5 business days of leaver notification.'),
  art('ART-02', 'Directory export — enabled accounts for leavers (Sep)', 'log-excerpt', '2026-09-22', 'uid=j.alvarez status=ENABLED leftOn=2026-08-01\nuid=t.nyberg status=ENABLED leftOn=2026-08-12\nuid=s.okoro status=DISABLED leftOn=2026-08-15'),
  art('ART-03', 'Interview note — identity team lead', 'interview-note', '2026-09-23', 'Interviewee confirms monthly leaver reconciliation against HR feed; two exceptions in August attributed to contractor records missing from HR feed.'),
  art('ART-04', 'Privilege matrix (roles → entitlements)', 'config-snippet', '2026-09-10', 'role=dispatch-admin: manage-routes, manage-users\nrole=dispatcher: view-routes, assign-driver\nrole=auditor: read-only'),
  art('ART-05', 'Logging configuration — api-gateway', 'config-snippet', '2026-09-15', 'events: [auth.success, auth.failure, admin.change, data.export]\nretention_days: 365\nforward_to: siem.example'),
  art('ART-06', 'SIEM weekly review record W37', 'log-excerpt', '2026-09-19', 'Week 37: 4 alerts reviewed, 1 escalated (EXP-2291 data export outside hours), closed as authorised bulk export.'),
  art('ART-07', 'Backup job log — nightly', 'log-excerpt', '2026-09-28', '2026-09-27 02:00 full backup OK 412 GB encrypted AES-256 target=vault.example\n2026-09-28 02:00 full backup OK 413 GB'),
  art('ART-08', 'Restore test — screenshot description', 'screenshot-description', '2026-09-29', 'Screenshot shows restore job RST-77 completed with checksum verification PASSED for 5/5 sampled objects.'),
  art('ART-09', 'Patch compliance report (September)', 'document-excerpt', '2026-09-30', 'Servers in scope: 42. Critical patches within 14 days: 38 (90%). Overdue: 4 (dispatch-db-02, dispatch-db-03, legacy-report-01, bastion-02).'),
  art('ART-10', 'Firewall rule export — DMZ boundary', 'config-snippet', '2026-09-26', 'permit tcp any dmz-web 443\ndeny ip dmz-web internal-db any log\npermit tcp internal-app internal-db 5432'),
];
// Deliberate tamper: content edited after hashing (hash no longer matches)
artifacts[3].content = artifacts[3].content + '\nrole=contractor-temp: manage-users';
const steps = [
  { id: 'S-01', controlId: 'AC-2', method: 'examine', object: 'Account management procedure', status: 'performed', evidenceIds: ['ART-01'], notes: 'Procedure defines account types and approval.' },
  { id: 'S-02', controlId: 'AC-2', method: 'examine', object: 'Directory export for August leavers', status: 'performed', evidenceIds: ['ART-02'], notes: 'Two leavers still enabled > 30 days.' },
  { id: 'S-03', controlId: 'AC-2', method: 'interview', object: 'Identity team lead', status: 'performed', evidenceIds: ['ART-03'], notes: '' },
  { id: 'S-04', controlId: 'AC-2', method: 'test', object: 'Automated disable of inactive accounts', status: 'skipped', evidenceIds: [], notes: '' },
  { id: 'S-05', controlId: 'AC-6', method: 'examine', object: 'Privilege matrix', status: 'performed', evidenceIds: ['ART-04'], notes: 'Matrix reviewed; see tamper warning.' },
  { id: 'S-06', controlId: 'AC-6', method: 'interview', object: 'Application owner', status: 'planned', evidenceIds: [], notes: '' },
  { id: 'S-07', controlId: 'AU-2', method: 'examine', object: 'Logging configuration api-gateway', status: 'performed', evidenceIds: ['ART-05'], notes: '' },
  { id: 'S-08', controlId: 'AU-2', method: 'test', object: 'Generate auth.failure and confirm in SIEM', status: 'performed', evidenceIds: ['ART-99'], notes: 'Evidence id typo — artifact does not exist.' },
  { id: 'S-09', controlId: 'AU-6', method: 'examine', object: 'Weekly SIEM review records', status: 'performed', evidenceIds: ['ART-06'], notes: '' },
  { id: 'S-10', controlId: 'AU-6', method: 'interview', object: 'SOC analyst', status: 'performed', evidenceIds: [], notes: 'Interview held; note not yet captured as artifact.' },
  { id: 'S-11', controlId: 'CP-9', method: 'examine', object: 'Backup job logs', status: 'performed', evidenceIds: ['ART-07'], notes: '' },
  { id: 'S-12', controlId: 'CP-9', method: 'test', object: 'Restore sample and verify checksum', status: 'performed', evidenceIds: ['ART-08'], notes: '' },
  { id: 'S-13', controlId: 'SI-2', method: 'examine', object: 'Patch compliance report', status: 'performed', evidenceIds: ['ART-09'], notes: '4 overdue servers.' },
  { id: 'S-14', controlId: 'SC-7', method: 'examine', object: 'DMZ firewall rule export', status: 'performed', evidenceIds: ['ART-10'], notes: '' },
  { id: 'S-15', controlId: 'SC-7', method: 'test', object: 'Attempt DMZ→DB connection from test host', status: 'planned', evidenceIds: [], notes: '' },
];
const determinations = [
  { controlId: 'AC-2', determinationId: 'AC-2.a', result: 'satisfied', stepIds: ['S-01'], rationale: 'Account types and prohibitions documented in §3.' },
  { controlId: 'AC-2', determinationId: 'AC-2.d', result: 'satisfied', stepIds: ['S-01', 'S-03'], rationale: 'Approval recorded before provisioning per procedure and interview.' },
  { controlId: 'AC-2', determinationId: 'AC-2.h', result: 'other-than-satisfied', stepIds: ['S-02', 'S-03'], rationale: 'Two leavers remained enabled beyond the 5-business-day requirement.' },
  { controlId: 'AC-6', determinationId: 'AC-6.1', result: 'satisfied', stepIds: ['S-05'], rationale: 'Privileged roles defined.' },
  { controlId: 'AU-2', determinationId: 'AU-2.a', result: 'satisfied', stepIds: ['S-07'], rationale: 'Event types enumerated.' },
  { controlId: 'AU-2', determinationId: 'AU-2.c', result: 'satisfied', stepIds: ['S-07', 'S-08'], rationale: 'Selected events and forwarding configured.' },
  { controlId: 'AU-6', determinationId: 'AU-6.a', result: 'satisfied', stepIds: ['S-09'], rationale: 'Weekly review evidenced.' },
  { controlId: 'AU-6', determinationId: 'AU-6.b', result: 'satisfied', stepIds: ['S-10'], rationale: 'Escalation path confirmed in interview.' },
  { controlId: 'CP-9', determinationId: 'CP-9.a', result: 'satisfied', stepIds: ['S-11'], rationale: 'Nightly backups logged.' },
  { controlId: 'CP-9', determinationId: 'CP-9.b', result: 'satisfied', stepIds: ['S-11'], rationale: 'Full backups include system state.' },
  { controlId: 'CP-9', determinationId: 'CP-9.d', result: 'satisfied', stepIds: ['S-12'], rationale: 'Encrypted; restore verified.' },
  { controlId: 'SI-2', determinationId: 'SI-2.a', result: 'satisfied', stepIds: ['S-13'], rationale: 'Flaws identified and tracked.' },
  { controlId: 'SI-2', determinationId: 'SI-2.c', result: 'other-than-satisfied', stepIds: ['S-13'], rationale: '4 of 42 servers exceed the 14-day window.' },
  { controlId: 'SC-7', determinationId: 'SC-7.a', result: 'satisfied', stepIds: ['S-14'], rationale: 'Deny rule with logging at DMZ boundary.' },
];
const findings = [
  { id: 'F-01', controlId: 'AC-2', determinationId: 'AC-2.h', description: 'Leaver accounts j.alvarez and t.nyberg remained enabled 30+ days after departure.', severity: 'moderate', action: { description: 'Disable both accounts; add contractor records to HR feed.', owner: 'identity.team', dueOn: '2026-09-15', status: 'in-progress' } },
  { id: 'F-02', controlId: 'CP-9', determinationId: 'CP-9.d', description: 'Historic finding from the previous cycle about unencrypted backups.', severity: 'low', action: { description: 'Verify encryption at rest.', owner: 'platform.team', dueOn: '2026-12-01', status: 'open' } },
];
// A previous review cycle, back in drafting. These entries are written by this generator, not replayed through the engine's
// `transition` (which would refuse to submit the deliberately incomplete packet above); they are chained with the engine's
// exact scheme so `verifyHistoryChain` reports the fixture as verified and tests/history-chain.test.ts asserts it.
const history = chain([
  { at: '2026-09-26', from: 'drafting', to: 'ready-for-review', actor: 'a.mensah', note: 'First pass submitted for review.' },
  { at: '2026-09-29', from: 'ready-for-review', to: 'returned', actor: 'p.lindqvist', note: 'Returned: the AC-6 interview with the application owner is still planned and the SC-7 boundary test has not been attempted; complete or document them before resubmitting.' },
  { at: '2026-09-30', from: 'returned', to: 'drafting', actor: 'a.mensah', note: 'Reopened to address the return note.' },
]);
const packet = {
  schema: 'packetsmith.packet/1',
  meta: { systemName: 'Harbourline Dispatch Portal (synthetic)', assessor: 'a.mensah', approver: 'p.lindqvist', asOf: '2026-10-01' },
  selectedControls: ['AC-2', 'AC-6', 'AU-2', 'AU-6', 'CP-9', 'SI-2', 'SC-7'],
  steps, artifacts, determinations, findings,
  state: 'drafting',
  history,
};
fs.writeFileSync('src/fixtures/dispatch-portal-packet.json', JSON.stringify(packet, null, 2) + '\n');
console.log('wrote fixture', artifacts.length, 'artifacts', steps.length, 'steps', history.length, 'chained history entries');

// Import samples for browser QA (qa/samples/). Both are synthetic and derived from the fixture above.
fs.mkdirSync('qa/samples', { recursive: true });
// 1. A complete AC-2-only packet already submitted for review: zero completeness blockers, one chained history entry, so the
//    approver can act on it in the UI (approve / return) and the chain gains a second linked entry.
const readyArtifacts = [artifacts[0]]; // untampered ART-01 (hash matches its content)
const readySteps = [
  { id: 'S-01', controlId: 'AC-2', method: 'examine', object: 'Account management procedure', status: 'performed', evidenceIds: ['ART-01'], notes: 'Procedure defines account types and approval.' },
  { id: 'S-02', controlId: 'AC-2', method: 'interview', object: 'Identity team lead', status: 'performed', evidenceIds: ['ART-01'], notes: 'Confirmed the procedure is followed.' },
];
const readyDeterminations = ['AC-2.a', 'AC-2.d', 'AC-2.h'].map((determinationId) => ({ controlId: 'AC-2', determinationId, result: 'satisfied', stepIds: ['S-01', 'S-02'], rationale: 'Documented in §3 and confirmed in interview.' }));
const ready = {
  schema: 'packetsmith.packet/1',
  meta: { systemName: 'Harbourline Dispatch Portal — AC-2 slice (synthetic)', assessor: 'a.mensah', approver: 'p.lindqvist', asOf: '2026-10-01' },
  selectedControls: ['AC-2'],
  steps: readySteps, artifacts: readyArtifacts, determinations: readyDeterminations, findings: [],
  state: 'ready-for-review',
  history: chain([{ at: '2026-10-01', from: 'drafting', to: 'ready-for-review', actor: 'a.mensah', note: 'AC-2 complete; submitted for review.' }]),
};
fs.writeFileSync('qa/samples/ready-for-review-packet.json', JSON.stringify(ready, null, 2) + '\n');
// 2. The fixture with history[1].note edited after the fact while every hash is left as it was: the validator must refuse it
//    with "history hash chain broken" addressed to history[1].
const tampered = JSON.parse(JSON.stringify(packet));
tampered.history[1].note = 'Returned for minor wording only; otherwise ready to approve.';
fs.writeFileSync('qa/samples/tampered-history-packet.json', JSON.stringify(tampered, null, 2) + '\n');
console.log('wrote qa/samples/ready-for-review-packet.json and qa/samples/tampered-history-packet.json');
