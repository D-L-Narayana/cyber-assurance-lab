// Builds src/fixtures/harbourline-board.json by replaying real events through the engine (so histories are genuine).
// Run: npx vite-node qa/make-fixture.ts   (or: npx tsx). Uses only the engine; no DOM.
import fs from 'node:fs';
import { applyEvent, newException, tick } from '../src/engine/lifecycle';
import type { Exception, Role } from '../src/engine/types';

const AS_OF = '2026-10-01';
const base = (p: Partial<Exception> & { id: string; title: string; riskLevel: Exception['riskLevel']; startOn: string; expiresOn: string }): Exception =>
  newException({
    policyRef: 'SEC-POL-07 §4.2 Patch timelines', requester: 'app.owner', owner: 'infra.lead',
    compensatingControls: ['Network isolation'], justification: 'Synthetic justification long enough to pass the policy minimum for this demo record.',
    requestedOn: '2026-09-01', remediation: { plan: 'Remediate.', dueOn: p.expiresOn, status: 'planned' }, ...p,
  });
const approve = (e: Exception, actor: string, role: Role, at: string, note = 'Approved.') => applyEvent(e, { type: 'approve', actor, role, note }, at);
const submitReview = (e: Exception, at: string) => applyEvent(applyEvent(e, { type: 'submit', actor: e.requester }, at), { type: 'start-review', actor: 'grc.analyst' }, at);

