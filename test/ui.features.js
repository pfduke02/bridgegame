// Claims, the review of your play, and the installed app.   node test/ui.features.js
// Build first (node build.js): the app is served from docs/. Needs Playwright.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'aiRun', 'mkBid', 'callName', 'scoreContract', 'seatVul']);

// Everything is served from docs/ over a local web server: the way a phone gets it, and file:// pages
// in headless Chromium can read stale storage after a quick reload.
let BASE = '';
function serveDocs() {
  const root = path.join(__dirname, '..', 'docs');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer(function (req, res) {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(function (r) { server.listen(0, '127.0.0.1', function () { r(server); }); });
}
const KEY = 'pocket-bridge-v1';
let failed = 0, checks = 0;
const ok = function (c, label) { checks++; if (!c) { failed++; console.log('FAIL ' + label); } };
const wrap = function (g, extra) { return Object.assign({ v: 1, game: g.toJSON(), boardNo: g.board, history: [], settings: { speed: 'fast', fourColour: false, level: 1 }, recorded: false, texts: {} }, extra || {}); };

// A position late in a deal that North-South declare, with the human to play, and what North-South can still take.
function claimPosition(seed) {
  const rnd = E.mulberry32(seed);
  for (let t = 0; t < 400; t++) {
    const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
    while (g.phase === 'auction') g.makeCall(E.aiRun({ type: 'call', view: g.view(g.turn) }).call);
    if (!g.contract || (g.declarer & 1) !== 0) continue;
    while (g.phase === 'play' && g.tricks.length < 9) { const v = g.view(g.actor()); v.rulesOnly = true; g.playCard(E.aiRun({ type: 'play', view: v, level: 1 }).card); }
    while (g.phase === 'play' && !((g.turn & 1) === 0 && g.cur.cards.length === 0)) { const v = g.view(g.actor()); v.rulesOnly = true; g.playCard(E.aiRun({ type: 'play', view: v, level: 1 }).card); }
    if (g.phase !== 'play') continue;
    const can = E.aiRun({ type: 'claim', hands: g.rem, trump: g.contract.strain, leader: g.cur.leader, trick: g.cur.cards, seat: g.turn }).tricks;
    if (can >= 1 && can < g.tricksLeft()) return { g: g, can: can };
  }
  throw new Error('no claim position found');
}

async function open(browser, saved, opt) {
  opt = opt || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, deviceScaleFactor: opt.shots ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', function (e) { errors.push(String(e)); });
  await page.route('**/fonts.googleapis.com/**', function (r) { r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  await page.addInitScript(function (a) { try { if (!localStorage.getItem('test-seeded')) { localStorage.setItem('test-seeded', '1'); localStorage.setItem(a.k, a.v); } } catch (e) { /* ignore */ } }, { k: KEY, v: JSON.stringify(saved) });
  await page.goto(opt.url || BASE);
  return { ctx: ctx, page: page, errors: errors };
}
const state = function (page) { return page.evaluate(function () { return window.PocketBridge.state(); }); };
const shot = async function (page, name) { if (process.env.SHOT_DIR) { await page.waitForTimeout(450); fs.mkdirSync(process.env.SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png') }); } };

async function claims(browser) {
  const pos = claimPosition(2718);
  const left = pos.g.tricksLeft();
  console.log('claim position: board ' + pos.g.board + ', ' + left + ' tricks left, North-South can take ' + pos.can);
  // 1. claiming more than is there is refused, and the play goes on
  let o = await open(browser, wrap(pos.g), { shots: true });
  await o.page.waitForFunction(function () { const s = window.PocketBridge.state(); return s.humanToAct; }, null, { timeout: 20000 });
  ok(await o.page.locator('#btn-claim').isVisible(), 'Claim button shows during the play');
  await o.page.locator('#btn-claim').click();
  await o.page.waitForSelector('#sheet-claim:not([hidden])');
  ok((await o.page.locator('#claim-n').textContent()) === String(left), 'the claim starts at all the remaining tricks');
  for (let i = left; i > pos.can + 1; i--) await o.page.locator('#claim-minus').click();
  await shot(o.page, 'claim-sheet');
  await o.page.locator('#claim-go').click();
  await o.page.waitForSelector('#claim-msg:not([hidden])', { timeout: 30000 });
  let st = await state(o.page);
  ok(st.phase === 'play' && st.tricksLeft === left, 'a claim of one trick too many is refused and play continues');
  ok(/do not accept|played out/.test(await o.page.locator('#claim-msg').textContent()), 'the refusal says to play on');
  // 2. claiming exactly what is there is accepted and ends the deal with the right score
  await o.page.locator('#claim-minus').click();
  await o.page.locator('#claim-go').click();
  await o.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
  st = await state(o.page);
  const decl = pos.g.taken[pos.g.declarer & 1] + pos.can;
  const c = pos.g.contract, sc = E.scoreContract(c.level, c.strain, c.doubled, E.seatVul(pos.g.vul, pos.g.declarer), decl);
  ok(st.phase === 'over' && st.result.declTricks === decl && st.result.nsScore === sc, 'an accepted claim scores the claimed tricks (' + decl + ' tricks, ' + sc + ')');
  ok(/claimed/.test(await o.page.locator('#res-outcome').textContent()), 'the result says the deal ended with a claim');
  await o.page.waitForSelector('#yp-sum', { timeout: 60000 });
  await shot(o.page, 'claim-result');
  // 3. the claim survives a reload
  await o.page.reload();
  try { await o.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 20000 }); }
  catch (e) { const d = await state(o.page).catch(function () { return null; }); console.log('   after reload: ' + JSON.stringify(d && { board: d.board, phase: d.phase, sheet: d.sheet, plays: d.plays }) + ' errors ' + JSON.stringify(o.errors)); throw e; }
  st = await state(o.page);
  ok(st.phase === 'over' && st.result.declTricks === decl, 'a claimed deal is restored after a reload');
  ok(o.errors.length === 0, 'no errors while claiming' + (o.errors.length ? ': ' + o.errors[0] : ''));
  await o.ctx.close();
  // 4. conceding the rest needs no check
  o = await open(browser, wrap(pos.g));
  await o.page.waitForFunction(function () { return window.PocketBridge.state().humanToAct; }, null, { timeout: 20000 });
  await o.page.locator('#btn-claim').click();
  for (let i = 0; i < left; i++) await o.page.locator('#claim-minus').click();
  ok((await o.page.locator('#claim-go').textContent()) === 'Concede', 'claiming none is labelled Concede');
  await o.page.locator('#claim-go').click();
  await o.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 20000 });
  st = await state(o.page);
  ok(st.result.declTricks === pos.g.taken[pos.g.declarer & 1], 'conceding gives the opponents every remaining trick');
  await o.ctx.close();
}

async function review(browser) {
  // South makes deliberately odd calls and plays lowest cards, so there is something to find
  const rnd = E.mulberry32(99);
  let g = null;
  for (let t = 0; t < 100 && !g; t++) {
    const h = new E.Game(E.newDeal(3 + t, rnd));
    let odd = false;
    while (h.phase === 'auction') {
      let call = E.aiRun({ type: 'call', view: h.view(h.turn) }).call;
      if (h.turn === 2 && !odd && h.isLegalCall(E.mkBid(4, 3))) { call = E.mkBid(4, 3); odd = true; }
      h.makeCall(call);
    }
    if (!h.contract) continue;
    while (h.phase === 'play') {
      const actor = h.actor(), legal = h.legalCards();
      if (actor === 2) h.playCard(legal.reduce(function (a, b) { return b % 13 < a % 13 ? b : a; }));
      else { const v = h.view(actor); v.rulesOnly = true; h.playCard(E.aiRun({ type: 'play', view: v, level: 1 }).card); }
    }
    g = h;
  }
  const o = await open(browser, wrap(g), { shots: true });
  await o.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 20000 });
  await o.page.waitForSelector('#yp-sum', { timeout: 60000 });
  const st = await state(o.page);
  const h = st.history[0], rv = h.review;
  ok(rv && rv.cost.length === g.plays.length, 'every card of the deal was checked (' + (rv ? rv.cost.length : 0) + ' of ' + g.plays.length + ')');
  // the accounting holds: start - declarer's mistakes + defence's mistakes = tricks taken
  const seats = []; { const r = new E.Game({ board: g.board, dealer: g.dealer, vul: g.vul, hands: g.hands, calls: g.calls }); g.plays.forEach(function (c) { seats.push(r.turn); r.playCard(c); }); }
  let declErr = 0, defErr = 0, unknown = 0;
  rv.cost.forEach(function (c, i) { if (c < 0) unknown++; else if (((seats[i] ^ g.declarer) & 1) === 0) declErr += c; else defErr += c; });
  if (!unknown) ok(rv.start - declErr + defErr === g.result.declTricks, 'perfect-play tricks minus mistakes add up to the tricks taken');
  const sum = await o.page.locator('#yp-sum').textContent();
  ok(sum.indexOf(String(g.result.declTricks)) >= 0, 'the summary states the tricks taken: ' + sum);
  ok(rv.bids.some(function (b) { return g.calls[b.i] === E.mkBid(4, 3); }), 'the odd 4♠ call is flagged against the bots’ system');
  ok(await o.page.locator('.yp-bid').count() >= 1, 'bidding differences are listed');
  const mySlips = Object.keys(rv.best).length;
  ok(await o.page.locator('.yp-row').count() === rv.cost.filter(function (c, i) { return c > 0 && (seats[i] === 2 || ((g.declarer & 1) === 0 && seats[i] === 0)); }).length, 'each costly card of yours is listed (' + mySlips + ')');
  console.log('review summary: ' + sum);
  await shot(o.page, 'review-result');
  await o.page.locator('.yp-open').click();
  await o.page.waitForSelector('#sheet-review:not([hidden])');
  const marks = await o.page.locator('#rev-tricks .tl-c.cost').count();
  ok(marks === rv.cost.filter(function (c) { return c > 0; }).length, 'the trick list marks every card that cost a trick (' + marks + ')');
  ok(await o.page.locator('#rev-auction .diff').count() === rv.bids.length, 'the auction marks the calls the bots would have made differently');
  await shot(o.page, 'review-sheet');
  await o.page.reload();
  await o.page.waitForSelector('#yp-sum', { timeout: 20000 });
  const st2 = await state(o.page);
  ok(JSON.stringify(st2.history[0].review) === JSON.stringify(rv), 'the review is kept after a reload');
  ok(o.errors.length === 0, 'no errors in the review' + (o.errors.length ? ': ' + o.errors[0] : ''));
  await o.ctx.close();
}

async function installed(browser) {
  const url = BASE.replace('127.0.0.1', 'localhost');     // localhost counts as a secure origin for service workers
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  await page.route('**/fonts.googleapis.com/**', function (r) { r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  await page.goto(url);
  const man = await page.evaluate(async function () {
    const link = document.querySelector('link[rel="manifest"]'), touch = document.querySelector('link[rel="apple-touch-icon"]');
    const m = await (await fetch(link.href)).json();
    const sizes = [];
    for (const src of [touch.getAttribute('href')].concat(m.icons.map(function (i) { return i.src; }))) {
      const img = new Image(); img.src = src; await img.decode(); sizes.push(src + ' ' + img.naturalWidth + 'x' + img.naturalHeight);
    }
    return { m: m, sizes: sizes, capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]') };
  });
  ok(man.m.display === 'standalone' && man.m.start_url === './' && man.m.icons.length === 2, 'the manifest describes a full-screen app');
  ok(man.sizes.join() === 'icon-180.png 180x180,icon-192.png 192x192,icon-512.png 512x512', 'icons load at their stated sizes: ' + man.sizes.join(', '));
  ok(man.capable, 'iPhone full-screen tag present');
  await page.evaluate(function () { return navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 15000 });
  ok(true, 'the offline worker installs and takes control');
  await ctx.setOffline(true);
  let offlineOk = false;
  try {
    await page.reload();
    await page.waitForFunction(function () { return window.PocketBridge && window.PocketBridge.state().humanToAct; }, null, { timeout: 30000 });
    offlineOk = true;
  } catch (e) { console.log('   offline reload: ' + String(e.message).split('\n')[0]); }
  ok(offlineOk, 'with no connection the game still opens and plays');
  if (offlineOk) {
    const before = (await state(page)).calls;
    const p = await page.evaluate(function () { const s = window.PocketBridge.state(); if (s.phase !== 'auction') return null; const b = document.getElementById('bb-pass').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    if (p) { await page.touchscreen.tap(p.x, p.y); await page.waitForFunction(function (n) { return window.PocketBridge.state().calls > n; }, before, { timeout: 30000 }); ok(true, 'a call made offline goes through and the bots answer'); }
  }
  ok(errors.length === 0, 'no errors in the installed app' + (errors.length ? ': ' + errors[0] : ''));
  await ctx.close();
}

(async function () {
  const server = await serveDocs();
  BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  for (const [name, fn] of [['claims', claims], ['review', review], ['installed', installed]]) {
    try { await fn(browser); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
  }
  await browser.close();
  server.close();
  console.log(checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
