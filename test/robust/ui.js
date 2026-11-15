// Robustness: the page under abuse, in headless Chromium.
//   node test/robust/ui.js [sections] [seed]     sections: saves,failures,monkey,soak,sizes,slow (default: all but slow)
//   MONKEY_PROFILE=wild|busy (default busy), MONKEY_MS, SOAK_DEALS
// Build first (node build.js). Needs Playwright.
const path = require('path');
const { chromium } = require('playwright');
const load = require('../load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'aiRun', 'mkBid']);

const PAGE = 'file://' + path.join(__dirname, '..', '..', 'dist', 'bridge.html');
const KEY = 'pocket-bridge-v1';
const want = (process.argv[2] || 'saves,failures,monkey,soak,sizes').split(',');
const seed = +(process.argv[3] || 1);
const rnd = E.mulberry32(seed * 104729 + 7);
const ri = function (n) { return Math.floor(rnd() * n); };
let failed = 0;
const report = function (label, ok, detail) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); };
const FAST = { speed: 'fast', fourColour: false, level: 1 };

// ---------- saved positions built with the engine ----------
function wrap(game, extra) { return Object.assign({ v: 1, game: game.toJSON(), boardNo: game.board, history: [], settings: FAST, recorded: false, texts: {} }, extra || {}); }
function freshGame(board, s) { return new E.Game(E.newDeal(board, E.mulberry32(s))); }
function finishedGame(board, s) {
  const g = freshGame(board, s);
  while (g.phase === 'auction') g.makeCall(E.aiRun({ type: 'call', view: g.view(g.turn) }).call);
  while (g.phase === 'play') { const v = g.view(g.actor()); v.rulesOnly = true; g.playCard(E.aiRun({ type: 'play', view: v, level: 1 }).card); }
  return g;
}
function declaredBy(board, s) {          // the dealer opens 1NT and everyone passes
  const g = freshGame(board, s);
  g.makeCall(E.mkBid(1, 4)); g.makeCall(0); g.makeCall(0); g.makeCall(0);
  return g;
}

