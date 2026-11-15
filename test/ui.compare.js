// Result-panel comparison test: node test/ui.compare.js
// Loads the built page with a finished deal in storage and checks that four bots replay it in the
// background and the duplicate comparison (contract, tricks, score, IMPs) appears and persists.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'aiRun', 'scoreContract', 'impsFor']);

(async function () {
  let failed = 0, checks = 0;
  const ok = function (c, label) { checks++; if (!c) { failed++; console.log('FAIL ' + label); } };
  // a deal already bid and played (quick bots), ready to be scored by the page
  const g = new E.Game(E.newDeal(1, E.mulberry32(2024)));
  while (g.phase === 'auction') g.makeCall(E.aiRun({ type: 'call', view: g.view(g.turn) }).call);
  while (g.phase === 'play') { const v = g.view(g.actor()); v.rulesOnly = true; g.playCard(E.aiRun({ type: 'play', view: v, level: 1 }).card); }
  const saved = { v: 1, game: g.toJSON(), boardNo: 1, history: [], settings: { speed: 'fast', fourColour: false, level: 2 }, recorded: false, texts: {} };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', function (e) { errors.push(String(e)); });
  await page.route('**/fonts.googleapis.com/**', function (r) { r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  await page.addInitScript(function (s) { try { if (!localStorage.getItem('pocket-bridge-v1')) localStorage.setItem('pocket-bridge-v1', s); } catch (e) { /* ignore */ } }, JSON.stringify(saved));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'bridge.html'));
  await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 15000 });
  ok(await page.locator('#cmp-body .cmp-row').count() >= 1, 'your own line is shown at once');
  const waiting = await page.locator('#cmp-body .cmp-wait').count();
  console.log('replay in progress shown: ' + (waiting > 0));
  await page.waitForSelector('#cmp-verdict', { timeout: 120000 });
  const st = await page.evaluate(function () { return window.PocketBridge.state(); });
  const h = st.history[0];
  ok(h && h.bots && Number.isFinite(h.bots.ns), 'bots result stored with the board');
  ok(Array.isArray(h.botCalls) && h.botCalls.length >= 4, 'bots auction stored');
  if (h.bots && !h.bots.passedOut) {
    const vul = (h.bots.declarer & 1) === 0 ? (g.vul & 1) !== 0 : (g.vul & 2) !== 0;
    const sc = E.scoreContract(h.bots.level, h.bots.strain, h.bots.doubled, vul, h.bots.tricks);
    ok(((h.bots.declarer & 1) === 0 ? sc : -sc) === h.bots.ns, 'bots score matches the scoring rules');
  }
  ok(h.ns === g.result.nsScore, 'your score is the result of the deal played at the table');
  const verdict = await page.locator('#cmp-verdict').textContent();
  const imps = E.impsFor(h.ns - h.bots.ns);
  ok(imps === 0 ? /Flat|too little/.test(verdict) : verdict.indexOf(String(Math.abs(imps))) >= 0, 'verdict names the IMP difference (' + verdict + ')');
  const rows = await page.locator('#cmp-body .cmp-row').allTextContents();
  console.log('rows: ' + rows.join(' | '));
  console.log('verdict: ' + verdict);
  await page.waitForFunction(function () { const s = window.PocketBridge.state(); return !s.comparing && s.compareQueue === 0; }, null, { timeout: 60000 });
  console.log('notes: ' + (await page.locator('#cmp-body .cmp-note').allTextContents()).join(' | '));
  console.log('pad: ' + (await page.locator('#pad-net').textContent()));
  if (process.env.SHOT_DIR) { fs.mkdirSync(process.env.SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'compare.png') }); }
  // reload: the comparison is remembered, nothing is recomputed
  await page.reload();
  await page.waitForSelector('#cmp-verdict', { timeout: 15000 });
  const st2 = await page.evaluate(function () { return window.PocketBridge.state(); });
  ok(JSON.stringify(st2.history[0].bots) === JSON.stringify(h.bots), 'comparison survives a reload');
  ok(!st2.comparing, 'no replay is started again after a reload');
  // next deal starts normally while nothing is left running
  await page.locator('#res-next').click();
  await page.waitForFunction(function () { return window.PocketBridge.state().board === 2; }, null, { timeout: 10000 });
  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
  await browser.close();
  console.log(checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e.stack || e)); process.exit(1); });
