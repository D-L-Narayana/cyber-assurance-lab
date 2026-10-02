import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:6141/';
const out = new URL('./screens/', import.meta.url).pathname; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = [];
await page.goto(url, { waitUntil: 'networkidle' });
log.push('title=' + await page.title());
log.push('initial label=' + await page.locator('.label-tag .name').innerText() + ' | ' + (await page.locator('.ladder-legend').innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: out + '01-initial.png', fullPage: true });
// select card_number -> active exception
await page.getByRole('button', { name: /^card_number/ }).click();
log.push('card_number: ' + await page.locator('.label-tag .name').innerText() + ' / ' + (await page.locator('.label-tag .effective').innerText()).slice(0, 90));
// declared stricter than computed -> effective keeps declared
await page.getByRole('button', { name: /^status/ }).click();
log.push('ledger.status (declared confidential, computed internal): ' + await page.locator('.label-tag .name').innerText() + ' / ' + (await page.locator('.label-tag .effective').innerText()).slice(0, 110) + ' / policy: ' + await page.locator('.policy h2').innerText());
// select cardholder_reference -> luhn fails
await page.getByRole('button', { name: /cardholder_reference/ }).click();
log.push('cardholder_reference: ' + await page.locator('.label-tag .name').innerText());
const luhnRow = page.locator('.waterfall li', { hasText: 'Card number passes Luhn' });
log.push('luhn trace: ' + (await luhnRow.innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: out + '02-luhn-trace.png', fullPage: true });
// live edit: rename to zz and see unknown; then type an email sample
await page.getByRole('button', { name: /preferred_locale/ }).click();
log.push('preferred_locale: ' + await page.locator('.label-tag .name').innerText());
await page.getByLabel('Field name').fill('contact_email');
log.push('after rename live: ' + await page.locator('.label-tag .name').innerText() + ' ' + await page.locator('.label-tag .mono').first().innerText());
await page.getByLabel(/Synthetic sample values/).fill('a@example.test\nb@example.test\nc@example.test');
log.push('after samples live: ' + await page.locator('.label-tag .name').innerText() + ' ' + await page.locator('.label-tag .mono').first().innerText());
await page.getByRole('button', { name: 'Save to catalog' }).click();
log.push('saved: ' + await page.locator('.notice').first().innerText());
// exception: invalid then valid
await page.getByRole('button', { name: /^email/ }).click();
await page.locator('summary', { hasText: 'Record a downgrade exception' }).click();
await page.getByRole('button', { name: 'Record exception' }).click();
log.push('exception invalid: ' + await page.locator('.notice.error').first().innerText());
await page.getByLabel('Approved by').fill('dpo@example.test');
await page.getByLabel(/Expires on/).fill('2027-03-01');
await page.getByLabel(/Justification/).fill('Pseudonymised before landing in the warehouse; raw emails stay in the CRM only.');
await page.getByLabel('Downgrade to').selectOption('confidential');
await page.getByRole('button', { name: 'Record exception' }).click();
log.push('exception ok: ' + await page.locator('.notice').first().innerText());
log.push('email effective: ' + (await page.locator('.label-tag .effective').innerText()).slice(0, 120));
await page.screenshot({ path: out + '03-exception.png', fullPage: true });
// keyword rule with regex chars -> error; then valid
await page.locator('summary', { hasText: 'Add a keyword rule' }).click();
await page.getByLabel('Rule id').fill('kw-codename');
await page.getByLabel(/Keywords, comma separated/).fill('(a+)+');
await page.getByRole('button', { name: 'Add rule' }).click();
log.push('rule regex rejected: ' + await page.locator('.notice.error').first().innerText());
await page.getByLabel(/Keywords, comma separated/).fill('codename, plan_tier');
await page.getByRole('button', { name: 'Add rule' }).click();
log.push('rule added: ' + await page.locator('.notice').first().innerText());
await page.getByRole('button', { name: /plan_tier/ }).click();
log.push('plan_tier after rule: ' + await page.locator('.label-tag .name').innerText());
// exports
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
await dl.saveAs(out + 'export.csv'); const csv = await fs.readFile(out + 'export.csv', 'utf8');
log.push('csv lines=' + csv.trim().split('\n').length + ' header=' + csv.split('\r\n')[0]);
const [dlj] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export catalog JSON' }).click()]);
await dlj.saveAs(out + 'export.json'); const j = JSON.parse(await fs.readFile(out + 'export.json', 'utf8'));
log.push('json schema=' + j.schema + ' fields=' + j.fields.length + ' rules=' + j.ruleSet.length + ' needsReview=' + j.summary.needsReview);
// invalid import
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"label":"x","asOf":"2026-02-30","fields":[null]}') });
log.push('import error: ' + await page.locator('.notice.error').first().innerText());
for (const [name, w, h] of [['mobile', 375, 800], ['tablet', 768, 1024]]) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' }); const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); log.push(`${name} scrollWidth=${await p.evaluate(() => document.documentElement.scrollWidth)} viewport=${w}`); await p.screenshot({ path: out + `05-${name}.png`, fullPage: true }); await c.close(); }
log.push('pageErrors=' + JSON.stringify(errors));
await browser.close(); await fs.writeFile(out + 'workflow-log.txt', log.join('\n') + '\n'); console.log(log.join('\n'));