// ---------- browser helpers ----------
async function open(browser, opt) {
  opt = opt || {};
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 390, height: 760 }, hasTouch: opt.touch !== false, deviceScaleFactor: 1, reducedMotion: opt.reducedMotion || 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', function (e) { errors.push('pageerror: ' + String(e)); });
  await page.route('**/fonts.googleapis.com/**', function (r) { r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  if (opt.init) await page.addInitScript(opt.init);
  if (opt.storage !== undefined) {
    await page.addInitScript(function (a) {
      try { if (!localStorage.getItem('test-seeded')) { localStorage.setItem('test-seeded', '1'); localStorage.setItem(a.key, a.value); } } catch (e) { /* storage may be disabled on purpose */ }
    }, { key: KEY, value: typeof opt.storage === 'string' ? opt.storage : JSON.stringify(opt.storage) });
  }
  await page.goto(PAGE);
  return { ctx: ctx, page: page, errors: errors };
}
const state = function (page) { return page.evaluate(function () { return window.PocketBridge.state(); }); };
const ready = function (page, ms) {
  return page.waitForFunction(function () { if (!window.PocketBridge) return false; const s = window.PocketBridge.state(); return s.humanToAct || s.sheet === 'result'; }, null, { timeout: ms || 30000 });
};
// One sensible action for the human: pass, or play the first legal card. Returns false if there was nothing to do.
async function humanStep(page) {
  const a = await page.evaluate(function () {
    const s = window.PocketBridge.state();
    if (!s.humanToAct) return null;
    if (s.phase === 'auction') { const b = document.getElementById('bb-pass').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
    const c = document.querySelector('.fan.live .card.playable');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: b.left + 7, y: b.top + b.height / 2 };
  });
  if (!a) return false;
  await page.touchscreen.tap(a.x, a.y);
  return true;
}

// ---------- 1. damaged or hostile saved data ----------
async function sectionSaves(browser) {
  const good = freshGame(9, 41), done = finishedGame(9, 42);
  const j = function (g) { return JSON.parse(JSON.stringify(g.toJSON())); };
  const shortHand = j(good); shortHand.hands[0] = shortHand.hands[0].slice(0, 12);
  const dupCard = j(good); dupCard.hands[0][0] = dupCard.hands[1][0];
  const badCall = j(good); badCall.calls = [1];                                   // a double before any bid
  const lowBid = j(good); lowBid.calls = [E.mkBid(3, 4), E.mkBid(1, 0)];          // insufficient bid
  const revoke = j(declaredBy(9, 43));
  { // first card legal, second card a revoke if that hand could follow
    const g = declaredBy(9, 43); const lead = g.legalCards()[0]; g.playCard(lead);
    const hand = g.rem[g.turn], legal = g.legalCards(), off = hand.find(function (c) { return legal.indexOf(c) < 0; });
    revoke.plays = off === undefined ? [lead, 99] : [lead, off];
  }
  const foreign = j(declaredBy(9, 43)); foreign.plays = [foreign.hands[(foreign.dealer + 3) % 4][0]];   // a card from the wrong hand
  const hist = function (h) { return wrap(done, { history: h, recorded: true }); };
  const okEntry = { board: 9, level: 3, strain: 4, doubled: 0, declarer: 2, made: 0, tricks: 9, ns: 400 };
  const cases = [
    // [label, stored value, expectation: 'fresh' = the save is discarded, 'kept' = the deal on board 9 survives]
    ['not JSON', 'this is not json {{{', 'fresh'],
    ['JSON null', 'null', 'fresh'], ['an array', '[1,2,3]', 'fresh'], ['a number', '12345', 'fresh'], ['empty object', '{}', 'fresh'],
    ['version only', { v: 1 }, 'fresh'], ['future version', Object.assign(wrap(good), { v: 99 }), 'fresh'],
    ['hand of 12 cards', wrap(good, { game: shortHand }), 'fresh'],
    ['same card in two hands', wrap(good, { game: dupCard }), 'fresh'],
    ['illegal call in the log (double before any bid)', wrap(good, { game: badCall }), 'fresh'],
    ['illegal call in the log (insufficient bid)', wrap(good, { game: lowBid }), 'fresh'],
    ['revoke in the play log', wrap(good, { game: revoke }), 'fresh'],
    ['card played from the wrong hand', wrap(good, { game: foreign }), 'fresh'],
    ['dealer out of range', wrap(good, { game: Object.assign(j(good), { dealer: 7 }) }), 'fresh'],
    ['history is a string', wrap(good, { history: 'garbage' }), 'kept'],
    ['history of junk entries', wrap(good, { history: [1, 'x', null, { board: 'x' }, { board: 2, ns: 'NaN' }] }), 'kept'],
    ['settings are junk', wrap(good, { settings: { speed: 'warp', level: 99, fourColour: 'yes' } }), 'kept'],
    ['settings missing', wrap(good, { settings: null }), 'kept'],
    ['board number negative', wrap(good, { boardNo: -5 }), 'kept'], ['board number huge', wrap(good, { boardNo: 1e12 }), 'kept'], ['board number text', wrap(good, { boardNo: 'nine' }), 'kept'],
    ['call meanings are junk', wrap(good, { texts: [1, 2, { a: 1 }] }), 'kept'],
    ['finished deal, bots result is a string', hist([Object.assign({}, okEntry, { bots: 'junk', botCalls: 'junk', dd: 'x' })]), 'kept'],
    ['finished deal, bots result has junk fields', hist([Object.assign({}, okEntry, { bots: { level: 'a', strain: 9, declarer: -1, ns: 'x', made: null, tricks: {} }, botCalls: [99, -1, 'x'], dd: 77 })]), 'kept'],
    ['finished deal, 3,000 boards of history', hist(Array.from({ length: 3000 }, function (_, i) { return Object.assign({}, okEntry, { board: i + 1, bots: { passedOut: true, ns: 0 } }); })), 'kept'],
    ['finished deal marked recorded, no history', wrap(done, { recorded: true }), 'kept']
  ];
  let bad = 0;
  for (const c of cases) {
    const o = await open(browser, { storage: c[1] });
    let why = '';
    try {
      await ready(o.page, 40000);
      const st = await state(o.page);
      if (c[2] === 'fresh' && st.board !== 1) why = 'a damaged save was accepted (board ' + st.board + ')';
      if (c[2] === 'kept' && st.board !== 9) why = 'a usable save was thrown away (board ' + st.board + ')';
      if (!why && st.sheet === 'result') {                          // the result panel must draw, and the next deal must start
        const txt = await o.page.locator('#sheet-result').innerText();
        if (/NaN|undefined|\[object/.test(txt)) why = 'result panel shows junk: ' + (txt.match(/.{0,20}(NaN|undefined|\[object).{0,20}/) || [''])[0].replace(/\s+/g, ' ');
        await o.page.locator('#res-next').click();
        await ready(o.page, 40000);
      }
      if (!why) for (let i = 0; i < 3; i++) { await humanStep(o.page); await o.page.waitForTimeout(150); }
      if (!why && o.errors.length) why = o.errors[0];
    } catch (e) { why = 'did not reach a playable state: ' + String(e.message).split('\n')[0] + (o.errors.length ? ' / ' + o.errors[0] : ''); }
    if (why) { bad++; console.log('   ' + c[0] + ': ' + why.slice(0, 200)); }
    await o.ctx.close();
  }
  report('saved data: ' + cases.length + ' damaged or hostile saves each lead to a playable game (bad ones discarded, usable ones kept)', bad === 0, bad ? bad + ' problem(s)' : '');
}

// ---------- 2. the browser refusing things ----------
async function sectionFailures(browser) {
  const play = async function (o, steps) {
    let acted = 0;
    for (let i = 0; i < 80 && acted < steps; i++) {
      if (await humanStep(o.page)) acted++;
      await o.page.waitForTimeout(250);
      const s = await state(o.page);
      if (s.sheet === 'result') { acted++; await o.page.locator('#res-next').click(); }    // a deal that ended (perhaps passed out) counts, then on to the next
    }
    return acted;
  };
  {
    const o = await open(browser, { init: function () { const bad = function () { throw new Error('storage disabled'); }; Storage.prototype.getItem = bad; Storage.prototype.setItem = bad; Storage.prototype.removeItem = bad; } });
    let why = '';
    try { await ready(o.page); const n = await play(o, 8); if (n < 4) why = 'only ' + n + ' actions went through'; if (o.errors.length) why = o.errors[0]; } catch (e) { why = String(e.message).split('\n')[0]; }
    report('storage refused: the game plays on without saving', !why, why);
    await o.ctx.close();
  }
  const noWorker = [
    ['no Worker support', function () { try { delete window.Worker; } catch (e) { /* ignore */ } window.Worker = undefined; }],
    ['worker script fails to load', function () { URL.createObjectURL = function () { return 'blob:null/00000000-0000-0000-0000-000000000000'; }; }]
  ];
  for (const nw of noWorker) {
    const o = await open(browser, { init: nw[1], storage: wrap(finishedGame(1, 44)) });
    let why = '', detail = '';
    try {
      await o.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 20000 });
      const t0 = Date.now();
      await o.page.waitForSelector('#cmp-verdict', { timeout: 240000 });
      detail = 'comparison finished on the page itself in ' + Math.round((Date.now() - t0) / 1000) + ' s';
      await o.page.locator('#res-next').click();
      await ready(o.page, 60000);
      const n = await play(o, 6);
      const st = await state(o.page);
      if (st.usingWorker) why = 'a worker is in use although none should exist';
      if (n < 3) why = 'bots did not keep the game moving (' + n + ' actions)';
      const real = o.errors.filter(function (e) { return !/Failed to load resource|ERR_FILE_NOT_FOUND|Not allowed to load local resource/.test(e); });
      if (real.length) why = real[0];
    } catch (e) { why = String(e.message).split('\n')[0] + (o.errors.length ? ' / ' + o.errors[0] : ''); }
    report(nw[0] + ': bots and the comparison still run', !why, why || detail);
    await o.ctx.close();
  }
}

// ---------- 3. chaos monkey ----------
async function sectionMonkey(browser) {
  const budget = +(process.env.MONKEY_MS || 240000);
  const busy = (process.env.MONKEY_PROFILE || 'busy') === 'busy';
  // cumulative chances of each kind of action while the table is showing
  const W = busy ? { sensible: 0.70, anyCard: 0.77, box: 0.81, undo: 0.825, hint: 0.86, review: 0.88, menu: 0.905, meaning: 0.93, reload: 0.942, resize: 0.962, next: 0.972 }
    : { sensible: 0.34, anyCard: 0.46, box: 0.54, undo: 0.61, hint: 0.67, review: 0.71, menu: 0.76, meaning: 0.80, reload: 0.83, resize: 0.86, next: 0.88 };
  const sizes = [[390, 760], [320, 568], [430, 932], [768, 1024], [844, 390], [360, 640]];
  const o = await open(browser, { storage: wrap(freshGame(1, 500 + seed)) });
  const page = o.page;
  await ready(page);
  const counts = {}; const bump = function (k) { counts[k] = (counts[k] || 0) + 1; };
  let lastKey = '', lastChange = Date.now(), stuck = '', maxBoard = 1, finished = 0, wasOver = false, actions = 0;
  const t0 = Date.now();
  const tap = async function (p) { if (p) { if (rnd() < 0.8) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); } };
  const pick = function (list) { return list && list.length ? list[ri(list.length)] : null; };
  while (Date.now() - t0 < budget && !stuck) {
    let info;
    try {
      info = await page.evaluate(function () {
        const r = function (el, edge) { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: edge ? b.left + 7 : b.left + b.width / 2, y: b.top + b.height / 2 } : null; };
        const all = function (sel, edge) { return Array.from(document.querySelectorAll(sel)).map(function (e) { return r(e, edge); }).filter(Boolean); };
        const id = function (x) { return r(document.getElementById(x)); };
        return {
          st: window.PocketBridge.state(), playable: all('.fan.live .card.playable', true), cards: all('.fan .card', true),
          levels: all('#bb-levels button'), strains: all('#bb-strains button'), pass: id('bb-pass'), dbl: id('bb-dbl'), rdbl: id('bb-rdbl'),
          undo: id('btn-undo'), hint: id('btn-hint'), review: id('btn-review'), menu: id('btn-menu'), result: id('btn-result'), next: id('btn-next'),
          resNext: id('res-next'), resReplay: id('res-replay'), mReplay: id('m-replay'), mNew: id('m-new'), mYes: id('m-new-yes'), mKeep: id('m-keep'),
          close: all('.sheet:not([hidden]) [data-close]'), speed: all('#set-speed button:not([data-v="relaxed"])'), level: all('#set-level button'), four: id('set-four'),
          calls: all('#auction .au-body button'), bots: all('.cmp-auction summary')
        };
      });
    } catch (e) { await page.waitForTimeout(200); continue; }           // mid-reload
    const st = info.st;
    const key = [st.board, st.calls, st.plays, st.phase, st.sheet, st.comparing].join(':');
    if (key !== lastKey) { lastKey = key; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 75000) stuck = 'no progress for 75 s at ' + JSON.stringify({ board: st.board, phase: st.phase, turn: st.turn, calls: st.calls, plays: st.plays, sheet: st.sheet, humanToAct: st.humanToAct, thinking: st.thinking, hold: st.hold });
    maxBoard = Math.max(maxBoard, st.board);
    if (st.phase === 'over' && !wasOver) finished++;
    wasOver = st.phase === 'over';
    const p = rnd();
    actions++;
    if (st.sheet === 'result') {
      if (p < 0.5) { bump('next deal'); await tap(info.resNext); }
      else if (p < 0.6) { bump('replay deal'); await tap(info.resReplay); }
      else if (p < 0.7) { bump('bots auction'); await tap(pick(info.bots)); }
      else if (p < 0.85) { bump('close sheet'); await tap(pick(info.close)); }
      else { bump('reload'); await page.reload(); }
    } else if (st.sheet === 'menu') {
      if (p < 0.2) { bump('setting'); await tap(pick(info.speed)); }
      else if (p < 0.3) { bump('setting'); await tap(pick(info.level)); }
      else if (p < 0.4) { bump('setting'); await tap(info.four); }
      else if (p < (busy ? 0.42 : 0.45)) { bump('new match'); await tap(info.mNew); await page.waitForTimeout(60); await tap(rnd() < 0.5 ? info.mYes : info.mKeep); const z = await page.evaluate(function () { const e = document.getElementById(Math.random() < 0.5 ? 'm-new-yes' : 'm-keep'); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; }); await tap(z); }
      else if (p < (busy ? 0.45 : 0.5)) { bump('replay deal'); await tap(info.mReplay); }
      else { bump('close sheet'); await tap(pick(info.close)); }
    } else if (st.sheet) { bump('close sheet'); await tap(pick(info.close)); }
    else if (p < W.sensible) {                                       // a sensible move, so deals get finished
      if (st.phase === 'over') { bump('next deal'); await tap(rnd() < 0.7 ? info.next : info.result); }
      else if (st.humanToAct && st.phase === 'auction') {
        if (rnd() < 0.75) { bump('pass'); await tap(info.pass); }
        else { bump('bid'); await tap(pick(info.levels)); await page.waitForTimeout(40); const s2 = await page.evaluate(function () { return Array.from(document.querySelectorAll('#bb-strains button:not([disabled])')).map(function (e) { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }); }); await tap(pick(s2)); }
      } else if (st.humanToAct) { bump('legal card'); await tap(pick(info.playable)); }
      else bump('wait');
    }
    else if (p < W.anyCard) { bump('any card'); await tap(pick(info.cards)); }
    else if (p < W.box) { bump('bidding box'); await tap(pick([].concat(info.levels, info.strains, [info.pass, info.dbl, info.rdbl]).filter(Boolean))); }
    else if (p < W.undo) { bump('undo'); await tap(info.undo); }
    else if (p < W.hint) { bump('hint'); await tap(info.hint); }
    else if (p < W.review) { bump('review'); await tap(info.review || info.result); }
    else if (p < W.menu) { bump('menu'); await tap(info.menu); }
    else if (p < W.meaning) { bump('call meaning'); await tap(pick(info.calls)); }
    else if (p < W.reload) { bump('reload'); await page.reload(); }
    else if (p < W.resize) { bump('resize'); const z = sizes[ri(sizes.length)]; await page.setViewportSize({ width: z[0], height: z[1] }); }
    else if (p < W.next) { bump('next deal'); await tap(info.next); }
    else bump('wait');
    await page.waitForTimeout(20 + ri(180));
  }
  let st = null;
  try { st = await state(page); } catch (e) { /* ignore */ }
  const junk = st ? JSON.stringify(st.history).match(/NaN|undefined/) : null;
  console.log('   ' + actions + ' actions in ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + Object.keys(counts).sort().map(function (k) { return k + ' ' + counts[k]; }).join(', '));
  if (busy && finished < 2 && !stuck) stuck = 'only ' + finished + ' deal(s) finished, so the end-of-deal screens were barely exercised';
  report('chaos monkey (' + (busy ? 'busy' : 'wild') + '): random taps, undo, hints, settings, reloads and resizes never break the page', o.errors.length === 0 && !stuck && !junk,
    stuck || (o.errors.length ? o.errors.length + ' error(s): ' + o.errors.slice(0, 2).join(' / ').slice(0, 300) : 'deals finished ' + finished + ', highest board ' + maxBoard));
  await o.ctx.close();
}

