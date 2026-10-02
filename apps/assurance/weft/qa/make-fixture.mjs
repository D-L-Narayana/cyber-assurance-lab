// Generates src/fixtures/harbourline-bundle.json with real hashes and planned defects.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const canonical = (v) => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);

const assertions = [
  { id: 'AS-01', controlRef: 'CSF 2.0 PR.DS-11', statement: 'Backups of the dispatch database are created nightly and a restore is tested each quarter.', owner: 'platform.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { id: 'AS-02', controlRef: 'CSF 2.0 PR.AA-05', statement: 'Privileged access to production is reviewed quarterly and excess entitlements are removed.', owner: 'identity.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { id: 'AS-03', controlRef: 'SP 800-53 Rev. 5 SI-2', statement: 'Critical security patches are applied to in-scope servers within 14 days of release.', owner: 'infra.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { id: 'AS-04', controlRef: 'CSF 2.0 DE.CM-01', statement: 'Network IDS alerts are reviewed weekly and escalations are recorded.', owner: 'secops.lead', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { id: 'AS-05', controlRef: 'CSF 2.0 PR.AT-01', statement: 'All staff completed security awareness training in the period.', owner: 'hr.systems', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { id: 'AS-06', controlRef: 'CSF 2.0 GV.SC-07', statement: 'Tier-1 suppliers were risk-reviewed in the period.', owner: 'procurement', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
];
const art = (id, name, kind, capturedOn, content, declared) => ({ id, name, kind, capturedOn, content, ...(declared === undefined ? { declaredSha256: h(content) } : declared === null ? {} : { declaredSha256: declared }) });
const artifacts = [
  art('AR-01', 'backup-jobs-2026-09.log', 'log', '2026-09-28', '2026-09-27 02:00 full OK 412GB\n2026-09-28 02:00 full OK 413GB\n2026-09-29 02:00 full OK 413GB'),
  art('AR-02', 'restore-test-Q3.md', 'markdown', '2026-09-12', '# Restore test Q3\nRST-77 restored 5 sampled objects; checksum PASSED 5/5.'),
  art('AR-03', 'privileged-review-Q3.csv', 'csv', '2026-09-20', 'account,role,decision\nadm.r.kaur,dispatch-admin,keep\nadm.t.ng,dispatch-admin,revoke'),
  art('AR-04', 'privileged-review-Q2.csv', 'csv', '2026-06-18', 'account,role,decision\nadm.r.kaur,dispatch-admin,keep\nadm.j.alvarez,dispatch-admin,keep'),
  art('AR-05', 'patch-compliance-2026-09.md', 'markdown', '2026-09-30', '# Patch compliance September\nIn scope 42. Within 14 days 38. Overdue 4.', '0000000000000000000000000000000000000000000000000000000000000000'),
  art('AR-06', 'ids-weekly-W37.log', 'log', '2026-09-19', 'W37: 4 alerts reviewed; 1 escalated EXP-2291; closed authorised.'),
  art('AR-07', 'ids-weekly-W37-copy.log', 'log', '2026-09-19', 'W37: 4 alerts reviewed; 1 escalated EXP-2291; closed authorised.'),
  art('AR-08', 'training-completion.csv', 'csv', '2026-10-01', 'staff,completed\n214,214'),
  art('AR-09', 'firewall-change-CHG-4411.note', 'note', '2026-08-30', 'Firewall rule review ticket closed; no exceptions.', null),
  art('AR-10', 'supplier-review-2025.md', 'markdown', '2025-11-20', '# Supplier review 2025\nTier-1 suppliers reviewed: 7/7.'),
];
const links = [
  { assertionId: 'AS-01', artifactId: 'AR-01' }, { assertionId: 'AS-01', artifactId: 'AR-02' },
  { assertionId: 'AS-02', artifactId: 'AR-03' }, { assertionId: 'AS-02', artifactId: 'AR-04', note: 'Previous quarter attached by mistake' },
  { assertionId: 'AS-03', artifactId: 'AR-05' },
  { assertionId: 'AS-04', artifactId: 'AR-06' }, { assertionId: 'AS-04', artifactId: 'AR-07' },
  { assertionId: 'AS-05', artifactId: 'AR-08', note: 'Captured one day after the period' },
  { assertionId: 'AS-06', artifactId: 'AR-10' },
  { assertionId: 'AS-07', artifactId: 'AR-01' }, // broken: unknown assertion
];
const bundle = { schema: 'weft.bundle/1', name: 'Harbourline Q3 2026 control evidence (synthetic)', asOf: '2026-10-01', assertions, artifacts, links, signoffs: [] };
// Valid sign-off on AS-01 computed against the current evidence; stale sign-off on AS-02 computed before AR-04 was linked.
const hashes = Object.fromEntries(artifacts.map((a) => [a.id, h(a.content)]));
const bind = (id, artIds) => {
  const s = assertions.find((x) => x.id === id);
  const evidence = artIds.map((a) => { const art = artifacts.find((x) => x.id === a); return { id: art.id, capturedOn: art.capturedOn, sha256: hashes[a] }; }).sort((a, b) => a.id.localeCompare(b.id) || a.sha256.localeCompare(b.sha256));
  return h(canonical({ v: 2, assertionId: s.id, controlRef: s.controlRef, statement: s.statement, periodStart: s.periodStart, periodEnd: s.periodEnd, evidence }));
};
bundle.signoffs = [
  { assertionId: 'AS-01', reviewer: 'm.okafor', signedOn: '2026-09-29', bindingHash: bind('AS-01', ['AR-01', 'AR-02']) },
  { assertionId: 'AS-02', reviewer: 'm.okafor', signedOn: '2026-09-21', bindingHash: bind('AS-02', ['AR-03']) },
];
fs.writeFileSync('src/fixtures/harbourline-bundle.json', JSON.stringify(bundle, null, 2) + '\n');
console.log('wrote', artifacts.length, 'artifacts', assertions.length, 'assertions', links.length, 'links');
