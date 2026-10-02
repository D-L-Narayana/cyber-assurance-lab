// Browser workflow QA for Tierline. NODE_PATH=<tools>/node_modules node qa/workflow.mjs http://127.0.0.1:6122/
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6122/';
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

  // V-08 is pre-selected: tier 2 exactly on boundary, flips both ways
  check('selected V-08 tier 2', (await page.locator('.tierbadge').textContent())?.includes('Tier 2'));
  check('downward flip listed', (await page.locator('.flip--down').count()) > 0);
  check('ghost dots drawn', (await page.locator('.ghostdot').count()) > 0);

  // Change one answer → tier changes live
  await page.getByLabel(/Data sensitivity/).selectOption('confidential');
  check('tier dropped to 3 after answer change', (await page.locator('.tierbadge').textContent())?.includes('Tier 3'));
  check('requirement rows shrink to tier 3 (1 row)', (await page.locator('.reqs tbody tr').count()) === 1);
  await page.screenshot({ path: path.join(out, '02-after-answer-change.png'), fullPage: false });

  // Hard trigger vendor
  await page.getByRole('button', { name: /Keel Managed Security/ }).first().click();
  check('hash deep link', page.url().endsWith('#/V-12'));
  check('hard trigger reason shown', (await page.locator('.reasons .bad').count()) === 1);
  check('all six requirements valid', (await page.locator('.state--valid').count()) === 6);

  // Deepwater: tier 1 with nothing on file — add evidence, coverage rises
  await page.getByRole('button', { name: /Deepwater Data Lake/ }).first().click();
  const before = await page.locator('.score__v').nth(1).textContent();
  check('coverage 0% before', before?.trim() === '0%');
  await page.getByLabel('Title', { exact: true }).fill('Questionnaire received');
  await page.getByRole('button', { name: 'Add evidence' }).click();
  const after = await page.locator('.score__v').nth(1).textContent();
  check('coverage rises after evidence', after?.trim() === '17%');
  await page.screenshot({ path: path.join(out, '03-evidence-added.png'), fullPage: false });

  // Add exception with half credit
  await page.getByLabel('Approved by').fill('ciso');
  await page.getByLabel('Rationale').fill('Bridge letter received; full report due next quarter.');
  await page.getByLabel('Expires on').fill('2026-12-31');
  await page.getByRole('button', { name: 'Add exception' }).click();
  check('exception state shown', (await page.locator('.state--exception').count()) === 1);
  check('coverage 25% with half-credit exception', (await page.locator('.score__v').nth(1).textContent())?.trim() === '25%');

  // Queue filtering + CSV export
  const total = Number((await page.locator('.queue .small.muted').first().textContent())?.match(/(\d+) items/)?.[1]);
  check('queue has items', total > 10);
  await page.getByLabel('Kind').selectOption('tier-drift');
  check('tier-drift filter shows rows', (await page.locator('.queue tbody tr').count()) >= 1);
  await page.getByLabel('Kind').selectOption('all');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export queue CSV' }).click()]);
  const csv = await fs.readFile(await dl.path(), 'utf8');
  check('csv rows = queue items + header', csv.split('\r\n').length === total + 1);
  await fs.writeFile(path.join(out, 'export-queue-sample.csv'), csv);

  // asOf change recomputes expiry
  await page.getByLabel('Assess as of').fill('2027-06-01');
  check('asOf shift increases queue', Number((await page.locator('.queue .small.muted').first().textContent())?.match(/(\d+) items/)?.[1]) > total);
  await page.screenshot({ path: path.join(out, '04-queue-future.png'), fullPage: false });

  // Import rejection
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"tierline.register/1","asOf":"2026-10-01","vendors":[{"id":"V","name":"X","answers":{"q1":"nope","q9":"x"},"evidence":[{"id":"E","type":"pen-test","title":"t","issuedOn":"2026-02-30","validMonths":0}]}]}') });
  await page.waitForSelector('.notice--error');
  check('import rejected with 4+ issues', (await page.locator('.notice--error li').count()) >= 4);
  await page.screenshot({ path: path.join(out, '05-import-rejected.png'), fullPage: false });

  // Keyboard on quadrant dot
  await page.locator('.dotg').first().focus();
  await page.keyboard.press('Enter');
  check('keyboard selects dot', (await page.locator('.vd__title h2').count()) === 1);

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(url + '#/V-02', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '06-mobile.png'), fullPage: true });
  check('mobile no horizontal overflow', (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await m.close();
} finally {
  await browser.close();
}
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
process.exit(log.every((l) => l.pass) ? 0 : 1);
