// Internal QA workflow for Attestline (not shipped). Run with NODE_PATH pointing at a playwright install.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:6140/';
const out = new URL('./screens/', import.meta.url).pathname;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = [];
await page.goto(url, { waitUntil: 'networkidle' });
log.push('title=' + await page.title());
await page.screenshot({ path: out + '01-initial.png', fullPage: true });
// 1. Focus first row, try approving a flagged item without a reason -> error
const firstRow = page.locator('table.review tbody tr').first();
await firstRow.click();
const identity = await firstRow.locator('td').nth(1).innerText();
log.push('focused=' + identity.replace(/\n/g, ' | '));
await page.getByRole('button', { name: 'Approve', exact: true }).click();
const err1 = await page.locator('.notice.error').first().innerText();
log.push('expected error: ' + err1);
// 2. Give a reason and revoke
await page.getByLabel(/Reason/).fill('Quarterly review: access no longer required');
await page.getByRole('button', { name: 'Revoke', exact: true }).click();
log.push('after revoke: ' + await page.locator('.notice.ok').first().innerText());
await page.screenshot({ path: out + '02-after-revoke.png', fullPage: true });
// 3. SoD override path: find an item with SoD hint, approve first side, then second side without override -> error, then with override
await page.getByLabel('Acting as reviewer').selectOption('id-mgr-finance');
await page.getByRole('button', { name: /Flagged/ }).click();
const sodRows = page.locator('table.review tbody tr', { has: page.locator('.hint.sod_conflict') });
const sodCount = await sodRows.count();
log.push('sod rows visible for this reviewer=' + sodCount);
if (sodCount >= 2) {
  await sodRows.nth(0).click();
  const sodIdentity = (await sodRows.nth(0).locator('td').nth(1).locator('span').first().innerText()).trim();
  await page.getByLabel(/^Reason/).fill('Needed for payroll preparation');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  log.push('sod first side: ' + await page.locator('.notice').first().innerText());
  // counterpart row
  const pendingSod = page.locator('table.review tbody tr', { has: page.locator('.hint.sod_conflict') }).filter({ has: page.locator('.stamp.pending') }).filter({ hasText: sodIdentity });
  log.push('counterpart rows for ' + sodIdentity + '=' + await pendingSod.count());
  await pendingSod.first().click();
  await page.getByLabel(/^Reason/).fill('Also needed');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  log.push('sod second side without override: ' + await page.locator('.notice').first().innerText());
  await page.getByLabel(/SoD override rationale/).fill('Compensating control: CFO reviews every approved payroll run before release');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  log.push('sod second side with override: ' + await page.locator('.notice').first().innerText());
  await page.screenshot({ path: out + '03-sod-override.png', fullPage: true });
}
// 4. Keyboard navigation: focus row, ArrowDown, Space select two rows, bulk revoke
await page.getByLabel('Acting as reviewer').selectOption('id-mgr-eng');
await page.getByRole('button', { name: /Pending/ }).click();
const row0 = page.locator('table.review tbody tr').first();
await row0.focus();
await page.keyboard.press(' ');
await page.keyboard.press('ArrowDown');
await page.keyboard.press(' ');
log.push('selected count text: ' + await page.locator('.bulk strong').innerText());
await page.getByLabel(/^Reason/).fill('Bulk: access reviewed, not needed for current role');
await page.getByRole('button', { name: 'Revoke selected' }).click();
log.push('bulk: ' + await page.locator('.notice').first().innerText());
// 4b. Self-review guard: delegating to the identity under review must be refused
await page.getByRole('button', { name: /Pending/ }).click();
const r0 = page.locator('table.review tbody tr').first(); await r0.click();
const reviewedId = (await r0.locator('td').nth(1).locator('.sub').innerText()).split(' · ')[0].trim();
const delegateOptions = await page.locator('.decide select option').allTextContents();
log.push('delegate dropdown offers reviewed identity ' + reviewedId + '? ' + delegateOptions.some((o) => o.includes(reviewedId)));
// 5. Unrouted routing control present?
const routeSummary = page.locator('summary', { hasText: 'Route unrouted' });
log.push('unrouted control visible=' + (await routeSummary.count()));
if (await routeSummary.count()) {
  await routeSummary.click();
  await page.locator('details.import select').last().selectOption({ index: 1 });
  await page.getByPlaceholder('Why this reviewer').fill('IT manager owns service accounts');
  await page.getByRole('button', { name: 'Route', exact: true }).first().click();
  log.push('route: ' + await page.locator('.notice').first().innerText());
}
// 6. Export CSV download
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
const csvPath = out + 'export.csv'; await dl.saveAs(csvPath);
const csv = await fs.readFile(csvPath, 'utf8');
log.push('csv lines=' + csv.trim().split('\n').length + ' header=' + csv.split('\r\n')[0]);
const [dlj] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
await dlj.saveAs(out + 'export.json');
const json = JSON.parse(await fs.readFile(out + 'export.json', 'utf8'));
log.push('json schema=' + json.schema + ' decisions=' + json.decisions.length + ' decided=' + json.summary.decided);
// 7. Invalid import
await page.locator('summary', { hasText: 'Load a different fixture' }).click();
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"identities":[null]}') });
log.push('import error: ' + await page.locator('.import-body .notice.error').innerText());
await page.screenshot({ path: out + '04-import-error.png', fullPage: true });
// 8. Empty state: pick a reviewer and switch to 'all' etc. Mobile/tablet screenshots
for (const [name, w, h] of [['mobile', 375, 800], ['tablet', 768, 1024]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  log.push(`${name} scrollWidth=${sw} viewport=${w}`);
  await p.screenshot({ path: out + `05-${name}.png`, fullPage: true });
  await c.close();
}
log.push('pageErrors=' + JSON.stringify(errors));
await browser.close();
await fs.writeFile(out + 'workflow-log.txt', log.join('\n') + '\n');
console.log(log.join('\n'));
