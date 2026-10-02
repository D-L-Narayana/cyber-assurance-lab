// Deterministic synthetic fixture generator. Run: node scripts/generate-fixture.mjs > src/fixtures/demo.json
// All people, departments and domains are fictional. No real directory was consulted.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261001);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const AS_OF = '2026-10-01';
const daysAgo = (n) => new Date(Date.parse(AS_OF) - n * 86400000).toISOString().slice(0, 10);

const first = ['Ada', 'Bhavna', 'Caius', 'Dalia', 'Emeka', 'Farah', 'Gus', 'Hana', 'Idris', 'Juno', 'Kofi', 'Lena', 'Mateo', 'Nadia', 'Oren', 'Priya', 'Quill', 'Rosa', 'Sven', 'Tala', 'Uma', 'Viggo', 'Wren', 'Ximena', 'Yusuf', 'Zara'];
const last = ['Example', 'Sample', 'Fixture', 'Placeholder', 'Demo', 'Synthetic', 'Testcase', 'Mock'];
const departments = ['Finance', 'People Ops', 'Engineering', 'Sales', 'Support', 'Legal'];

const resources = [
  { id: 'res-payroll', name: 'Payroll (synthetic ERP)', owner: 'id-mgr-finance', sensitivity: 'high' },
  { id: 'res-ap', name: 'Accounts payable', owner: 'id-mgr-finance', sensitivity: 'high' },
  { id: 'res-hris', name: 'HR records', owner: 'id-mgr-people', sensitivity: 'high' },
  { id: 'res-crm', name: 'Customer CRM', owner: 'id-mgr-sales', sensitivity: 'moderate' },
  { id: 'res-tickets', name: 'Support ticketing', owner: 'id-mgr-support', sensitivity: 'moderate' },
  { id: 'res-repo', name: 'Source repositories', owner: 'id-mgr-eng', sensitivity: 'moderate' },
  { id: 'res-prod', name: 'Production cloud account', owner: 'id-mgr-eng', sensitivity: 'high' },
  { id: 'res-wiki', name: 'Internal wiki', owner: 'id-mgr-people', sensitivity: 'low' },
  { id: 'res-contracts', name: 'Contract vault', owner: 'id-mgr-legal', sensitivity: 'high' },
  { id: 'res-analytics', name: 'Analytics warehouse', owner: 'id-mgr-eng', sensitivity: 'moderate' },
  // Owner left the organisation and was never replaced: entitlements here cannot be routed automatically.
  { id: 'res-legacy', name: 'Legacy file share', owner: 'id-mgr-gone', sensitivity: 'moderate' },
];
const privileges = {
  'res-payroll': [['payroll.view', false], ['payroll.create', false], ['payroll.approve', true]],
  'res-ap': [['vendor.create', false], ['payment.release', true], ['invoice.enter', false]],
  'res-hris': [['hr.read', false], ['hr.edit', true]],
  'res-crm': [['crm.read', false], ['crm.export', true]],
  'res-tickets': [['tickets.agent', false], ['tickets.admin', true]],
  'res-repo': [['repo.read', false], ['repo.admin', true]],
  'res-prod': [['prod.readonly', false], ['prod.admin', true]],
  'res-wiki': [['wiki.read', false], ['wiki.admin', false]],
  'res-contracts': [['contracts.read', false], ['contracts.sign', true]],
  'res-analytics': [['analytics.query', false], ['analytics.admin', true]],
  'res-legacy': [['share.read', false], ['share.admin', true]],
};
const managers = [
  ['id-mgr-finance', 'Finance'], ['id-mgr-people', 'People Ops'], ['id-mgr-eng', 'Engineering'],
  ['id-mgr-sales', 'Sales'], ['id-mgr-support', 'Support'], ['id-mgr-legal', 'Legal'],
];
const identities = managers.map(([id, dept], i) => ({
  id, displayName: `${first[i]} ${last[i % last.length]}`, roleType: 'employee', department: dept, managerId: null, status: 'active', lastSignIn: daysAgo(1 + i),
}));
let n = 0;
for (let i = 0; i < 41; i++) {
  const dept = departments[i % departments.length];
  const mgr = managers.find((m) => m[1] === dept)[0];
  const roleType = i % 9 === 0 ? 'contractor' : 'employee';
  const status = i === 7 || i === 19 ? 'leaver' : i === 30 ? 'suspended' : 'active';
  identities.push({
    id: `id-${String(++n).padStart(3, '0')}`,
    displayName: `${first[(i * 7 + 3) % first.length]} ${last[(i * 5) % last.length]}`,
    roleType, department: dept, managerId: i === 33 ? 'id-mgr-gone' : mgr, status,
    lastSignIn: status === 'active' ? daysAgo(Math.floor(rnd() * 20)) : daysAgo(120 + Math.floor(rnd() * 100)),
  });
}
for (let i = 0; i < 3; i++) {
  identities.push({ id: `svc-${i + 1}`, displayName: `svc-${['billing', 'etl', 'backup'][i]}.example`, roleType: 'service', department: 'Engineering', managerId: i === 2 ? null : 'id-mgr-eng', status: 'active', lastSignIn: i === 1 ? null : daysAgo(2) });
}

