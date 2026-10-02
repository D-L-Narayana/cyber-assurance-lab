import fs from 'node:fs';
const A = (q1, q2, q3, q4, q5, q6, q7, q8) => ({ q1, q2, q3, q4, q5, q6, q7, q8 });
const ev = (id, type, title, issuedOn, validMonths, note) => ({ id, type, title, issuedOn, validMonths, ...(note ? { note } : {}) });
const vendors = [
  // Tier 1, hard trigger, well evidenced except pen test expiring
  { id: 'V-01', name: 'Northwind Freight Analytics', service: 'Route optimisation SaaS with warehouse agent', owner: 'ops.lead', recordedTier: 1, lastReviewOn: '2026-02-10',
    answers: A('confidential', 'privileged', 'immediate', 'lt1m', 'few', 'multi', 'embedded', 'large'),
    evidence: [ev('E-01', 'assurance-report', 'SOC 2 Type II report (synthetic)', '2026-03-01', 12), ev('E-02', 'pen-test', 'Annual pen test summary', '2025-10-20', 12, 'Expires in 19 days'), ev('E-03', 'bcp-dr-test', 'DR failover test', '2026-05-12', 12), ev('E-04', 'questionnaire', 'Security questionnaire v3', '2026-01-15', 12), ev('E-05', 'insurance', 'Cyber insurance certificate', '2026-04-01', 12), ev('E-06', 'dpa', 'DPA v2', '2024-06-01', 36)], exceptions: [] },
  // Tier 1 by score, review overdue, assurance report expired, no DPA
  { id: 'V-02', name: 'Harbour Payroll Services', service: 'Payroll processing', owner: 'hr.systems', recordedTier: 1, lastReviewOn: '2025-06-30',
    answers: A('regulated', 'api-write', 'degraded', 'lt10k', 'several', 'domestic', 'realtime', 'moderate'),
    evidence: [ev('E-07', 'assurance-report', 'ISO/IEC 27001 certificate (synthetic)', '2025-01-10', 12), ev('E-08', 'pen-test', 'Pen test summary', '2026-06-01', 12), ev('E-09', 'bcp-dr-test', 'BCP test', '2026-02-01', 12), ev('E-10', 'questionnaire', 'Questionnaire', '2026-06-01', 12), ev('E-11', 'insurance', 'Insurance cert', '2026-06-01', 12)], exceptions: [] },
  // Tier 2, recorded as tier 3 (drift), questionnaire valid, assurance missing with active exception
  { id: 'V-03', name: 'Quayside Customer Desk', service: 'Helpdesk ticketing', owner: 'support.mgr', recordedTier: 3, lastReviewOn: '2025-11-05',
    answers: A('personal', 'api-read', 'workaround', 'lt100k', 'few', 'domestic', 'realtime', 'moderate'),
    evidence: [ev('E-12', 'questionnaire', 'Questionnaire', '2026-04-02', 12), ev('E-13', 'dpa', 'DPA', '2025-04-02', 36)],
    exceptions: [{ id: 'X-01', evidenceType: 'assurance-report', approvedBy: 'ciso', rationale: 'Vendor SOC 2 audit in progress; bridge letter received. Re-check 2026-12-15.', expiresOn: '2026-12-15' }] },
  // Tier 2, unknown subprocessors trigger, exception expired
  { id: 'V-04', name: 'Lantern Marketing Cloud', service: 'Email campaign platform', owner: 'marketing.ops', recordedTier: 2, lastReviewOn: '2026-01-20',
    answers: A('personal', 'portal', 'convenience', 'lt1m', 'unknown', 'multi', 'batch', 'small'),
    evidence: [ev('E-14', 'questionnaire', 'Questionnaire', '2026-01-10', 12), ev('E-15', 'dpa', 'DPA', '2026-01-10', 36)],
    exceptions: [{ id: 'X-02', evidenceType: 'assurance-report', approvedBy: 'ciso', rationale: 'Report requested from vendor.', expiresOn: '2026-08-31' }] },
  // Tier 3, complete and clean
  { id: 'V-05', name: 'Pier 9 Office Supplies', service: 'Stationery procurement portal', owner: 'facilities', recordedTier: 3, lastReviewOn: '2026-07-01',
    answers: A('internal', 'none', 'none', 'lt1k', 'none', 'domestic', 'manual', 'small'),
    evidence: [ev('E-16', 'questionnaire', 'Lite questionnaire', '2026-07-01', 24)], exceptions: [] },
  // Tier 3 with questionnaire expired and no review
  { id: 'V-06', name: 'Bollard Translation Co.', service: 'Document translation', owner: 'legal.ops', recordedTier: 3,
    answers: A('confidential', 'none', 'convenience', 'lt1k', 'few', 'domestic', 'manual', 'small'),
    evidence: [ev('E-17', 'questionnaire', 'Questionnaire', '2024-03-01', 24)], exceptions: [] },
  // Incomplete questionnaire (q3, q7 missing) → scored at max, tier up
  { id: 'V-07', name: 'Skylark Telemetry', service: 'Fleet telematics', owner: 'fleet.mgr', recordedTier: 2, lastReviewOn: '2026-03-15',
    answers: { q1: 'personal', q2: 'api-read', q4: 'lt1m', q5: 'several', q6: 'multi', q8: 'moderate' },
    evidence: [ev('E-18', 'questionnaire', 'Questionnaire', '2026-03-15', 12), ev('E-19', 'assurance-report', 'SOC 2 Type II (synthetic)', '2026-02-01', 12), ev('E-20', 'dpa', 'DPA', '2026-03-15', 36)], exceptions: [] },
  // Tier 2 exactly at the boundary — sensitivity showcase
  { id: 'V-08', name: 'Mooring Line Insurance Brokers', service: 'Insurance brokerage portal', owner: 'finance.ctrl', recordedTier: 2, lastReviewOn: '2025-12-01',
    answers: A('regulated', 'none', 'workaround', 'lt1k', 'none', 'onprem', 'manual', 'small'),
    evidence: [ev('E-21', 'questionnaire', 'Questionnaire', '2025-12-01', 12), ev('E-22', 'assurance-report', 'ISO/IEC 27001 certificate (synthetic)', '2025-06-01', 24), ev('E-23', 'dpa', 'DPA', '2025-12-01', 36)], exceptions: [] },
  // Tier 1 by score without hard trigger; everything missing (new vendor)
  { id: 'V-09', name: 'Deepwater Data Lake Co.', service: 'Managed analytics warehouse', owner: 'data.platform', recordedTier: 1,
    answers: A('confidential', 'api-write', 'degraded', 'ge1m', 'several', 'restricted', 'realtime', 'large'),
    evidence: [ev('E-40', 'pen-test', 'Pen test summary (date typo)', '2027-03-15', 12, 'Adversarial fixture: issued after the assessment date — earns no credit')], exceptions: [] },
  // Tier 3 just below tier 2 boundary
  { id: 'V-10', name: 'Gull Street Catering', service: 'Canteen services with staff dietary data', owner: 'facilities', recordedTier: 3, lastReviewOn: '2026-08-20',
    answers: A('personal', 'portal', 'convenience', 'lt10k', 'few', 'domestic', 'manual', 'small'),
    evidence: [ev('E-24', 'questionnaire', 'Lite questionnaire', '2026-08-20', 24)], exceptions: [] },
  // Tier 2, evidence item with validMonths longer than requirement (cap applies)
  { id: 'V-11', name: 'Tidewater Learning', service: 'LMS for staff training', owner: 'hr.systems', recordedTier: 2, lastReviewOn: '2025-05-05',
    answers: A('personal', 'api-read', 'convenience', 'lt10k', 'few', 'multi', 'realtime', 'moderate'),
    evidence: [ev('E-25', 'questionnaire', 'Questionnaire', '2025-05-05', 60, 'validMonths 60 but tier 2 caps at 12'), ev('E-26', 'assurance-report', 'SOC 2 Type II (synthetic)', '2025-05-05', 24), ev('E-27', 'dpa', 'DPA', '2025-05-05', 36)], exceptions: [] },
  // Tier 1 hard trigger, fully covered and reviewed (quiet)
  { id: 'V-12', name: 'Keel Managed Security', service: 'MDR with privileged agent', owner: 'secops.lead', recordedTier: 1, lastReviewOn: '2026-08-01',
    answers: A('confidential', 'privileged', 'workaround', 'lt100k', 'few', 'domestic', 'embedded', 'large'),
    evidence: [ev('E-28', 'assurance-report', 'SOC 2 Type II (synthetic)', '2026-07-01', 12), ev('E-29', 'pen-test', 'Pen test summary', '2026-07-01', 12), ev('E-30', 'bcp-dr-test', 'DR test', '2026-07-01', 12), ev('E-31', 'questionnaire', 'Questionnaire', '2026-07-01', 12), ev('E-32', 'insurance', 'Insurance cert', '2026-07-01', 12), ev('E-33', 'dpa', 'DPA', '2026-07-01', 36)], exceptions: [] },
  // Tier 3, review due soon
  { id: 'V-13', name: 'Anchor Print Shop', service: 'Printed collateral', owner: 'marketing.ops', recordedTier: 3, lastReviewOn: '2023-11-10',
    answers: A('internal', 'none', 'none', 'lt1k', 'none', 'domestic', 'manual', 'small'),
    evidence: [ev('E-34', 'questionnaire', 'Lite questionnaire', '2025-11-10', 24)], exceptions: [] },
  // Tier 2 with duplicate evidence of same type (newest wins)
  { id: 'V-14', name: 'Brightwater Recruiting', service: 'Applicant tracking', owner: 'hr.systems', recordedTier: 2, lastReviewOn: '2025-09-15',
    answers: A('personal', 'api-write', 'convenience', 'lt100k', 'few', 'domestic', 'realtime', 'moderate'),
    evidence: [ev('E-35', 'questionnaire', 'Questionnaire 2024', '2024-09-01', 12), ev('E-36', 'questionnaire', 'Questionnaire 2025', '2025-09-15', 12), ev('E-37', 'assurance-report', 'SOC 2 Type II (synthetic)', '2025-09-15', 24), ev('E-38', 'dpa', 'DPA', '2025-09-15', 36)], exceptions: [] },
  // Tier 2 with multiple exceptions and expiring exception
  { id: 'V-15', name: 'Compass Legal Hold', service: 'eDiscovery hosting', owner: 'legal.ops', recordedTier: 2, lastReviewOn: '2026-04-01',
    answers: A('confidential', 'portal', 'workaround', 'lt100k', 'few', 'domestic', 'batch', 'moderate'),
    evidence: [ev('E-39', 'questionnaire', 'Questionnaire', '2026-04-01', 12)],
    exceptions: [{ id: 'X-03', evidenceType: 'assurance-report', approvedBy: 'ciso', rationale: 'Vendor provides bridge letter; full report due Nov.', expiresOn: '2026-11-15' }, { id: 'X-04', evidenceType: 'dpa', approvedBy: 'legal.counsel', rationale: 'DPA under negotiation; interim confidentiality clause in MSA.', expiresOn: '2026-10-25' }] },
];
fs.writeFileSync('src/fixtures/harbourline-register.json', JSON.stringify({ schema: 'tierline.register/1', asOf: '2026-10-01', vendors }, null, 2) + '\n');
console.log('vendors', vendors.length);
