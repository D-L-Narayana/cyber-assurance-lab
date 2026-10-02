// Deterministic synthetic retention fixture. node scripts/generate-fixture.mjs > src/fixtures/demo.json
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(31337);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const AS_OF = '2026-10-01';
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => iso(Date.parse(AS_OF) - n * 86400000);
const systems = [
  { id: 'hris', name: 'HR records (synthetic)', steward: 'people-ops@example.test' },
  { id: 'desk', name: 'Support desk', steward: 'support-lead@example.test' },
  { id: 'mkt', name: 'Marketing CRM', steward: 'growth@example.test' },
  { id: 'fin', name: 'Finance ledger', steward: 'controller@example.test' },
];
const schedules = [
  { id: 'sch-employee', name: 'Employee file', category: 'employee_file', trigger: 'terminated', retainDays: 2555, action: 'delete', basis: 'Synthetic policy text: keep seven years after termination for employment-claim defence, then delete.' },
  { id: 'sch-ticket', name: 'Support ticket', category: 'ticket', trigger: 'closed', retainDays: 730, action: 'anonymise', basis: 'Synthetic policy text: keep two years after closure for service quality analysis, then strip identifiers.' },
  { id: 'sch-lead', name: 'Marketing lead', category: 'lead', trigger: 'last_contact', retainDays: 548, action: 'delete', basis: 'Synthetic policy text: eighteen months after last contact without consent renewal, delete.' },
];
const records = [];
let n = 0;
const add = (systemId, category, subjectRef, triggerDate, status = 'active') => records.push({ id: `rec-${String(++n).padStart(4, '0')}`, systemId, category, subjectRef, triggerDate, status });
// employee files: spread from 1 to 9 years ago
for (let i = 0; i < 14; i++) add('hris', 'employee_file', `subj-${String(100 + i).padStart(4, '0')}`, daysAgo(int(300, 3300)));
// tickets: 0..4 years since closure
for (let i = 0; i < 26; i++) add('desk', 'ticket', `subj-${String(100 + int(0, 40)).padStart(4, '0')}`, daysAgo(int(5, 1500)));
// leads
for (let i = 0; i < 18; i++) add('mkt', 'lead', `subj-${String(200 + i).padStart(4, '0')}`, daysAgo(int(30, 1100)));
// finance invoices: no schedule yet -> unscheduled bucket
for (let i = 0; i < 6; i++) add('fin', 'invoice', `subj-${String(300 + i).padStart(4, '0')}`, daysAgo(int(100, 2000)));
// a few already disposed in a previous cycle
add('desk', 'ticket', 'subj-0105', daysAgo(1200), 'anonymised');
add('mkt', 'lead', 'subj-0250', daysAgo(900), 'deleted');
// exact-day due examples
add('desk', 'ticket', 'subj-0133', daysAgo(730));
add('mkt', 'lead', 'subj-0251', daysAgo(548));
const holds = [
  { id: 'hold-lit-0104', name: 'Litigation hold — subject 0104', authority: 'legal@example.test', placedOn: '2026-03-14', releasedOn: null, scope: { subjectRef: 'subj-0104' } },
  { id: 'hold-audit-hris', name: 'Regulator inquiry — all HR files', authority: 'compliance@example.test', placedOn: '2026-08-01', releasedOn: null, scope: { systemId: 'hris' } },
  { id: 'hold-mkt-2025', name: 'Released: 2025 campaign review', authority: 'legal@example.test', placedOn: '2025-02-01', releasedOn: '2025-11-30', scope: { category: 'lead' } },
  { id: 'hold-tickets-sample', name: 'QA sample of three tickets', authority: 'quality@example.test', placedOn: '2026-09-20', releasedOn: null, scope: { recordIds: ['rec-0015', 'rec-0016', 'rec-0017'] } },
];
process.stdout.write(JSON.stringify({ schemaVersion: 1, label: 'Synthetic retention ledger — four systems, three schedules', asOf: AS_OF, systems, schedules, records, holds }, null, 2) + '\n');
