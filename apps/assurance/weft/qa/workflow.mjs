// Browser workflow QA for Weft. NODE_PATH=<tools>/node_modules node qa/workflow.mjs http://127.0.0.1:6123/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6123/';
const out = path.resolve('qa/screens');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const log = [];
const check = (name, cond) => { log.push({ name, pass: !!cond }); if (!cond) console.error('FAIL', name); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, '01-desktop-initial.png'), fullPage: true });

  // AS-02 pre-selected with stale sign-off
  check('AS-02 selected', (await page.locator('.panel h2').textContent()) === 'AS-02');
  check('stale sign-off shown invalid', /INVALID/.test((await page.locator('.kv').textContent()) ?? ''));
  const ledger = (await page.locator('.ledger').textContent()) ?? '';
  for (const k of ['hash-mismatch', 'duplicate-content', 'orphan-artifact', 'broken-link', 'out-of-period', 'invalid-signoff', 'unsupported-assertion', 'weak-assertion']) check(`ledger lists ${k}`, ledger.includes(k));

  // Clear stale sign-off, unlink the out-of-period Q2 artifact, then sign
  await page.getByRole('button', { name: 'Clear stale sign-off' }).click();
  await page.getByRole('button', { name: /Unlink AR-04 from AS-02/ }).click();
  check('AS-02 now supported', /supported/.test((await page.locator('.panel .st').textContent()) ?? ''));
  await page.getByLabel('Reviewer').fill('qa.reviewer');
  await page.getByRole('button', { name: 'Sign off' }).click();
  check('sign-off valid', /Valid — qa.reviewer/.test((await page.locator('.kv').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '02-signed.png'), fullPage: false });

  // Tamper with AR-03 content → sign-off invalid again
  await page.getByRole('button', { name: /^AR-03 / }).click();
  const hashBefore = (await page.locator('.kv .hash').first().textContent()) ?? '';
  await page.getByLabel(/Content \(editing/).fill('account,role,decision\nadm.r.kaur,dispatch-admin,keep');
  const hashAfter = (await page.locator('.kv .hash').first().textContent()) ?? '';
  check('hash changes on edit', hashBefore !== hashAfter && /^[0-9a-f]{64}$/.test(hashAfter));
  check('declared mismatch shown', /mismatch/.test((await page.locator('.kv').textContent()) ?? ''));
  await page.getByRole('button', { name: /^AS-02:/ }).click();
  check('sign-off invalidated by tamper', /INVALID/.test((await page.locator('.kv').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '03-tampered.png'), fullPage: false });

  // Refuse signing a weak assertion (AS-06 only out-of-period evidence)
  await page.getByRole('button', { name: /^AS-06:/ }).click();
  await page.getByLabel('Reviewer').fill('qa.reviewer');
  await page.getByRole('button', { name: 'Sign off' }).click();
  check('weak sign-off refused', /Sign-off refused/.test((await page.locator('.notice--error').textContent()) ?? ''));

  // Manifest: generate, then verify unchanged → intact; then edit and verify → drift
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Generate manifest' }).click()]);
  const manifestText = await fs.readFile(await dl.path(), 'utf8');
  const manifest = JSON.parse(manifestText);
  check('manifest has root + 10 entries', /^[0-9a-f]{64}$/.test(manifest.root) && manifest.entries.length === 10);
  check('manifest v2 binds sign-offs', manifest.schema === 'weft.manifest/2' && Array.isArray(manifest.signoffs) && manifest.signoffs.length >= 1);
  await fs.writeFile(path.join(out, 'export-manifest-sample.json'), manifestText);
  const manifestInput = page.locator('input[type=file]').nth(1);
  await manifestInput.setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(manifestText) });
  await page.waitForSelector('.tool');
  check('verify intact', /Intact/.test((await page.locator('.tool').first().textContent()) ?? ''));
  await page.getByRole('button', { name: /^AR-01 / }).click();
  await page.getByLabel(/Content \(editing/).fill('changed');
  await manifestInput.setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(manifestText) });
  await page.waitForSelector('.notice--error');
  check('verify detects modified AR-01', /modified: AR-01/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '04-verify-drift.png'), fullPage: false });
  // Append an assertion and verify again → unbound assertion reported
  await page.getByLabel('Statement', { exact: true }).fill('Appended after the manifest was generated.');
  await page.getByRole('button', { name: 'Add assertion' }).click();
  await manifestInput.setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(manifestText) });
  await page.waitForSelector('.notice--error');
  check('verify detects appended assertion', /assertion added \(unbound\): AS-07/.test((await page.locator('.notice--error').textContent()) ?? ''));
  // Remove a sign-off that the manifest bound → reported (external repro A)
  await page.getByRole('button', { name: /^AS-02:/ }).click();
  await page.getByRole('button', { name: 'Clear stale sign-off' }).click();
  await manifestInput.setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(manifestText) });
  await page.waitForSelector('.notice--error');
  check('verify detects removed sign-off', /sign-off changed .*: AS-02/.test((await page.locator('.notice--error').textContent()) ?? ''));

  // Diff with the original demo bundle
  const demo = await fs.readFile(path.resolve('src/fixtures/harbourline-bundle.json'), 'utf8');
  await page.locator('input[type=file]').nth(2).setInputFiles({ name: 'orig.json', mimeType: 'application/json', buffer: Buffer.from(demo) });
  await page.waitForSelector('#diff-h');
  check('diff shows changed artifacts', /changedArtifacts: AR-01, AR-03/.test((await page.locator('.tool').last().textContent()) ?? ''));

  // Toggle a link via knot (keyboard)
  await page.getByRole('button', { name: 'Link AR-09 to AS-04' }).focus();
  await page.keyboard.press('Enter');
  check('orphan resolved by linking', !((await page.locator('.ledger').textContent()) ?? '').includes('AR-09 is not linked'));

  // Import rejection
  await page.locator('input[type=file]').first().setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"weft.bundle/1","name":"x","asOf":"2026-10-01","assertions":[{"id":"S","controlRef":"c","statement":"s","periodStart":"2026-09-30","periodEnd":"2026-07-01"}],"artifacts":[{"id":"A","name":"n","kind":"pdf","capturedOn":"2026-02-30","content":"x","declaredSha256":"zz"}]}') });
  await page.waitForSelector('.notice--error');
  check('import rejected with paths', (await page.locator('.notice--error li').count()) >= 4);
  await page.screenshot({ path: path.join(out, '05-import-rejected.png'), fullPage: false });

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(url + '#/artifact/AR-05', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '06-mobile.png'), fullPage: true });
  check('mobile no horizontal overflow', (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await m.close();
} finally {
  await browser.close();
}
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
process.exit(log.every((l) => l.pass) ? 0 : 1);