const entitlements = [];
let e = 0;
const grant = (identityId, resourceId, priv, privileged, lastUsedDays) => entitlements.push({
  id: `ent-${String(++e).padStart(3, '0')}`, identityId, resourceId, privilege: priv, privileged,
  grantedOn: daysAgo(200 + Math.floor(rnd() * 500)), lastUsed: lastUsedDays === null ? null : daysAgo(lastUsedDays),
});
for (const ident of identities) {
  if (ident.roleType === 'service') {
    grant(ident.id, 'res-prod', 'prod.admin', true, ident.id === 'svc-2' ? null : 1);
    grant(ident.id, 'res-analytics', 'analytics.query', false, ident.id === 'svc-3' ? 400 : 3);
    continue;
  }
  grant(ident.id, 'res-wiki', 'wiki.read', false, Math.floor(rnd() * 30));
  const deptRes = { Finance: ['res-payroll', 'res-ap'], 'People Ops': ['res-hris'], Engineering: ['res-repo', 'res-prod'], Sales: ['res-crm'], Support: ['res-tickets'], Legal: ['res-contracts'] }[ident.department];
  for (const r of deptRes) {
    const [priv, privileged] = privileges[r][0];
    grant(ident.id, r, priv, privileged, ident.status === 'active' ? Math.floor(rnd() * 60) : 150 + Math.floor(rnd() * 100));
    if (rnd() < 0.3) {
      const [p2, pr2] = pick(privileges[r].slice(1));
      grant(ident.id, r, p2, pr2, rnd() < 0.25 ? 100 + Math.floor(rnd() * 300) : Math.floor(rnd() * 50));
    }
  }
}
// Seeded separation-of-duties conflicts and excessive access
grant('id-001', 'res-payroll', 'payroll.create', false, 4);
grant('id-001', 'res-payroll', 'payroll.approve', true, 10);
grant('id-013', 'res-ap', 'vendor.create', false, 2);
grant('id-013', 'res-ap', 'payment.release', true, 1);
grant('id-008', 'res-prod', 'prod.admin', true, 365); // leaver still holding prod admin
grant('id-020', 'res-hris', 'hr.edit', true, 200);  // leaver
grant('id-004', 'res-crm', 'crm.export', true, null); // never used privileged
grant('id-034', 'res-contracts', 'contracts.sign', true, 95); // manager missing -> routes to contract owner
grant('id-034', 'res-legacy', 'share.admin', true, 400); // manager missing AND owner missing -> unrouted
grant('svc-3', 'res-legacy', 'share.read', false, 30); // no manager, owner missing -> unrouted

const sodRules = [
  { id: 'sod-payroll', name: 'Create vs approve payroll', conflict: ['payroll.create', 'payroll.approve'], rationale: 'One person must not both prepare and approve a payroll run.' },
  { id: 'sod-ap', name: 'Vendor master vs payment release', conflict: ['vendor.create', 'payment.release'], rationale: 'Creating a vendor and releasing payments to it enables fictitious-vendor fraud.' },
  { id: 'sod-prod', name: 'Repository admin vs production admin', conflict: ['repo.admin', 'prod.admin'], rationale: 'Separates change authorship from production deployment authority.' },
];

const fixture = { schemaVersion: 1, label: 'Synthetic demo campaign (Q4 2026 quarterly review)', asOf: AS_OF, identities, resources, entitlements, sodRules };
process.stdout.write(JSON.stringify(fixture, null, 2) + '\n');