// ---------- 4. long session ----------
async function sectionSoak(browser) {
  const DEALS = +(process.env.SOAK_DEALS || 8);
  const o = await open(browser, { storage: wrap(freshGame(1, 900 + seed)) });
  const page = o.page;
  const mem = function () { return page.evaluate(function () { return { heap: performance.memory ? performance.memory.usedJSHeapSize : 0, nodes: document.getElementsByTagName('*').length }; }); };
  let why = '', first = null, t0 = Date.now(), done = 0;
  try {
    for (let d = 0; d < DEALS; d++) {
      const lim = Date.now() + 180000;
      for (;;) {
        const st = await state(page);
        if (st.sheet === 'result') break;
        if (Date.now() > lim) throw new Error('deal ' + (d + 1) + ' did not finish in 3 minutes');
        if (!(await humanStep(page))) await page.waitForTimeout(120); else await page.waitForTimeout(60);
      }
      done++;
      if (d === 0) first = await mem();
      if (d < DEALS - 1) { await page.locator('#res-next').click(); await ready(page, 60000); }
    }
    await page.waitForFunction(function () { const s = window.PocketBridge.state(); return !s.comparing && s.compareQueue === 0; }, null, { timeout: 240000 });
    const st = await state(page), last = await mem();
    const compared = st.history.filter(function (h) { return h.bots && Number.isFinite(h.bots.ns); }).length;
    if (st.history.length !== DEALS) why = 'history has ' + st.history.length + ' boards, expected ' + DEALS;
    else if (compared !== DEALS) why = 'only ' + compared + ' of ' + DEALS + ' boards were compared with the bots';
    else if (o.errors.length) why = o.errors[0];
    else if (last.nodes > first.nodes * 3 + 400) why = 'page keeps growing: ' + first.nodes + ' -> ' + last.nodes + ' elements';
    report('long session: ' + DEALS + ' deals in a row, every one compared with the bots', !why,
      why || Math.round((Date.now() - t0) / 1000) + ' s; page elements ' + first.nodes + ' -> ' + last.nodes + '; script memory ' + (first.heap / 1048576).toFixed(1) + ' -> ' + (last.heap / 1048576).toFixed(1) + ' MB');
  } catch (e) { report('long session: ' + DEALS + ' deals in a row', false, 'after ' + done + ' deals: ' + String(e.message).split('\n')[0] + (o.errors.length ? ' / ' + o.errors[0] : '')); }
  await o.ctx.close();
}

