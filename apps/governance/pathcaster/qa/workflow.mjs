import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:6143/';
const out = new URL('./screens/', import.meta.url).pathname; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = [];
await page.goto(url, { waitUntil: 'networkidle' });
log.push('title=' + await page.title());
log.push('summary: ' + await page.locator('.summary').innerText());
await page.screenshot({ path: out + '01-initial.png', fullPage: true });
// select action admin, then select the denied contractor
await page.getByLabel('Action').selectOption('admin');
log.push('admin summary: ' + await page.locator('.summary').innerText());
await page.locator('table.ids tr', { hasText: 'deny' }).first().locator('button').click();
log.push('denied identity why: ' + (await page.locator('.explain').innerText()).replace(/\n/g, ' || ').slice(0, 400));
await page.screenshot({ path: out + '02-deny-override.png', fullPage: true });
// keyboard: tab to an identity node in svg and press Enter
await page.locator('table.ids tr', { hasText: 'allow' }).first().locator('button').click();
log.push('allowed identity why: ' + (await page.locator('.explain').innerText()).replace(/\n/g, ' || ').slice(0, 300));
// payroll admin: MFA-blocked identity
await page.getByLabel('Asset').selectOption({ label: 'Payroll DB · high' });
await page.getByLabel('Action').selectOption('admin');
const blockedRow = page.locator('table.ids tr', { hasText: 'blocked' }).first();
await blockedRow.locator('button').click();
log.push('condition-blocked why: ' + (await page.locator('.explain').innerText()).replace(/\n/g, ' || ').slice(0, 300));
await page.screenshot({ path: out + '03-condition-blocked.png', fullPage: true });
// toxic
log.push('toxic: ' + (await page.locator('.toxic').innerText()).replace(/\n/g, ' || ').slice(0, 300));
log.push('hotspot #1: ' + (await page.locator('.rank li').first().innerText()).replace(/\n/g, ' '));
// what-if on prod admin: remove legacy admins assignment
await page.getByLabel('Asset').selectOption({ label: 'Production account · high' });
const options = await page.locator('.whatif select option').allTextContents();
const legacy = options.find((o) => /Legacy admins.*assigned/.test(o));
log.push('whatif option found=' + !!legacy);
await page.locator('.whatif select').selectOption({ label: legacy });
log.push('whatif: ' + await page.locator('.whatif .delta').innerText());
await page.getByRole('button', { name: 'Apply removal to session graph' }).click();
log.push('after apply: ' + await page.locator('.summary').innerText());
log.push('toxic after: ' + (await page.locator('.toxic').innerText()).replace(/\n/g, ' || ').slice(0, 200));
// exports
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export review JSON' }).click()]);
await dl.saveAs(out + 'export.json'); const j = JSON.parse(await fs.readFile(out + 'export.json', 'utf8'));
log.push(`json schema=${j.schema} identities=${j.identities.length} hotspots=${j.hotspots.length} summary=${j.summary}`);
const [dc] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
await dc.saveAs(out + 'export.csv'); log.push('csv lines=' + (await fs.readFile(out + 'export.csv', 'utf8')).trim().split('\n').length);
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"label":"x","nodes":[{"id":"a","kind":"group","label":"A"}],"edges":[{"id":"e","from":"a","to":"a","kind":"member_of"}],"toxicRules":[]}') });
await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('rejected'));
log.push('import error: ' + await page.locator('.notice').innerText());
for (const [name, w, h] of [['mobile', 375, 800], ['tablet', 768, 1024]]) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' }); const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); log.push(`${name} scrollWidth=${await p.evaluate(() => document.documentElement.scrollWidth)} viewport=${w}`); await p.screenshot({ path: out + `05-${name}.png`, fullPage: true }); await c.close(); }
log.push('pageErrors=' + JSON.stringify(errors));
await browser.close(); await fs.writeFile(out + 'workflow-log.txt', log.join('\n') + '\n'); console.log(log.join('\n'));
