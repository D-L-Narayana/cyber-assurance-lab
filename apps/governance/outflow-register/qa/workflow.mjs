import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:6144/';
const out = new URL('./screens/', import.meta.url).pathname; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = []; const notice = async () => (await page.locator('.mast .notice').first().innerText());
await page.goto(url, { waitUntil: 'networkidle' });
log.push('title=' + await page.title());
log.push('counts: ' + (await page.locator('.counts').innerText()).replace(/\n/g, ' '));
log.push('queue top: ' + (await page.locator('.queue li').first().innerText()).replace(/\n/g, ' | ').slice(0, 160));
await page.screenshot({ path: out + '01-initial.png', fullPage: true });
// vendor filter via map
await page.getByRole('button', { name: 'Filter by BenefitBridge Demo' }).click();
log.push('filtered agreements: ' + await page.locator('table.ag tbody tr').count());
await page.getByRole('button', { name: 'Clear filter' }).click();
// select ag-07 (expired backup) -> terminate without ack -> error; with ack -> ok
await page.locator('table.ag button.link', { hasText: 'Backup storage' }).first().click();
log.push('detail issues: ' + (await page.locator('.issues').innerText()).replace(/\n/g, ' || ').slice(0, 300));
await page.getByRole('button', { name: 'Terminate' }).click();
log.push('terminate no reason: ' + await notice());
await page.getByLabel(/Reason/).fill('Superseded by the 2026 renewal agreement');
await page.getByRole('button', { name: 'Terminate' }).click();
log.push('terminate no ack: ' + await notice());
await page.getByLabel(/I acknowledge/).check();
await page.getByRole('button', { name: 'Terminate' }).click();
log.push('terminate ok: ' + await notice());
await page.screenshot({ path: out + '02-terminated.png', fullPage: true });
// activate the draft renewal: ag-08 (has owner + categories)
await page.locator('table.ag button.link', { hasText: 'renewal 2026' }).click();
await page.getByLabel(/Reason/).fill('Signed by both parties');
await page.getByRole('button', { name: 'Activate' }).click();
log.push('activate draft: ' + await notice());
// try to activate ag-11 (no categories)
await page.locator('table.ag button.link', { hasText: 'Payslip e-delivery' }).click();
await page.getByLabel(/Reason/).fill('Trying');
await page.getByRole('button', { name: 'Activate' }).click();
log.push('activate without categories: ' + await notice());
// renew ag-09 (renewing) with bad then good date
await page.locator('table.ag button.link', { hasText: 'Product analytics' }).click();
await page.getByLabel(/Reason/).fill('Renewal signed');
await page.getByLabel(/New end date/).fill('2026-01-01');
await page.getByRole('button', { name: 'Activate' }).click();
log.push('renew bad date: ' + await notice());
await page.getByLabel(/New end date/).fill('2027-10-14');
await page.getByRole('button', { name: 'Activate' }).click();
log.push('renew ok: ' + await notice());
log.push('history: ' + (await page.locator('.hist').innerText()).replace(/\n/g, ' || '));
await page.screenshot({ path: out + '03-renewed.png', fullPage: true });
log.push('counts after: ' + (await page.locator('.counts').innerText()).replace(/\n/g, ' '));
// exports
const [dp] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Evidence packet Markdown' }).click()]);
await dp.saveAs(out + 'packet.md'); const md = await fs.readFile(out + 'packet.md', 'utf8'); log.push('packet md first line: ' + md.split('\n')[0] + ' | lines=' + md.split('\n').length);
const [dj] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export register JSON' }).click()]);
await dj.saveAs(out + 'register.json'); const j = JSON.parse(await fs.readFile(out + 'register.json', 'utf8')); log.push(`register json schema=${j.schema} issues=${j.issues.length} queue=${j.queue.length} history=${j.history.length}`);
const [dc] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Issues CSV' }).click()]);
await dc.saveAs(out + 'issues.csv'); log.push('issues csv lines=' + (await fs.readFile(out + 'issues.csv', 'utf8')).trim().split('\n').length);
// clock forward
await page.getByLabel('As-of date').fill('2027-03-01');
log.push('counts 2027: ' + (await page.locator('.counts').innerText()).replace(/\n/g, ' '));
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"label":"x","asOf":"2026-10-01","restrictedCategories":[],"systems":[],"vendors":[],"owners":[],"agreements":[null],"flows":[{"id":"f","vendorId":"ghost"}],"history":[]}') });
await page.waitForFunction(() => document.querySelector('.mast .notice')?.textContent?.includes('rejected'));
log.push('import error: ' + await notice());
for (const [name, w, h] of [['mobile', 375, 800], ['tablet', 768, 1024]]) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' }); const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); log.push(`${name} scrollWidth=${await p.evaluate(() => document.documentElement.scrollWidth)} viewport=${w}`); await p.screenshot({ path: out + `05-${name}.png`, fullPage: true }); await c.close(); }
log.push('pageErrors=' + JSON.stringify(errors));
await browser.close(); await fs.writeFile(out + 'workflow-log.txt', log.join('\n') + '\n'); console.log(log.join('\n'));