// ---------- 5. screen sizes ----------
async function sectionSizes(browser) {
  const sizes = [[320, 480], [320, 568], [360, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [1280, 800], [667, 375], [844, 390]];
  const done = finishedGame(5, 45);
  const scenes = [
    ['auction', wrap(freshGame(3, 46)), ['#bb-pass', '#bb-levels button:last-child', '#hand-s .card:first-child', '#hand-s .card:last-child', '#btn-menu']],
    ['play, North face up', wrap(declaredBy(3, 47)), ['#hand-s .card:first-child', '#hand-s .card:last-child', '#hand-n .card:first-child', '#hand-n .card:last-child', '#btn-undo']],
    ['play, side dummy', wrap(declaredBy(4, 48)), ['#hand-s .card:first-child', '#hand-s .card:last-child', '#trick', '#btn-hint']],
    ['result', wrap(done, { recorded: true, history: [{ board: 5, level: done.contract.level, strain: done.contract.strain, doubled: 0, declarer: done.declarer, made: done.result.made, tricks: done.result.declTricks, ns: done.result.nsScore, bots: { level: 4, strain: 3, doubled: 1, declarer: 0, made: -2, tricks: 8, ns: -300 }, botCalls: [0, 0, 6, 0, 21, 1, 0, 0, 0], dd: 9 }] }), ['#res-next', '#res-replay', '#sheet-result [data-close]']]
  ];
  const problems = [];
  for (const z of sizes) {
    for (const sc of scenes) {
      const o = await open(browser, { viewport: { width: z[0], height: z[1] }, storage: sc[1] });
      try {
        await ready(o.page, 60000);
        await o.page.waitForTimeout(250);
        const m = await o.page.evaluate(function (sels) {
          const vw = window.innerWidth, vh = window.innerHeight, out = { over: document.documentElement.scrollWidth > vw + 1 || document.documentElement.scrollHeight > vh + 1, hidden: [] };
          sels.forEach(function (s) {
            const e = document.querySelector(s);
            if (!e) { out.hidden.push(s + ' (missing)'); return; }
            const b = e.getBoundingClientRect();
            if (!b.width || b.left < -1 || b.right > vw + 1 || b.top < -1 || b.bottom > vh + 1) out.hidden.push(s + ' [' + [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)].join(',') + ']');
          });
          return out;
        }, sc[2]);
        if (m.over) problems.push(z.join('x') + ' ' + sc[0] + ': page is larger than the screen');
        if (m.hidden.length) problems.push(z.join('x') + ' ' + sc[0] + ': off screen: ' + m.hidden.join('; '));
        if (o.errors.length) problems.push(z.join('x') + ' ' + sc[0] + ': ' + o.errors[0]);
      } catch (e) { problems.push(z.join('x') + ' ' + sc[0] + ': ' + String(e.message).split('\n')[0]); }
      await o.ctx.close();
    }
  }
  problems.slice(0, 14).forEach(function (p) { console.log('   ' + p); });
  report('screen sizes: ' + sizes.length + ' sizes x ' + scenes.length + ' screens, nothing overflows and the controls are on screen', problems.length === 0, problems.length ? problems.length + ' problem(s)' : '');
}

