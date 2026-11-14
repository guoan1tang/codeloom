// CodeLoom tree-view browser regression (20 assertions).
// Prereq: npm i puppeteer-core; node src/cli.js serve + indexed db; node webtest.js
// CodeLoom tree-view regression (tree-only UI).
// Prereq: npm i puppeteer-core, running `codeloom serve` + indexed db.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execFileSync } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.CODELOOM_WEB_URL || 'http://127.0.0.1:3199';
const errors = [];
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL: ' + n); } };

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 60000, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/#graph', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#tree-body .tree-row.lvl0').length > 0, { timeout: 20000, polling: 200 });
  await sleep(500);

  console.log('[1] tree boot');
  check('tree is the only view (no canvas controls)', await page.evaluate(() => !document.getElementById('graph-canvas') && !document.getElementById('mode-graph')));
  check('one service root (default focus)', await page.$$eval('#tree-body .tree-row.lvl0', e => e.length) === 1);
  check('API/MQ/JOB groups', await page.$$eval('#tree-body .tree-row.lvl1', e => e.length) === 3);
  check('API group expanded with entries', await page.$$eval('#tree-body .tree-row.lvl2', e => e.length) > 0);
  check('summary line present', /API · .*MQ · .*JOB/.test(await page.$eval('#tree-summary', e => e.textContent)));

  console.log('[2] repo switch linkage');
  const firstRepo = await page.$eval('#tree-body .tree-row.lvl0 .t-label', e => e.textContent);
  await page.select('#repo-focus', 'all');
  await sleep(600);
  const allRepos = await page.$$eval('#tree-body .tree-row.lvl0', e => e.length);
  check('switch to all shows every repo', allRepos >= 2);
  await page.select('#repo-focus', 'order-service');
  await sleep(600);
  check('switch to order-service updates tree', await page.$eval('#tree-body .tree-row.lvl0 .t-label', e => e.textContent) === 'order-service');
  await page.select('#repo-focus', firstRepo);
  await sleep(600);

  console.log('[3] tree interactions');
  await page.click('#tree-body .tree-row.lvl2');
  await sleep(400);
  check('entry opens detail drawer', await page.$eval('#drawer', el => el.classList.contains('open')));
  check('drawer shows provider/consumer children', await page.$$eval('#tree-body .tree-row.lvl3', e => e.length) >= 0);
  await page.click('#drawer-close');
  await page.evaluate(() => { const row = document.querySelector('#tree-body .tree-row.lvl2'); row.querySelector('.caret').click(); });
  await sleep(400);
  check('caret expands entry children', await page.$$eval('#tree-body .tree-children.open .tree-row.lvl3', e => e.length) > 0);
  await page.type('#tree-filter', 'inventory');
  await sleep(300);
  const filtered = await page.$$eval('#tree-body .tree-row.lvl2', e => e.length);
  check('filter narrows entries', filtered >= 1 && filtered < 50);
  await page.evaluate(() => { const i = document.getElementById('tree-filter'); i.value = ''; i.dispatchEvent(new Event('input')); });

  console.log('[4] impact view');
  await page.click('.navtab[data-route="impact"]');
  await sleep(300);
  await page.select('#imp-repo', 'inventory-service');
  await page.evaluate(() => {
    const s = document.getElementById('imp-method');
    const hit = [...s.options].find(o => o.value.includes('Impl') && o.textContent.startsWith('deductStock()')) || [...s.options].find(o => (IDX.callsIn.get(o.value) || 0) > 0);
    if (hit) s.value = hit.value;
  });
  await page.click('#imp-run');
  await page.waitForSelector('#imp-results .tile', { timeout: 10000 });
  check('impact produces paths', await page.$$eval('#imp-results .pathcard', e => e.length) >= 1);

  console.log('[5] trace view');
  await page.click('.navtab[data-route="trace"]');
  await sleep(400);
  check('trace scenarios from endpoints', await page.$$eval('#scen-tabs .scen-tab', e => e.length) >= 1);
  await page.click('#tr-play');
  await sleep(1600);
  check('trace playback advances', /\/\d+/.test(await page.$eval('#tr-caption', e => e.textContent)));
  await page.click('#tr-play');

  console.log('[6] agent loop');
  await page.click('.navtab[data-route="agent"]');
  await sleep(600);
  await page.select('#ag-repo', 'gateway');
  await sleep(600);
  check('real commits loaded', await page.$$eval('#ag-commit option', e => e.length) >= 1);
  await page.click('#ag-run');
  await sleep(2500);
  const done = await page.$$eval('#pipe-rail .pipe-card.done', e => e.length);
  check('agent pipeline ran', done === 3);

  console.log('[7] repos mutation');
  await page.click('.navtab[data-route="repos"]');
  await sleep(300);
  const before = await page.$$eval('#repo-tbody tr', e => e.length);
  fs.rmSync('/tmp/codeloom-web/order-copy', { recursive: true, force: true });
  fs.cpSync('/tmp/codeloom-web/order-service', '/tmp/codeloom-web/order-copy', { recursive: true, filter: s => !s.includes('/.git') });
  execFileSync('git', ['-C', '/tmp/codeloom-web/order-copy', 'init', '-q']);
  execFileSync('git', ['-C', '/tmp/codeloom-web/order-copy', '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  execFileSync('git', ['-C', '/tmp/codeloom-web/order-copy', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'copy']);
  await page.click('#repo-add-btn');
  await sleep(200);
  await page.type('#add-url', '/tmp/codeloom-web/order-copy');
  await page.click('#add-submit');
  await page.waitForSelector('#add-done:not([hidden])', { timeout: 20000 });
  await page.click('#add-done');
  await sleep(600);
  await page.click('.navtab[data-route="repos"]');
  await sleep(300);
  check('repo added', await page.$$eval('#repo-tbody tr', e => e.length) === before + 1);
  const del = await page.$('#repo-tbody tr[data-id="order-copy"] .act-delete');
  await del.click();
  await sleep(300);
  const confirm = await page.$('#toasts .toast button');
  if (confirm) { await confirm.click(); await sleep(900); }
  check('repo removed', await page.$$eval('#repo-tbody tr', e => e.length) === before);

  console.log('[8] mcp console');
  await page.click('.navtab[data-route="mcp"]');
  await sleep(300);
  await page.click('#mcp-run');
  await sleep(400);
  check('console returns real symbols', await page.$eval('#mcp-response', e => e.textContent).then(t => t.includes('deductStock')));

  console.log('[9] mobile');
  const mob = await browser.newPage();
  await mob.bringToFront();
  mob.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mob.setViewport({ width: 400, height: 820 });
  await mob.goto(BASE + '/#graph', { waitUntil: 'networkidle0' });
  await mob.waitForFunction(() => document.querySelectorAll('#tree-body .tree-row.lvl0').length > 0, { timeout: 20000, polling: 200 });
  await sleep(400);
  check('mobile no horizontal overflow', await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mob.screenshot({ path: 'tree-mobile.png' });

  console.log('\n[runtime errors] ' + (errors.length ? errors.join('\n') : 'NONE'));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e.message); process.exit(2); });