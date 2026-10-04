import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:6142/';
const out = new URL('./screens/', import.meta.url).pathname; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const log = []; const status = async () => (await page.locator('.mast .verdict').first().innerText());
await page.goto(url, { waitUntil: 'networkidle' });
log.push('title=' + await page.title());
log.push('states: ' + (await page.locator('.states').innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: out + '01-initial.png', fullPage: true });
await page.getByRole('button', { name: /Generate plan/ }).click();
log.push('plan1: ' + await status());
const planId1 = (await page.locator('.plan-id').innerText()).replace('plan ', '');
await page.getByRole('button', { name: /Generate plan/ }).click();
log.push('plan1 again: ' + await status() + ' sameId=' + ((await page.locator('.plan-id').innerText()).replace('plan ', '') === planId1));
await page.getByRole('button', { name: 'Execute plan (simulated)' }).click();
log.push('execute: ' + await status());
await page.screenshot({ path: out + '02-executed.png', fullPage: true });
await page.getByRole('button', { name: /Generate plan/ }).click();
await page.getByRole('button', { name: 'Execute plan (simulated)' }).click().catch(() => {});
log.push('after re-plan: ' + await status());
// stale plan: generate, then release a hold through the guarded form before executing -> engine must reject.
// The form refuses a short reason first (nothing changes), then accepts a proper actor + reason.
await page.getByRole('button', { name: /Generate plan/ }).click();
await page.getByRole('button', { name: 'Release hold-audit-hris' }).click();
await page.getByLabel('Actor').fill('compliance@example.test');
await page.getByLabel('Reason').fill('too short');
await page.getByRole('button', { name: 'Confirm release' }).click();
log.push('release refused (short reason): ' + await status());
await page.getByLabel('Reason').fill('Regulator inquiry closed on 2026-09-30; preservation no longer required.');
await page.getByRole('button', { name: 'Confirm release' }).click();
log.push('release: ' + await status());
const execBtn = page.getByRole('button', { name: 'Execute plan (simulated)' });
log.push('execute button after hold change disabled=' + await execBtn.isDisabled() + ' (plan invalidated in UI; engine also re-derives the plan id)');
// reinstate through the form (effective date defaults to the clock), then release again for the second plan
await page.getByRole('button', { name: 'Reinstate hold-audit-hris' }).click();
await page.getByLabel('Actor').fill('compliance@example.test');
await page.getByLabel('Reason').fill('Inquiry reopened; preservation duty resumes.');
await page.getByRole('button', { name: 'Confirm reinstatement' }).click();
log.push('reinstate: ' + await status());
await page.getByRole('button', { name: 'Release hold-audit-hris' }).click(); // the HR-wide hold
await page.getByLabel('Actor').fill('compliance@example.test');
await page.getByLabel('Reason').fill('Regulator inquiry closed; release confirmed by counsel.');
await page.getByRole('button', { name: 'Confirm release' }).click();
log.push('release again: ' + await status());
log.push('hold history: ' + (await page.locator('.trail').innerText()).replace(/\n/g, ' || '));
await page.getByRole('button', { name: /Generate plan/ }).click();
const planId2 = (await page.locator('.plan-id').innerText()).replace('plan ', '');
log.push('plan2 differs=' + (planId2 !== planId1) + ' ' + await status());
await page.getByRole('button', { name: 'Execute plan (simulated)' }).click();
log.push('execute2: ' + await status());
// verify, tamper, verify, restore
await page.getByRole('button', { name: 'Verify chain' }).click();
log.push('verify: ' + await page.locator('.col.right .verdict').last().innerText());
await page.getByRole('button', { name: 'Tamper demo' }).click();
await page.getByRole('button', { name: 'Verify chain' }).click();
log.push('verify tampered: ' + await page.locator('.col.right .verdict').last().innerText());
await page.screenshot({ path: out + '03-tamper-detected.png', fullPage: true });
await page.getByRole('button', { name: 'Restore ledger' }).click();
await page.getByRole('button', { name: 'Verify chain' }).click();
log.push('verify restored: ' + await page.locator('.col.right .verdict').last().innerText());
// move the clock forward a year
await page.getByLabel('As-of date').fill('2027-10-01');
log.push('clock 2027: ' + (await page.locator('.states').innerText()).replace(/\n/g, ' '));
// exports
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export audit JSON' }).click()]);
await dl.saveAs(out + 'export.json'); const j = JSON.parse(await fs.readFile(out + 'export.json', 'utf8'));
log.push(`json schema=${j.schema} plans=${j.plans.length} receipts=${j.receipts.length} chain.ok=${j.chain.ok} reconciled=${j.plans.every((p) => p.reconciliation.ok)} holdHistory=${j.holdHistory.length}`);
const [dc] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Receipts CSV' }).click()]);
await dc.saveAs(out + 'receipts.csv'); log.push('receipts csv lines=' + (await fs.readFile(out + 'receipts.csv', 'utf8')).trim().split('\n').length);
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"label":"x","asOf":"2026-10-01","systems":[],"schedules":[{"id":"s"}],"records":[null],"holds":[{"id":"h","scope":"x"}]}') });
await page.waitForFunction(() => document.querySelector('.mast .verdict')?.textContent?.includes('rejected'));
log.push('import error: ' + await status());
for (const [name, w, h] of [['mobile', 375, 800], ['tablet', 768, 1024]]) { const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' }); const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); log.push(`${name} scrollWidth=${await p.evaluate(() => document.documentElement.scrollWidth)} viewport=${w}`); await p.screenshot({ path: out + `05-${name}.png`, fullPage: true }); await c.close(); }
log.push('pageErrors=' + JSON.stringify(errors));
await browser.close(); await fs.writeFile(out + 'workflow-log.txt', log.join('\n') + '\n'); console.log(log.join('\n'));
