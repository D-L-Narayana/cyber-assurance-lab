// Browser workflow QA for Packetsmith. NODE_PATH=<tools>/node_modules node qa/workflow.mjs http://127.0.0.1:6121/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6121/';
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

  const gateText = await page.locator('.gatecount').textContent();
  check('gate shows blockers on demo', /\d+ blockers? before review/.test(gateText ?? ''));
  check('tamper detected in locker', (await page.locator('.art--bad').count()) === 1);

  // Submit for review must be refused
  await page.getByRole('button', { name: 'Submit for review' }).click();
  check('submit refused with reasons', (await page.locator('.notice--error li').count()) > 3);
  await page.screenshot({ path: path.join(out, '02-submit-refused.png'), fullPage: false });

  // Start a new packet and complete AC-6 end to end
  await page.getByRole('button', { name: 'New packet' }).click();
  await page.getByRole('button', { name: /^AC-6/ }).click();
  check('hash deep link', page.url().endsWith('#/AC-6'));
  await page.getByLabel('In scope for this packet').check();
  // add artifact
  await page.getByLabel('Name', { exact: true }).fill('Privilege matrix export');
  await page.getByLabel(/Synthetic content/).fill('role=admin: all\nrole=reader: read');
  await page.getByRole('button', { name: 'Add and hash' }).click();
  check('artifact hashed', /^[0-9a-f]{64}$/.test((await page.locator('.hash').first().textContent()) ?? ''));
  // add step, perform, attach
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Status for S-01').selectOption('performed');
  await page.getByLabel('Attach artifact to S-01').selectOption('ART-01');
  check('evidence attached', (await page.locator('.chip--ok').count()) >= 1);
  // results: satisfied for both determinations, citing S-01
  for (const det of ['AC-6.1', 'AC-6.2']) {
    await page.getByRole('radio', { name: 'satisfied', exact: true }).nth(det === 'AC-6.1' ? 0 : 1).check();
    await page.getByRole('checkbox', { name: /S-01/ }).nth(det === 'AC-6.1' ? 0 : 1).check();
  }
  check('stamp satisfied', ((await page.locator('.stamp').textContent()) ?? '').trim() === 'satisfied');
  check('gate clear', /No blockers/.test((await page.locator('.gatecount').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '03-ac6-complete.png'), fullPage: true });

  // Transitions: submit as assessor, approve attempt by assessor refused, approve by approver ok
  await page.getByLabel('Acting as').fill('assessor');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  check('state ready-for-review', /ready for review/.test((await page.locator('.state').textContent()) ?? ''));
  await page.getByRole('button', { name: 'Approve packet' }).click();
  check('SoD refusal', /Separation of duties/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.getByLabel('Acting as').fill('approver');
  await page.getByRole('button', { name: 'Approve packet' }).click();
  check('approved', /approved/.test((await page.locator('.state').textContent()) ?? ''));
  check('editing locked after approval', await page.getByLabel('In scope for this packet').isDisabled());
  await page.screenshot({ path: path.join(out, '04-approved.png'), fullPage: false });

  // Memo + exports
  await page.getByRole('button', { name: 'Open print memo' }).click();
  check('memo dialog open', await page.locator('dialog.memo[open]').count() === 1);
  await page.screenshot({ path: path.join(out, '05-memo.png'), fullPage: false });
  await page.locator('dialog.memo .ghost').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export memo (.md)' }).click()]);
  const memo = await fs.readFile(await dl.path(), 'utf8');
  check('memo markdown has digest + disclaimer', /[0-9a-f]{64}/.test(memo) && /not a FedRAMP/.test(memo));
  await fs.writeFile(path.join(out, 'export-memo-sample.md'), memo);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export packet JSON' }).click()]);
  const pk = JSON.parse(await fs.readFile(await dl2.path(), 'utf8'));
  check('exported packet approved with history', pk.state === 'approved' && pk.history.length === 2);

  // Import rejection
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"packetsmith.packet/1","meta":{},"selectedControls":["XX-1"],"state":"shipped"}') });
  await page.waitForSelector('.notice--error');
  check('import rejected', (await page.locator('.notice--error li').count()) > 2);
  await page.screenshot({ path: path.join(out, '06-import-rejected.png'), fullPage: false });

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(url + '#/AC-2', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '07-mobile.png'), fullPage: true });
  check('mobile no horizontal overflow', (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await m.close();
} finally {
  await browser.close();
}
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
process.exit(log.every((l) => l.pass) ? 0 : 1);
