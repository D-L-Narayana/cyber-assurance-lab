// Deterministic synthetic data-sharing register. node scripts/generate-fixture.mjs > src/fixtures/demo.json
const AS_OF = '2026-10-01';
const systems = [{ id: 's-hris', name: 'HRIS' }, { id: 's-crm', name: 'Customer CRM' }, { id: 's-billing', name: 'Billing' }, { id: 's-support', name: 'Support desk' }, { id: 's-warehouse', name: 'Analytics warehouse' }];
const vendors = [
  { id: 'v-payco', name: 'PayCo Example Ltd', country: 'IE', role: 'processor' },
  { id: 'v-mailwave', name: 'MailWave Sample Inc', country: 'US', role: 'processor' },
  { id: 'v-helpdeskr', name: 'Helpdeskr Fixture GmbH', country: 'DE', role: 'processor' },
  { id: 'v-benefits', name: 'BenefitBridge Demo', country: 'IN', role: 'controller' },
  { id: 'v-cloudstash', name: 'CloudStash Placeholder', country: 'US', role: 'processor' },
  { id: 'v-insightly', name: 'Insightly Example Analytics', country: 'GB', role: 'joint' },
];
const owners = [
  { id: 'o-ada', name: 'Ada Example (People Ops)', status: 'active' }, { id: 'o-bo', name: 'Bo Sample (Marketing)', status: 'active' },
  { id: 'o-cy', name: 'Cy Fixture (Support)', status: 'active' }, { id: 'o-dee', name: 'Dee Demo (Finance)', status: 'active' }, { id: 'o-left', name: 'Former owner (left 2026-04)', status: 'left' },
];
const ev = (ref, on) => ({ ref, on });
const ob = (id, kind, requirement, evidence = null) => ({ id, kind, requirement, evidence });
const agreements = [
  { id: 'ag-01', title: 'Payroll processing DPA', vendorId: 'v-payco', ownerId: 'o-ada', status: 'active', startOn: '2024-11-01', endOn: '2026-11-20', noticeDays: 60, categories: ['payroll', 'contact', 'bank_details'], purpose: 'Run monthly payroll', transferMechanism: 'intra-EEA (synthetic label)',
    obligations: [ob('ob-01a', 'encryption', 'AES-256 at rest', ev('SOC report excerpt (synthetic)', '2025-02-01')), ob('ob-01b', 'breach_notification', '24h'), ob('ob-01c', 'deletion_on_termination', '30 days after end'), ob('ob-01d', 'access_review', 'quarterly', ev('Q2 review memo', '2026-07-01'))] },
  { id: 'ag-02', title: 'PayCo reporting addendum', vendorId: 'v-payco', ownerId: 'o-dee', status: 'active', startOn: '2026-02-01', endOn: '2027-01-31', noticeDays: 90, categories: ['contact'], purpose: 'Headcount cost reporting', transferMechanism: 'intra-EEA (synthetic label)',
    obligations: [ob('ob-02a', 'breach_notification', '72h', ev('Addendum §3', '2026-02-01'))] },
  { id: 'ag-03', title: 'Newsletter delivery', vendorId: 'v-mailwave', ownerId: 'o-bo', status: 'active', startOn: '2024-07-01', endOn: '2026-07-31', noticeDays: 30, categories: ['contact', 'marketing_preferences'], purpose: 'Send marketing email', transferMechanism: 'SCC-style clauses (synthetic label)',
    obligations: [ob('ob-03a', 'subprocessor_notice', '30 days prior', ev('Vendor notice list', '2025-01-10')), ob('ob-03b', 'deletion_on_termination', '14 days after end')] },
  { id: 'ag-04', title: 'Transactional email', vendorId: 'v-mailwave', ownerId: 'o-bo', status: 'active', startOn: '2025-09-01', endOn: '2026-10-25', noticeDays: 45, categories: ['contact'], purpose: 'Receipts and password resets', transferMechanism: 'SCC-style clauses (synthetic label)',
    obligations: [ob('ob-04a', 'encryption', 'TLS 1.2+ in transit', ev('Config screenshot (synthetic)', '2025-09-01')), ob('ob-04b', 'breach_notification', '48h')] },
  { id: 'ag-05', title: 'Support ticketing platform', vendorId: 'v-helpdeskr', ownerId: 'o-cy', status: 'active', startOn: '2025-03-01', endOn: '2027-02-28', noticeDays: 90, categories: ['contact', 'support_history'], purpose: 'Customer support', transferMechanism: 'intra-EEA (synthetic label)',
    obligations: [ob('ob-05a', 'audit_right', 'annual', ev('Audit letter', '2026-03-15')), ob('ob-05b', 'breach_notification', '72h', ev('MSA §11', '2025-03-01')), ob('ob-05c', 'access_review', 'semi-annual')] },
  { id: 'ag-06', title: 'Employee benefits enrolment', vendorId: 'v-benefits', ownerId: 'o-left', status: 'active', startOn: '2024-01-01', endOn: '2026-12-31', noticeDays: 90, categories: ['contact', 'payroll', 'health'], purpose: 'Enrol staff in benefits', transferMechanism: 'controller-to-controller terms (synthetic label)',
    obligations: [ob('ob-06a', 'breach_notification', '72h', ev('Terms §7', '2024-01-01')), ob('ob-06b', 'encryption', 'AES-256 at rest'), ob('ob-06c', 'deletion_on_termination', '60 days after end')] },
  { id: 'ag-07', title: 'Backup storage', vendorId: 'v-cloudstash', ownerId: 'o-dee', status: 'active', startOn: '2023-10-01', endOn: '2026-09-30', noticeDays: 60, categories: ['contact', 'payroll', 'support_history', 'bank_details'], purpose: 'Encrypted off-site backups', transferMechanism: 'SCC-style clauses (synthetic label)',
    obligations: [ob('ob-07a', 'encryption', 'customer-managed keys', ev('KMS policy export (synthetic)', '2024-01-05')), ob('ob-07b', 'deletion_on_termination', '90 days after end')] },
  { id: 'ag-08', title: 'Backup storage — renewal 2026', vendorId: 'v-cloudstash', ownerId: 'o-dee', status: 'draft', startOn: '2026-10-01', endOn: '2029-09-30', noticeDays: 60, categories: ['contact', 'payroll', 'support_history', 'bank_details'], purpose: 'Encrypted off-site backups', transferMechanism: 'SCC-style clauses (synthetic label)',
    obligations: [ob('ob-08a', 'encryption', 'customer-managed keys'), ob('ob-08b', 'deletion_on_termination', '90 days after end')] },
  { id: 'ag-09', title: 'Product analytics', vendorId: 'v-insightly', ownerId: 'o-bo', status: 'renewing', startOn: '2025-10-15', endOn: '2026-10-14', noticeDays: 60, categories: ['usage_events'], purpose: 'Product usage analytics', transferMechanism: 'UK addendum (synthetic label)',
    obligations: [ob('ob-09a', 'subprocessor_notice', '30 days prior', ev('Subprocessor page snapshot', '2026-01-20'))] },
  { id: 'ag-10', title: 'Legacy survey tool', vendorId: 'v-insightly', ownerId: null, status: 'terminated', startOn: '2022-01-01', endOn: '2025-12-31', noticeDays: 30, categories: ['contact'], purpose: 'Customer surveys', transferMechanism: 'UK addendum (synthetic label)',
    obligations: [ob('ob-10a', 'deletion_on_termination', '30 days after end')] },
  { id: 'ag-11', title: 'Payslip e-delivery pilot', vendorId: 'v-payco', ownerId: 'o-ada', status: 'draft', startOn: '2026-11-01', endOn: '2027-04-30', noticeDays: 30, categories: [], purpose: 'Pilot electronic payslips', transferMechanism: 'tbd',
    obligations: [] },
  { id: 'ag-12', title: 'Helpdeskr AI summaries addendum', vendorId: 'v-helpdeskr', ownerId: 'o-cy', status: 'active', startOn: '2026-06-01', endOn: '2027-05-31', noticeDays: 60, categories: ['support_history'], purpose: 'Summarise tickets', transferMechanism: 'intra-EEA (synthetic label)',
    obligations: [ob('ob-12a', 'breach_notification', '24h', ev('Addendum §2', '2026-06-01')), ob('ob-12b', 'subprocessor_notice', '14 days prior')] },
];
const flows = [
  { id: 'fl-01', systemId: 's-hris', vendorId: 'v-payco', agreementId: 'ag-01', categories: ['payroll', 'contact', 'bank_details'], direction: 'outbound', active: true, lastTransferOn: '2026-09-28' },
  { id: 'fl-02', systemId: 's-warehouse', vendorId: 'v-payco', agreementId: 'ag-02', categories: ['contact'], direction: 'inbound', active: true, lastTransferOn: '2026-09-30' },
  { id: 'fl-03', systemId: 's-crm', vendorId: 'v-mailwave', agreementId: 'ag-03', categories: ['contact', 'marketing_preferences'], direction: 'outbound', active: true, lastTransferOn: '2026-09-27' },
  { id: 'fl-04', systemId: 's-billing', vendorId: 'v-mailwave', agreementId: 'ag-04', categories: ['contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-30' },
  { id: 'fl-05', systemId: 's-support', vendorId: 'v-helpdeskr', agreementId: 'ag-05', categories: ['contact', 'support_history'], direction: 'bidirectional', active: true, lastTransferOn: '2026-09-30' },
  { id: 'fl-06', systemId: 's-support', vendorId: 'v-helpdeskr', agreementId: 'ag-12', categories: ['support_history', 'contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-29' },
  { id: 'fl-07', systemId: 's-hris', vendorId: 'v-benefits', agreementId: 'ag-06', categories: ['contact', 'payroll', 'health'], direction: 'outbound', active: true, lastTransferOn: '2026-09-01' },
  { id: 'fl-08', systemId: 's-hris', vendorId: 'v-benefits', agreementId: 'ag-06', categories: ['identity_documents'], direction: 'outbound', active: true, lastTransferOn: '2026-08-15' },
  { id: 'fl-09', systemId: 's-warehouse', vendorId: 'v-cloudstash', agreementId: 'ag-07', categories: ['contact', 'payroll', 'support_history', 'bank_details'], direction: 'outbound', active: true, lastTransferOn: '2026-09-30' },
  { id: 'fl-10', systemId: 's-crm', vendorId: 'v-insightly', agreementId: 'ag-09', categories: ['usage_events'], direction: 'outbound', active: true, lastTransferOn: '2026-09-29' },
  { id: 'fl-11', systemId: 's-crm', vendorId: 'v-insightly', agreementId: 'ag-10', categories: ['contact'], direction: 'outbound', active: true, lastTransferOn: '2025-02-10' },
  { id: 'fl-12', systemId: 's-billing', vendorId: 'v-cloudstash', agreementId: null, categories: ['bank_details'], direction: 'outbound', active: true, lastTransferOn: '2026-09-25' },
  { id: 'fl-13', systemId: 's-warehouse', vendorId: 'v-insightly', agreementId: 'ag-09', categories: ['usage_events', 'contact'], direction: 'outbound', active: true, lastTransferOn: '2026-09-15' },
  { id: 'fl-14', systemId: 's-support', vendorId: 'v-mailwave', agreementId: 'ag-04', categories: ['contact'], direction: 'outbound', active: false, lastTransferOn: '2025-11-01' },
  { id: 'fl-15', systemId: 's-hris', vendorId: 'v-payco', agreementId: 'ag-11', categories: ['payroll'], direction: 'outbound', active: true, lastTransferOn: '2026-09-26' }, // pilot started before the draft was signed
];
process.stdout.write(JSON.stringify({ schemaVersion: 1, label: 'Synthetic data-sharing register — six vendors, twelve agreements', asOf: AS_OF, restrictedCategories: ['payroll', 'health', 'bank_details', 'identity_documents'], systems, vendors, owners, agreements, flows, history: [] }, null, 2) + '\n');
