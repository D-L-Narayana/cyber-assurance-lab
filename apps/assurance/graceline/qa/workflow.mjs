// Browser workflow QA for Graceline. NODE_PATH=<tools>/node_modules node qa/workflow.mjs http://127.0.0.1:6124/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6124/';
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

  // EX-107 escalated preselected; history includes system ticks
  check('EX-107 escalated', /escalated/.test((await page.locator('.dt__head .st').textContent()) ?? ''));
  check('history has tick events', (await page.locator('.hist__item.ev--tick').count()) === 2);
  check('escalated cannot renew (no renew button)', (await page.getByRole('button', { name: /Renew/ }).count()) === 0);

  // Close escalated with too-short evidence → refused; then proper evidence → closed
  await page.getByLabel('Acting as').fill('infra.lead');
  await page.getByLabel(/Closure evidence/).fill('fixed');
  await page.getByRole('button', { name: 'Close with evidence' }).click();
  check('short closure refused', /refused by policy/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.getByLabel(/Closure evidence/).fill('Replacement encryption module installed 2026-09-30; retained tapes re-encrypted; change CHG-4499.');
  await page.getByRole('button', { name: 'Close with evidence' }).click();
  check('closed', /closed/.test((await page.locator('.dt__head .st').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '02-closed.png'), fullPage: false });

  // EX-103 under review: approve as requester → SoD refusal; approve as risk-owner → active
  await page.getByRole('button', { name: /^EX-103 / }).first().click();
  check('hash deep link', page.url().endsWith('#/EX-103'));
  await page.getByLabel('Acting as').fill('app.owner');
  await page.getByLabel('Role').selectOption('risk-owner');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  check('SoD refusal', /Separation of duties/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.getByLabel('Acting as').fill('risk.owner');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  check('quorum met → active', /active/.test((await page.locator('.dt__head .st').textContent()) ?? ''));
  check('two approvals listed', (await page.locator('.approvals li').count()) === 2);
  await page.screenshot({ path: path.join(out, '03-activated.png'), fullPage: false });

  // Renewal: third party refused; beyond policy max refused; valid request → pending, term unchanged, approvals reset; quorum applies it
  await page.getByLabel(/Renew to/).fill('2027-02-20');
  await page.getByRole('button', { name: /Request renewal/ }).click();
  check('renewal by non-requester refused', /Only the requester/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.getByLabel('Acting as').fill('app.owner');
  await page.getByLabel(/Renew to/).fill('2027-09-01');
  await page.getByRole('button', { name: /Request renewal/ }).click();
  check('over-long renewal refused', /90 days/.test((await page.locator('.notice--error').textContent()) ?? ''));
  await page.getByLabel(/Renew to/).fill('2027-02-20');
  await page.getByRole('button', { name: /Request renewal/ }).click();
  check('renewal pending, still active with old expiry', /Renewal pending/.test((await page.locator('.notice--warn').textContent()) ?? '') && /active/.test((await page.locator('.dt__head .st').textContent()) ?? '') && /2026-12-15/.test((await page.locator('.dt__head').textContent()) ?? ''));
  check('approvals reset', (await page.locator('.approvals li').count()) === 0);
  await page.getByLabel('Acting as').fill('risk.owner');
  await page.getByLabel('Role').selectOption('risk-owner');
  await page.getByRole('button', { name: 'Approve renewal' }).click();
  await page.getByLabel('Acting as').fill('line.manager');
  await page.getByLabel('Role').selectOption('manager');
  await page.getByRole('button', { name: 'Approve renewal' }).click();
  check('renewal quorum applies new expiry', /2027-02-20/.test((await page.locator('.dt__head').textContent()) ?? '') && /renewals 1\//.test((await page.locator('.dt__head').textContent()) ?? ''));

  // EX-110 at renewal cap → renew disabled
  await page.getByRole('button', { name: /^EX-110 / }).first().click();
  check('renew disabled at cap', await page.getByRole('button', { name: /Request renewal/ }).isDisabled());

  // Draft EX-101 submit → guardrail list (compensating control missing, justification short)
  await page.getByRole('button', { name: /^EX-101 / }).first().click();
  await page.getByRole('button', { name: 'Submit request' }).click();
  const guardText = (await page.locator('.notice--error').textContent()) ?? '';
  check('draft submit lists compensating + justification guardrails', /compensating/i.test(guardText) && /Justification/.test(guardText));
  await page.screenshot({ path: path.join(out, '04-guardrails.png'), fullPage: false });
  // Fix the draft and submit
  await page.getByLabel(/Compensating controls/).fill('Scanners on isolated VLAN\nShared password rotated weekly and logged');
  await page.getByLabel(/Justification/).fill('Scanner firmware has no per-user login; vendor roadmap adds it in Q1; access is limited to the warehouse floor.');
  await page.getByRole('button', { name: 'Submit request' }).click();
  check('draft submitted after fixes', /submitted/.test((await page.locator('.dt__head .st').textContent()) ?? ''));

  // Time travel: board date forward → active EX-105 expires and later escalates
  await page.getByLabel('Board date').fill('2026-10-20');
  check('time moves EX-105 to expired', /EX-105 → expired/.test((await page.locator('.notice').textContent()) ?? ''));
  await page.getByLabel('Board date').fill('2026-11-20');
  check('time moves EX-105 to escalated', /EX-105 → escalated/.test((await page.locator('.notice').textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '05-time-travel.png'), fullPage: true });

  // Export register
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export risk register' }).click()]);
  const reg = JSON.parse(await fs.readFile(await dl.path(), 'utf8'));
  check('register export has ranked list + policy', Array.isArray(reg.ranked) && reg.policy.maxRenewals === 2);

  // Import rejection
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"graceline.board/1","asOf":"2026-10-01","exceptions":[{"id":"X","title":"t","policyRef":"p","riskLevel":"extreme","requester":"r","state":"limbo","renewals":-1,"requestedOn":"2026-01-01","startOn":"2026-01-01","expiresOn":"2026-02-30","remediation":{"plan":"","dueOn":"2026-01-01","status":"planned"}}]}') });
  await page.waitForSelector('.notice--error');
  check('import rejected with paths', (await page.locator('.notice--error li').count()) >= 4);

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(url + '#/EX-105', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '06-mobile.png'), fullPage: true });
  check('mobile no horizontal overflow', (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await m.close();
} finally {
  await browser.close();
}
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
process.exit(log.every((l) => l.pass) ? 0 : 1);