// ---------- 6. a slow device: processor throttled 4x, no workers, standard bot strength ----------
async function sectionSlow(browser) {
  const o = await open(browser, { init: function () { try { delete window.Worker; } catch (e) { /* ignore */ } window.Worker = undefined; }, storage: wrap(freshGame(2, 77), { settings: { speed: 'fast', fourColour: false, level: 2 } }) });
  const page = o.page;
  let why = '', worst = 0, t0 = Date.now();
  try {
    const cdp = await o.ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await ready(page, 120000);
    let lastKey = '', lastAt = Date.now();
    for (;;) {
      const st = await state(page);
      const key = st.calls + ':' + st.plays + ':' + st.phase;
      if (key !== lastKey) { if (!st.humanToAct || lastKey) worst = Math.max(worst, Date.now() - lastAt); lastKey = key; lastAt = Date.now(); }
      if (st.sheet === 'result') break;
      if (Date.now() - t0 > 600000) throw new Error('deal not finished in 10 minutes');
      if (Date.now() - lastAt > 60000) throw new Error('no progress for 60 s at ' + key);
      if (st.humanToAct) { await humanStep(page); lastAt = Date.now(); }
      await page.waitForTimeout(100);
    }
    if (o.errors.length) why = o.errors[0];
  } catch (e) { why = String(e.message).split('\n')[0] + (o.errors.length ? ' / ' + o.errors[0] : ''); }
  report('slow device: a whole deal with the processor throttled 4x and no workers', !why, why || 'deal took ' + Math.round((Date.now() - t0) / 1000) + ' s, longest wait for a bot ' + (worst / 1000).toFixed(1) + ' s');
  await o.ctx.close();
}

(async function () {
  const browser = await chromium.launch();
  const sections = { saves: sectionSaves, failures: sectionFailures, monkey: sectionMonkey, soak: sectionSoak, sizes: sectionSizes, slow: sectionSlow };
  for (const name of want) {
    if (!sections[name]) { console.log('unknown section ' + name); continue; }
    try { await sections[name](browser); } catch (e) { report(name + ' section', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' / ')); }
  }
  await browser.close();
  console.log(failed ? 'FAILED: ' + failed : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
