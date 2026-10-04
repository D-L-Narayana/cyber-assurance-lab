// Deterministic synthetic catalog generator for Labelsmith.
//   node scripts/generate-fixture.mjs --out src/fixtures/demo.json      (or omit --out to print to stdout)
// Every sample value is generated here; nothing is copied from a real dataset. Card/IBAN values are made Luhn/mod-97 valid synthetically.
import fs from 'node:fs';
import path from 'node:path';
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(777);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const digits = (n) => Array.from({ length: n }, () => String(int(0, 9))).join('');
function luhnComplete(prefix15) { let sum = 0, alt = true; for (let i = prefix15.length - 1; i >= 0; i--) { let n = +prefix15[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return prefix15 + String((10 - (sum % 10)) % 10); }
function ibanGB() { const bban = 'WEST' + digits(14); const r = bban + 'GB00'; let rem = 0; for (const ch of r) { const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rem = (rem * 10 + +d) % 97; } const check = String(98 - rem).padStart(2, '0'); return `GB${check} ${bban.slice(0, 4)} ${bban.slice(4, 8)} ${bban.slice(8, 12)} ${bban.slice(12, 16)} ${bban.slice(16)}`; }
const names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Ivy', 'Jo', 'Kit'];
const surn = ['Example', 'Sample', 'Fixture', 'Demo', 'Placeholder'];
const many = (n, fn) => Array.from({ length: n }, fn);
const date = (y1, y2) => `${int(y1, y2)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;

const fields = [];
let n = 0;
const add = (system, table, name, type, samples, extra = {}) => fields.push({ id: `fld-${String(++n).padStart(3, '0')}`, system, table, name, type, samples, ...extra });

// crm.example — contacts & accounts
add('crm.example', 'contacts', 'first_name', 'string', many(6, () => pick(names)), { declaredClass: 'restricted-pii' });
add('crm.example', 'contacts', 'last_name', 'string', many(6, () => pick(surn)), { declaredClass: 'restricted-pii' });
add('crm.example', 'contacts', 'email', 'string', many(6, () => `${pick(names).toLowerCase()}.${pick(surn).toLowerCase()}@example.test`), { declaredClass: 'internal', description: 'Declared too low on purpose: engine should flag the mismatch.' });
add('crm.example', 'contacts', 'phone', 'string', many(6, () => `+1 555 ${digits(3)} ${digits(4)}`));
add('crm.example', 'contacts', 'preferred_locale', 'string', ['en-GB', 'en-IN', 'de-DE', 'fr-FR'], { description: 'No rule covers locale: lands in the unknown bucket.' });
add('crm.example', 'contacts', 'created_at', 'date', many(5, () => date(2022, 2026)), { declaredClass: 'internal' });
add('crm.example', 'accounts', 'account_name', 'string', ['Northwind Example Ltd', 'Contoso Fixture GmbH', 'Fabrikam Sample SA'], { declaredClass: 'confidential', description: 'Declared stricter than computed; kept pending review.' });
add('crm.example', 'accounts', 'annual_revenue', 'number', many(5, () => String(int(100000, 90000000))));
add('crm.example', 'accounts', 'client_ip_last_login', 'string', many(6, () => `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`));
add('crm.example', 'accounts', 'geo_hq', 'string', many(5, () => `${(rnd() * 180 - 90).toFixed(5)}, ${(rnd() * 360 - 180).toFixed(5)}`));
// payments.example
add('payments.example', 'cards', 'card_number', 'string', many(6, () => luhnComplete('4539' + digits(11))), { declaredClass: 'restricted-financial' });
add('payments.example', 'cards', 'cvv', 'string', many(6, () => digits(3)));
add('payments.example', 'cards', 'expiry', 'string', many(6, () => `${String(int(1, 12)).padStart(2, '0')}/${int(27, 31)}`));
add('payments.example', 'cards', 'cardholder_reference', 'string', many(6, () => digits(16)), { description: 'Sixteen digits but random: most fail Luhn, so the card rule must not fire on value alone.' });
add('payments.example', 'bank_accounts', 'iban', 'string', many(5, () => ibanGB()));
add('payments.example', 'bank_accounts', 'account_holder', 'string', many(5, () => `${pick(names)} ${pick(surn)}`));
add('payments.example', 'ledger', 'invoice_total', 'number', many(6, () => `${int(10, 99999)}.${digits(2)}`));
add('payments.example', 'ledger', 'status', 'string', ['open', 'paid', 'void'], { declaredClass: 'confidential', description: 'Declared stricter than the computed Internal: the declared class is kept as effective pending review.' });
// hris.example
add('hris.example', 'employees', 'employee_id', 'string', many(6, () => `E${digits(5)}`));
add('hris.example', 'employees', 'national_id', 'string', many(6, () => `${digits(3)}-${digits(2)}-${digits(4)}`));
add('hris.example', 'employees', 'date_of_birth', 'date', many(6, () => date(1960, 2004)));
add('hris.example', 'employees', 'salary', 'number', many(6, () => String(int(30000, 180000))));
add('hris.example', 'employees', 'home_address', 'string', many(5, () => `${int(1, 200)} Fixture Street, Exampleton`));
add('hris.example', 'employees', 'emergency_contact_phone', 'string', many(5, () => `+44 7700 900${digits(3)}`));
add('hris.example', 'benefits', 'diagnosis_code', 'string', ['E11.9', 'J45.40', 'M54.5', 'I10', 'K21.9'], { description: 'Synthetic ICD-10-like codes for an occupational-health extract.' });
add('hris.example', 'benefits', 'allergy_notes', 'string', ['none recorded', 'penicillin', 'latex']);
add('hris.example', 'benefits', 'plan_tier', 'string', ['bronze', 'silver', 'gold'], { description: 'Unknown bucket candidate.' });
// platform.example
add('platform.example', 'users', 'password_hash', 'string', many(4, () => `$2b$12$${Array.from({ length: 53 }, () => pick('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./'.split(''))).join('')}`));
add('platform.example', 'users', 'session_token', 'string', many(4, () => `eyJhbGciOiJIUzI1NiJ9.${digits(20)}abc.${digits(12)}sig`));
add('platform.example', 'integrations', 'vendor_api_key', 'string', many(4, () => `DEMO_ONLY_NOT_A_SECRET_${digits(10)}EXAMPLEKEY${digits(6)}`), { declaredClass: 'confidential', description: 'Secret stored in a plain table and under-declared.' });
add('platform.example', 'integrations', 'webhook_url', 'string', ['https://hooks.example.test/a', 'https://hooks.example.test/b']);
add('platform.example', 'audit_log', 'remote_addr', 'string', many(6, () => `192.168.${int(0, 255)}.${int(1, 254)}`));
add('platform.example', 'audit_log', 'updated_at', 'date', many(5, () => date(2025, 2026)));
add('platform.example', 'audit_log', 'notes', 'string', ['rotated key', 'reset password', 'login']);
// catalog.example — public product data
add('catalog.example', 'products', 'product_name', 'string', ['Example Kettle', 'Sample Lamp', 'Fixture Chair'], { declaredClass: 'public' });
add('catalog.example', 'products', 'sku', 'string', many(5, () => `SKU-${digits(6)}`), { declaredClass: 'public' });
add('catalog.example', 'products', 'public_description', 'string', ['A kettle.', 'A lamp.', 'A chair.']);
add('catalog.example', 'products', 'margin_pct', 'number', many(5, () => `${int(5, 60)}.${digits(1)}`));
add('catalog.example', 'reviews', 'reviewer_email', 'string', many(5, () => `${pick(names).toLowerCase()}@example.test`));
add('catalog.example', 'reviews', 'is_verified', 'boolean', ['true', 'false']);
// October 2026 — false-positive regression fields for token-boundary matching. Appended last so every earlier id and
// random draw is unchanged (the first 40 fields are byte-identical to the previous fixture).
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 15)]).join('');
add('platform.example', 'ml_models', 'tokenizer_version', 'string', ['v2', 'v3', 'v3.1'], { description: 'FP regression: “tokenizer” is not the token “token”; a version is operational metadata.' });
add('platform.example', 'services', 'healthcheck_status', 'string', ['ok', 'degraded', 'ok', 'ok'], { description: 'FP regression: a service health check is not health data.' });
add('payments.example', 'cards', 'expiry_warning_days', 'number', ['30', '14', '7'], { description: 'FP regression: a notification setting about expiry, not a card expiry.' });
add('platform.example', 'telemetry', 'velocity', 'number', many(5, () => `${int(0, 120)}.${digits(1)}`), { description: 'FP regression: “velocity” must not match the token “city”.' });
add('platform.example', 'artifacts', 'content_md5', 'string', many(4, () => hex(32)), { description: 'FP regression: a content digest is Confidential via val-hex-digest (review), not a credential.' });
add('platform.example', 'deployments', 'commit_sha', 'string', many(4, () => hex(40)), { description: 'FP regression: git commit ids are hex digests, not secrets.' });

const exceptions = [
  { id: 'exc-001', fieldId: 'fld-011', fromClass: 'restricted-financial', toClass: 'confidential', justification: 'Column holds provider tokens in production; samples here are synthetic PAN-shaped values for the demo. Tokenisation evidence: PAY-2026-014.', approvedBy: 'dpo@example.test', grantedOn: '2026-07-01', expiresOn: '2027-03-31' },
  { id: 'exc-002', fieldId: 'fld-020', fromClass: 'restricted-pii', toClass: 'confidential', justification: 'Legacy exception from the HR migration; should have been renewed and was not.', approvedBy: 'hr-lead@example.test', grantedOn: '2025-06-01', expiresOn: '2026-05-31' },
];
const output = JSON.stringify({ schemaVersion: 1, label: 'Synthetic catalog — five example systems', asOf: '2026-10-01', fields, exceptions }, null, 2) + '\n';
const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && process.argv[outFlag + 1]) fs.writeFileSync(path.resolve(process.argv[outFlag + 1]), output);
else process.stdout.write(output);
