// Deterministic synthetic access graph (~100 nodes). node scripts/generate-fixture.mjs > src/fixtures/demo.json
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(4242);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const first = ['Ada', 'Bhavna', 'Caius', 'Dalia', 'Emeka', 'Farah', 'Gus', 'Hana', 'Idris', 'Juno', 'Kofi', 'Lena', 'Mateo', 'Nadia', 'Oren', 'Priya', 'Quill', 'Rosa', 'Sven', 'Tala', 'Uma', 'Viggo', 'Wren', 'Ximena', 'Yusuf', 'Zara', 'Anil', 'Bea', 'Cato', 'Dev'];
const last = ['Example', 'Sample', 'Fixture', 'Placeholder', 'Demo'];
const depts = ['finance', 'engineering', 'people', 'sales', 'support'];
const locs = ['IN', 'US', 'DE'];
const nodes = []; const edges = []; let e = 0;
const N = (n) => nodes.push(n);
const E = (from, to, kind, extra = {}) => edges.push({ id: `e-${String(++e).padStart(3, '0')}`, from, to, kind, ...extra });
// groups
for (const d of depts) N({ id: `g-${d}`, kind: 'group', label: `${d[0].toUpperCase()}${d.slice(1)} team` });
N({ id: 'g-all', kind: 'group', label: 'All staff' });
N({ id: 'g-finance-leads', kind: 'group', label: 'Finance leads' });
N({ id: 'g-platform', kind: 'group', label: 'Platform engineers' });
N({ id: 'g-contractors', kind: 'group', label: 'Contractors' });
N({ id: 'g-legacy-admins', kind: 'group', label: 'Legacy admins (2019)' });
for (const d of depts) E(`g-${d}`, 'g-all', 'member_of');
E('g-finance-leads', 'g-finance', 'member_of');
E('g-platform', 'g-engineering', 'member_of');
E('g-legacy-admins', 'g-platform', 'member_of'); // stale nested group still carrying privilege
// roles
const roles = [['r-reader', 'Reader'], ['r-payroll-editor', 'Payroll editor'], ['r-payroll-approver', 'Payroll approver'], ['r-hr-editor', 'HR editor'], ['r-crm-user', 'CRM user'], ['r-crm-exporter', 'CRM exporter'], ['r-wh-analyst', 'Warehouse analyst'], ['r-wh-admin', 'Warehouse admin'], ['r-prod-operator', 'Production operator'], ['r-prod-admin', 'Production admin'], ['r-support-agent', 'Support agent'], ['r-vault-reader', 'Vault reader']];
for (const [id, label] of roles) N({ id, kind: 'role', label });
// permissions + assets
const assets = [['a-payroll', 'Payroll DB', 'high'], ['a-hris', 'HR records', 'high'], ['a-crm', 'Customer CRM', 'moderate'], ['a-wh', 'Analytics warehouse', 'high'], ['a-prod', 'Production account', 'high'], ['a-wiki', 'Wiki', 'low'], ['a-tickets', 'Support tickets', 'moderate'], ['a-vault', 'Secrets vault', 'high']];
for (const [id, label, s] of assets) N({ id, kind: 'asset', label, sensitivity: s });
const perms = [['p-wiki-read', 'wiki:read', 'read', 'a-wiki'], ['p-payroll-write', 'payroll:write', 'write', 'a-payroll'], ['p-payroll-admin', 'payroll:admin', 'admin', 'a-payroll'], ['p-hris-write', 'hris:write', 'write', 'a-hris'], ['p-hris-read', 'hris:read', 'read', 'a-hris'], ['p-crm-read', 'crm:read', 'read', 'a-crm'], ['p-crm-write', 'crm:write', 'write', 'a-crm'], ['p-wh-read', 'warehouse:read', 'read', 'a-wh'], ['p-wh-admin', 'warehouse:admin', 'admin', 'a-wh'], ['p-prod-write', 'prod:write', 'write', 'a-prod'], ['p-prod-admin', 'prod:admin', 'admin', 'a-prod'], ['p-tickets-write', 'tickets:write', 'write', 'a-tickets'], ['p-vault-read', 'vault:read', 'read', 'a-vault']];
for (const [id, label, action, asset] of perms) { N({ id, kind: 'permission', label, action }); E(id, asset, 'applies_to'); }
// grants
const grants = { 'r-reader': ['p-wiki-read'], 'r-payroll-editor': ['p-payroll-write', 'p-hris-read'], 'r-payroll-approver': ['p-payroll-admin'], 'r-hr-editor': ['p-hris-write', 'p-hris-read'], 'r-crm-user': ['p-crm-read', 'p-crm-write'], 'r-crm-exporter': ['p-crm-read', 'p-wh-read'], 'r-wh-analyst': ['p-wh-read'], 'r-wh-admin': ['p-wh-admin', 'p-wh-read'], 'r-prod-operator': ['p-prod-write'], 'r-prod-admin': ['p-prod-admin', 'p-prod-write', 'p-vault-read'], 'r-support-agent': ['p-tickets-write', 'p-crm-read'], 'r-vault-reader': ['p-vault-read'] };
for (const [r, ps] of Object.entries(grants)) for (const p of ps) E(r, p, 'grants');
// assignments (with ABAC)
E('g-all', 'r-reader', 'assigned');
E('g-finance', 'r-payroll-editor', 'assigned');
E('g-finance-leads', 'r-payroll-approver', 'assigned', { condition: { attr: 'mfa', op: 'eq', value: 'true' }, note: 'Approvers must have MFA' });
E('g-people', 'r-hr-editor', 'assigned', { condition: { attr: 'type', op: 'eq', value: 'user' } });
E('g-sales', 'r-crm-user', 'assigned');
E('g-sales', 'r-crm-exporter', 'assigned', { condition: { attr: 'location', op: 'neq', value: 'DE' }, note: 'Export restricted for DE-based staff in this synthetic policy' });
E('g-engineering', 'r-wh-analyst', 'assigned');
E('g-platform', 'r-wh-admin', 'assigned');
E('g-platform', 'r-prod-operator', 'assigned');
E('g-legacy-admins', 'r-prod-admin', 'assigned');
E('g-support', 'r-support-agent', 'assigned');
E('g-engineering', 'r-vault-reader', 'assigned', { condition: { attr: 'mfa', op: 'eq', value: 'true' } });
// denies
E('g-contractors', 'a-payroll', 'deny', { note: 'Contractors must never reach payroll' });
E('g-contractors', 'p-prod-admin', 'deny', { note: 'No production admin for contractors' });
E('g-support', 'a-wh', 'deny', { note: 'Support has no analytics access' });
// identities
let n = 0;
for (let i = 0; i < 48; i++) {
  const dept = depts[i % depts.length];
  const type = i % 16 === 15 ? 'service' : 'user';
  const id = type === 'service' ? `svc-${['etl', 'backup', 'ci'][Math.floor(i / 16)] ?? 'job'}` : `u-${String(++n).padStart(3, '0')}`;
  const contractor = i % 7 === 3;
  N({ id, kind: 'identity', label: type === 'service' ? id : `${first[i % first.length]} ${last[(i + Math.floor(i / first.length)) % last.length]}`, attrs: { department: dept, mfa: String(!(i % 5 === 4)), location: pick(locs), type } });
  E(id, `g-${dept}`, 'member_of');
  if (contractor) E(id, 'g-contractors', 'member_of');
  if (dept === 'finance' && i % 10 === 0) E(id, 'g-finance-leads', 'member_of');
  if (dept === 'engineering' && i % 6 === 1) E(id, 'g-platform', 'member_of');
}
// seeded findings
E('u-003', 'g-legacy-admins', 'member_of');        // one person still in the 2019 admin group -> prod admin + vault
E('u-011', 'g-finance-leads', 'member_of');       // finance lead with mfa false (i=10 -> mfa true? ensure below)
N({ id: 'u-999', kind: 'identity', label: 'Ximena Placeholder', attrs: { department: 'finance', mfa: 'false', location: 'IN', type: 'user' } });
E('u-999', 'g-finance', 'member_of'); E('u-999', 'g-finance-leads', 'member_of'); // approver path blocked by MFA condition
E('u-001', 'g-engineering', 'member_of');        // finance person also in engineering -> payroll write + warehouse read (toxic)
E('u-012', 'g-contractors', 'member_of');         // engineering contractor with platform -> prod admin denied
E('u-012', 'g-legacy-admins', 'member_of');
const toxicRules = [
  { id: 'tx-payroll-sod', name: 'Payroll write + payroll admin', a: { assetId: 'a-payroll', action: 'write' }, b: { assetId: 'a-payroll', action: 'admin' }, rationale: 'One identity can prepare and approve payroll.' },
  { id: 'tx-prod-vault', name: 'Production admin + vault read', a: { assetId: 'a-prod', action: 'admin' }, b: { assetId: 'a-vault', action: 'read' }, rationale: 'Full control of production plus its secrets.' },
  { id: 'tx-payroll-wh', name: 'Payroll write + warehouse read', a: { assetId: 'a-payroll', action: 'write' }, b: { assetId: 'a-wh', action: 'read' }, rationale: 'Can edit source data and read the analytics copy.' },
];
process.stdout.write(JSON.stringify({ schemaVersion: 1, label: 'Synthetic access graph — five teams, eight assets', nodes, edges, toxicRules }, null, 2) + '\n');