const list: Exception[] = [];
// 1 draft (incomplete, will fail submit guardrails)
list.push(base({ id: 'EX-101', title: 'Shared admin account on warehouse scanners', policyRef: 'SEC-POL-03 §2.1 Unique accounts', riskLevel: 'high', startOn: '2026-10-05', expiresOn: '2026-12-20', compensatingControls: [], justification: 'No per-user login.', requester: 'warehouse.lead', owner: 'ops.director' }));
// 2 submitted
list.push(applyEvent(base({ id: 'EX-102', title: 'TLS 1.1 on legacy EDI partner link', policyRef: 'SEC-POL-11 §5 Encryption in transit', riskLevel: 'moderate', startOn: '2026-10-01', expiresOn: '2027-02-28', requester: 'edi.owner', owner: 'integration.lead', justification: 'Partner cannot upgrade before Q1; link carries order numbers only, no personal data.', remediation: { plan: 'Partner upgrade to TLS 1.2+ scheduled Feb.', dueOn: '2027-02-15', status: 'planned' } }), { type: 'submit', actor: 'edi.owner' }, '2026-09-28'));
// 3 under review with one of two approvals
list.push(approve(submitReview(base({ id: 'EX-103', title: 'Legacy report server cannot receive October patches', riskLevel: 'high', startOn: '2026-10-01', expiresOn: '2026-12-15', compensatingControls: ['Reporting VLAN isolation', 'Weekly authenticated scan'], justification: 'Vendor patch breaks the reporting module; replacement platform go-live in December.', remediation: { plan: 'Migrate reports to the new platform and decommission the server.', dueOn: '2026-12-10', status: 'planned' } }), '2026-09-25'), 'line.manager', 'manager', '2026-09-26', 'Fine from a delivery standpoint.'));
// 4 active, healthy
{
  let e = submitReview(base({ id: 'EX-104', title: 'MFA exemption for printer service account', policyRef: 'SEC-POL-03 §4 MFA', riskLevel: 'moderate', startOn: '2026-08-01', expiresOn: '2027-01-15', requester: 'print.admin', owner: 'workplace.lead', justification: 'Service account cannot complete interactive MFA; restricted to print spooler host by firewall rule.', remediation: { plan: 'Replace with managed identity when spooler is migrated.', dueOn: '2027-01-10', status: 'in-progress' } }), '2026-07-20');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-07-22');
  list.push(e);
}
// 5 active, expiring within 14 days
{
  let e = submitReview(base({ id: 'EX-105', title: 'Unsupported OS on time-clock terminals', policyRef: 'SEC-POL-07 §3 Supported platforms', riskLevel: 'high', startOn: '2026-07-15', expiresOn: '2026-10-12', compensatingControls: ['Terminals on isolated VLAN, no internet egress'], justification: 'Hardware refresh delayed by supplier; terminals cannot run a supported OS.', requester: 'facilities', owner: 'ops.director', remediation: { plan: 'Replace 14 terminals.', dueOn: '2026-10-10', status: 'in-progress' } }), '2026-07-10');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-07-12'); e = approve(e, 'line.manager', 'manager', '2026-07-12');
  list.push(e);
}
// 6 expired (past expiry, within grace)
{
  let e = submitReview(base({ id: 'EX-106', title: 'Local admin rights for CAD workstation group', policyRef: 'SEC-POL-05 §2 Least privilege', riskLevel: 'moderate', startOn: '2026-04-01', expiresOn: '2026-09-25', requester: 'eng.lead', owner: 'it.director', justification: 'CAD plugin installer requires local admin; vendor fix promised but not delivered.', remediation: { plan: 'Deploy packaged installer via endpoint management.', dueOn: '2026-09-20', status: 'in-progress' } }), '2026-03-25');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-03-28');
  // Adversarial: a renewal was requested before expiry but never approved — the term must still expire and age (sixth-review repro).
  e = applyEvent(e, { type: 'renew', actor: 'eng.lead', newExpiresOn: '2026-11-20', note: 'Vendor says fix ships in Q4.' }, '2026-09-20');
  list.push(e); // tick() in the app moves it to expired at AS_OF despite the pending renewal
}
// 7 escalated (expired > 14 days)
{
  let e = submitReview(base({ id: 'EX-107', title: 'Unencrypted backup tapes in offsite store', policyRef: 'SEC-POL-11 §6 Encryption at rest', riskLevel: 'critical', startOn: '2026-08-01', expiresOn: '2026-08-30', compensatingControls: ['Locked cage with access log'], justification: 'Tape drive encryption module failed; replacement on order; tapes rotate monthly.', requester: 'backup.admin', owner: 'infra.lead', remediation: { plan: 'Install replacement encryption module and re-encrypt retained tapes.', dueOn: '2026-08-28', status: 'in-progress' } }), '2026-07-28');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-07-29'); e = approve(e, 'ciso', 'ciso', '2026-07-30', 'Accepted for one month only.');
  list.push(e);
}
// 8 closed with evidence
{
  let e = submitReview(base({ id: 'EX-108', title: 'Guest Wi-Fi shared PSK', policyRef: 'SEC-POL-09 §1 Wireless access', riskLevel: 'low', startOn: '2026-05-01', expiresOn: '2026-09-30', compensatingControls: [], requester: 'network.admin', owner: 'network.lead', justification: 'Captive portal rollout pending; guest network is internet-only and rate-limited.', remediation: { plan: 'Deploy captive portal with daily codes.', dueOn: '2026-09-15', status: 'planned' } }), '2026-04-20');
  e = approve(e, 'line.manager', 'manager', '2026-04-21');
  e = applyEvent(e, { type: 'update-remediation', actor: 'network.lead', status: 'in-progress', note: 'Portal in test.' }, '2026-08-01');
  e = applyEvent(e, { type: 'close', actor: 'network.lead', evidence: 'Captive portal live 2026-09-12; PSK retired; change CHG-4388 and controller screenshot in evidence locker.' }, '2026-09-14');
  list.push(e);
}
// 9 rejected
list.push(applyEvent(submitReview(base({ id: 'EX-109', title: 'Disable endpoint EDR on build agents', policyRef: 'SEC-POL-08 §2 Endpoint protection', riskLevel: 'critical', startOn: '2026-09-15', expiresOn: '2026-10-10', compensatingControls: ['Build agents are ephemeral'], requester: 'devops.lead', owner: 'platform.lead', justification: 'EDR adds 40% to build times; agents are rebuilt nightly from a golden image.', remediation: { plan: 'Tune EDR exclusions with vendor.', dueOn: '2026-10-05', status: 'planned' } }), '2026-09-10'), { type: 'reject', actor: 'ciso', note: 'Tune exclusions instead of disabling; ephemeral agents still process source code.' }, '2026-09-12'));
// 10 active with 2 renewals (cannot renew again) — long-running, over policy max after import (guardrail visible)
{
  let e = submitReview(base({ id: 'EX-110', title: 'Vendor remote support via shared VPN account', policyRef: 'SEC-POL-03 §2.1 Unique accounts', riskLevel: 'high', startOn: '2026-01-10', expiresOn: '2026-04-10', compensatingControls: ['Session recording', 'Time-boxed VPN enablement'], justification: 'Vendor portal does not support named accounts; contract renegotiation in progress.', requester: 'erp.owner', owner: 'it.director', remediation: { plan: 'Move vendor to named accounts under new contract.', dueOn: '2026-04-01', status: 'in-progress' } }), '2026-01-05');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-01-06'); e = approve(e, 'line.manager', 'manager', '2026-01-06');
  e = applyEvent(e, { type: 'renew', actor: 'erp.owner', newExpiresOn: '2026-07-09', note: 'Contract not yet signed.' }, '2026-04-05');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-04-06'); e = approve(e, 'line.manager', 'manager', '2026-04-06');
  e = applyEvent(e, { type: 'renew', actor: 'erp.owner', newExpiresOn: '2026-10-07', note: 'Signed; migration under way.' }, '2026-07-01');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-07-02'); e = approve(e, 'line.manager', 'manager', '2026-07-02');
  list.push(e);
}
// 11 imported record violating policy (duration too long for critical) — stays active to show live guardrail
{
  let e = submitReview(base({ id: 'EX-111', title: 'Payment terminal firmware pinned to vulnerable version', policyRef: 'SEC-POL-07 §4.2 Patch timelines', riskLevel: 'high', startOn: '2026-09-01', expiresOn: '2026-11-25', compensatingControls: ['Terminals segmented; P2PE in use'], requester: 'retail.ops', owner: 'payments.lead', justification: 'Acquirer certification for new firmware not complete; P2PE limits exposure.', remediation: { plan: 'Deploy certified firmware.', dueOn: '2026-11-20', status: 'planned' } }), '2026-08-25');
  e = approve(e, 'risk.owner', 'risk-owner', '2026-08-26'); e = approve(e, 'line.manager', 'manager', '2026-08-26');
  e = { ...e, riskLevel: 'critical' }; // re-rated after approval: 85 days now exceeds the 30-day critical maximum
  list.push(e);
}
// 12 under review: critical, has ciso but still needs risk-owner
list.push(approve(submitReview(base({ id: 'EX-112', title: 'Production database reachable from developer VLAN', policyRef: 'SEC-POL-10 §3 Network segmentation', riskLevel: 'critical', startOn: '2026-10-01', expiresOn: '2026-10-28', compensatingControls: ['Database firewall allow-list by host'], requester: 'dba.lead', owner: 'data.platform', justification: 'Migration tooling requires direct access during cut-over window; allow-list limits to two hosts.', remediation: { plan: 'Remove allow-list entries after cut-over.', dueOn: '2026-10-27', status: 'planned' } }), '2026-09-29'), 'ciso', 'ciso', '2026-09-30', 'Only for the cut-over window.'));

const board = { schema: 'graceline.board/1', asOf: AS_OF, exceptions: list };
fs.writeFileSync('src/fixtures/harbourline-board.json', JSON.stringify(board, null, 2) + '\n');
const states = list.map((e) => tick(e, AS_OF).state);
console.log('wrote', list.length, 'exceptions; states at asOf:', states.join(', '));
