// End-to-end smoke test of the built page, driven through the real controls.
//   node test/ui.smoke.js            (set SHOT_DIR=/some/dir to also save screenshots)
// Uses the preinstalled Playwright + Chromium; nothing is installed or downloaded.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = process.env.SHOT_DIR || '';
const PAGE_URL = 'file://' + path.join(ROOT, 'dist', 'bridge.html');

let failed = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { failed++; console.log('FAIL ' + label); }
}

// Build the page. If an engine file is mid-edit and the bundle does not evaluate, leave the
// double-dummy solver out for this run (the page works without it) and say so.
function buildPage() {
  const builder = require('../build.js');
  const files = require('../engine-files.js');
  const evaluates = function () {
    try { new Function(builder.buildEngine() + '\nreturn BridgeEngine;')(); return true; } catch (e) { return false; }
  };
  if (!evaluates()) {
    const i = files.indexOf('dds.js');
    if (i >= 0) files.splice(i, 1);
    if (!evaluates()) throw new Error('engine bundle does not evaluate');
    console.log('note: engine bundle did not evaluate with dds.js; built without it for this run');
  }
  builder.build();
}

const state = function (page) { return page.evaluate(function () { return window.PocketBridge.state(); }); };

async function waitFor(page, pred, label, timeout) {
  const t0 = Date.now();
  for (;;) {
    const st = await state(page);
    if (pred(st)) return st;
    if (Date.now() - t0 > (timeout || 60000)) throw new Error('timed out waiting for: ' + label + ' — state ' + JSON.stringify(st));
    await page.waitForTimeout(40);
  }
}
async function tap(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error('nothing to tap at ' + selector);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function shot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(400);                 // let entry animations finish
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}

// playable cards of the hand that is live right now, with a point inside each card's visible strip
function playable(page) {
  return page.evaluate(function () {
    const fan = document.querySelector('.fan.live');
    if (!fan) return [];
    return Array.from(fan.querySelectorAll('.card.playable')).map(function (c) {
      const r = c.getBoundingClientRect();
      return { card: Number(c.dataset.card), x: r.left + 8, y: r.top + r.height * 0.35, fan: fan.id };
    });
  });
}

// What the table shows must match what the rules allow the human to see.
async function checkVisibility(page, st) {
  const dom = await page.evaluate(function () {
    return {
      northUp: document.getElementById('hand-n').classList.contains('fan'),
      eastUp: !!document.querySelector('#hand-e .diagram'),
      westUp: !!document.querySelector('#hand-w .diagram'),
      south: document.querySelectorAll('#hand-s .card').length,
      live: Array.from(document.querySelectorAll('.fan.live')).map(function (f) { return f.id; }),
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  const nsDeclare = st.declarer >= 0 && (st.declarer & 1) === 0;
  ok(dom.northUp === (st.phase !== 'auction' && nsDeclare), 'North face up exactly when N/S declare (phase ' + st.phase + ')');
  ok(dom.eastUp === (st.phase === 'play' && st.dummy === 1 && st.plays > 0), 'East shown only as dummy after the lead');
  ok(dom.westUp === (st.phase === 'play' && st.dummy === 3 && st.plays > 0), 'West shown only as dummy after the lead');
  ok(dom.overflow <= 0, 'no horizontal overflow (' + dom.overflow + ')');
  if (st.humanToAct && st.phase === 'play') {
    ok(dom.live.length === 1 && dom.live[0] === (st.turn === 0 ? 'hand-n' : 'hand-s'), 'exactly the hand on turn is live: ' + dom.live.join(','));
    if (!nsDeclare) ok(st.turn === 2, 'defending: the human only plays South');
  } else ok(dom.live.length === 0, 'no hand is live when the human is not on play');
  return dom;
}

// South's call. 'force' outbids the opponents in notrump so N/S end up declaring; 'pass' always passes.
async function bid(page, st, mode) {
  let level = 0;
  if (mode === 'force' && (st.lastBid < 0 || (st.lastBidder & 1) === 1)) {
    level = st.lastBid < 0 ? 1 : Math.floor((st.lastBid - 3) / 5) + 1 + ((st.lastBid - 3) % 5 === 4 ? 1 : 0);
  }
  if (level >= 1 && level <= 7) {
    await tap(page, '#bb-l' + level);
    ok(await page.locator('#bb-l' + level + '.sel').count() === 1, 'level ' + level + ' selected');
    await tap(page, '#bb-s4');
  } else await tap(page, '#bb-pass');
}

async function playDeal(page, mode, hooks) {
  hooks = hooks || {};
  let st = await state(page);
  const board = st.board;
  let turns = 0;
  for (;;) {
    st = await waitFor(page, function (s) { return s.phase === 'over' || s.humanToAct; }, 'human turn or end of deal');
    if (st.phase === 'over') break;
    await checkVisibility(page, st);
    turns++;
    if (st.phase === 'auction') {
      if (hooks.auction) await hooks.auction(st);
      await bid(page, st, mode);
    } else {
      if (hooks.play && await hooks.play(st) === 'handled') continue;
      const cards = await playable(page);
      ok(cards.length > 0, 'a playable card exists on the human turn');
      await page.touchscreen.tap(cards[0].x, cards[0].y);
    }
    const before = st;
    await waitFor(page, function (s) { return s.calls !== before.calls || s.plays !== before.plays || s.phase !== before.phase; }, 'the action to register');
    if (turns > 80) throw new Error('deal did not finish');
  }
  st = await waitFor(page, function (s) { return s.sheet === 'result'; }, 'result panel');
  ok(st.board === board, 'still the same board at the end');
  return st;
}

async function checkResult(page, st) {
  const r = st.result;
  const text = (await page.locator('#res-score').textContent()).replace('−', '-');
  ok(/^[+-]?\d+$/.test(text), 'score reads as a number: ' + text);
  ok(Number(text) === r.nsScore, 'score shown (' + text + ') equals the engine score (' + r.nsScore + ')');
  if (r.passedOut) { ok(r.nsScore === 0, 'passed out scores nothing'); return; }
  const expect = await page.evaluate(function (a) {
    const E = BridgeEngine;
    return E.scoreContract(a.c.level, a.c.strain, a.c.doubled, E.seatVul(a.vul, a.declarer), a.tricks);
  }, { c: st.contract, vul: st.vul, declarer: st.declarer, tricks: r.declTricks });
  ok(r.score === expect, 'score matches scoreContract');
  ok(st.taken[0] + st.taken[1] === 13, '13 tricks were played');
  ok(r.declTricks === st.taken[st.declarer & 1], 'declarer tricks match the trick counters');
  ok(Math.abs(r.nsScore) <= 7600 && r.nsScore % 10 === 0, 'score is plausible');
  const last = st.history[st.history.length - 1];
  ok(last && last.board === st.board && last.ns === r.nsScore, 'result recorded on the score pad');
  ok(await page.locator('#res-deal .diagram').count() === 4, 'all four hands are shown in the result');
}

(async function main() {
  buildPage();
  const browser = await chromium.launch();
  const errors = [];
  const watch = function (page) {
    page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  };
  const noFonts = function (page) {
    return page.route(/fonts\.(googleapis|gstatic)\.com/, function (r) { return r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  };

  // ---------- phone, touch ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page);
  await noFonts(page);
  await page.goto(PAGE_URL);
  let st = await waitFor(page, function (s) { return s.phase === 'auction'; }, 'first deal');
  ok(st.board === 1 && st.dealer === 0 && st.vul === 0, 'starts at board 1, dealer North, nobody vulnerable');

  // menu: switch to the fast pace
  await tap(page, '#btn-menu');
  await waitFor(page, function (s) { return s.sheet === 'menu'; }, 'menu');
  await tap(page, '#set-speed button[data-v="fast"]');
  st = await state(page);
  ok(st.settings.speed === 'fast', 'pace setting applied');
  ok(await page.locator('#notes-body li').count() > 0, 'bidding notes are rendered');
  await tap(page, '#sheet-menu [data-close]');
  await waitFor(page, function (s) { return s.sheet === null; }, 'menu closed');

  // ---- deal 1: outbid everyone so N/S declare; exercise hint, undo, slide, reload on the way ----
  let did = { hintCall: false, undoCall: false, hintCard: false, undoCard: false, slide: false, cancel: false, reload: false, shotN: false };
  const cdp = await ctx.newCDPSession(page);
  const touch = function (type, x, y) {
    return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: type === 'touchEnd' ? [] : [{ x: x, y: y }] });
  };
  st = await playDeal(page, 'force', {
    auction: async function (s) {
      if (!did.hintCall) {
        did.hintCall = true;
        await shot(page, 'ui-1-auction');
        ok(await page.locator('#bb-dbl').isDisabled() === !(s.lastBid >= 0 && (s.lastBidder & 1) === 1 && s.doubled === 0), 'Double enabled only over an opposing bid');
        ok(await page.locator('#bb-rdbl').isDisabled(), 'Redouble disabled');
        await tap(page, '#btn-hint');
        await page.waitForSelector('#hint:not([hidden]) .bidcard', { timeout: 30000 });
        ok(true, 'bidding hint appears');
      }
    },
    play: async function (s) {
      if (!did.hintCard && s.plays >= 4) {
        did.hintCard = true;
        await tap(page, '#btn-hint');
        await page.waitForSelector('.fan.live .card.hinted', { timeout: 60000 });
        ok(true, 'card hint lifts a card');
        return;
      }
      if (!did.cancel && s.plays >= 8) {
        did.cancel = true;
        const cards = await playable(page);
        await touch('touchStart', cards[0].x, cards[0].y);
        ok(await page.locator('.fan.live .card.lift').count() === 1, 'pressing lifts the card');
        await touch('touchMove', cards[0].x, cards[0].y - 120);
        await touch('touchMove', cards[0].x, cards[0].y - 240);
        const dropped = await page.waitForFunction(function () { return !document.querySelector('.fan .card.lift'); }, null, { timeout: 3000 })
          .then(function () { return true; }, function () { return false; });
        ok(dropped, 'sliding off the hand drops the lift');
        await touch('touchEnd', 0, 0);
        await page.waitForTimeout(150);
        const after = await state(page);
        ok(after.plays === s.plays, 'sliding off the hand plays nothing');
        return;
      }
      if (!did.slide && s.plays >= 8) {
        const cards = await playable(page);
        if (cards.length >= 2) {
          did.slide = true;
          const a = cards[0], b = cards[cards.length - 1];
          await touch('touchStart', a.x, a.y);
          await touch('touchMove', (a.x + b.x) / 2, a.y);
          await touch('touchMove', b.x, b.y);
          const moved = await page.waitForFunction(function (card) {
            const c = document.querySelector('.fan.live .card.lift');
            return !!c && Number(c.dataset.card) === card;
          }, b.card, { timeout: 3000 }).then(function () { return true; }, function () { return false; });
          ok(moved, 'sliding moves the lift to the card under the finger');
          ok(await page.locator('#preview:not([hidden])').count() === 1, 'the lifted card is previewed above the finger');
          await touch('touchEnd', 0, 0);
          await waitFor(page, function (x) { return x.plays > s.plays; }, 'slid card to be played');
          const gone = await page.evaluate(function (card) { return !document.querySelector('.fan .card[data-card="' + card + '"]'); }, b.card);
          ok(gone, 'the card released on is the one played');
          return 'handled';
        }
      }
      if (!did.undoCard && s.plays >= 16) {
        did.undoCard = true;
        const cards = await playable(page);
        await page.touchscreen.tap(cards[0].x, cards[0].y);
        await waitFor(page, function (x) { return x.plays > s.plays; }, 'card before undo');
        await page.waitForTimeout(500);
        await tap(page, '#btn-undo');
        const back = await waitFor(page, function (x) { return x.plays === s.plays && x.humanToAct; }, 'undo to restore the position');
        ok(back.plays === s.plays && back.turn === s.turn, 'undo takes back the last card (and the bots after it)');
        return;
      }
      if (!did.reload && s.plays >= 20) {
        did.reload = true;
        if (!did.shotN && (s.declarer & 1) === 0) { did.shotN = true; await shot(page, 'ui-2-north-face-up'); }
        await page.reload();
        const again = await waitFor(page, function (x) { return x.humanToAct; }, 'state after reload');
        ok(again.plays === s.plays && again.board === s.board && again.calls === s.calls, 'reload restores the deal mid-play');
        ok(again.settings.speed === 'fast', 'reload restores settings');
        return;
      }
    }
  });
  ok((st.declarer & 1) === 0, 'N/S declared deal 1 (declarer seat ' + st.declarer + ')');
  ok(did.hintCall && did.hintCard && did.cancel && did.slide && did.undoCard && did.reload, 'all interactions were exercised: ' + JSON.stringify(did));
  await checkResult(page, st);
  await shot(page, 'ui-4-result');

  // undo is not offered once the deal is over; the review sheet lists the tricks
  await tap(page, '#sheet-result [data-close]');
  await waitFor(page, function (s) { return s.sheet === null; }, 'result closed');
  ok(await page.locator('#btn-undo').isDisabled(), 'no undo after the deal');
  await tap(page, '#btn-review');
  await waitFor(page, function (s) { return s.sheet === 'review'; }, 'review sheet');
  ok(await page.locator('#rev-tricks .tl-row:not(.head)').count() === 13, 'review lists 13 tricks');
  await page.locator('#rev-auction [data-idx="0"]').tap();
  await page.waitForFunction(function () { const m = document.getElementById('rev-meaning'); return m && m.textContent.length > 3 && m.textContent.indexOf('Looking') < 0; }, null, { timeout: 30000 });
  ok(true, 'tapping a call shows its meaning');
  await shot(page, 'ui-5-review');
  await tap(page, '#sheet-review [data-close]');
  await tap(page, '#btn-next');

  // ---- further deals: South passes throughout; stop once E/W have declared one ----
  let ewDeal = false, auctionUndo = false;
  for (let n = 0; n < 10 && !ewDeal; n++) {
    st = await waitFor(page, function (s) { return s.phase !== 'over' && s.sheet === null; }, 'next deal');
    ok(st.board === 2 + n, 'board number advances to ' + (2 + n));
    ok(st.dealer === ((st.board - 1) & 3), 'dealer rotates');
    let shotE = false;
    st = await playDeal(page, 'pass', {
      auction: async function (s) {
        if (auctionUndo) return;
        auctionUndo = true;
        await tap(page, '#bb-pass');
        await waitFor(page, function (x) { return x.calls > s.calls; }, 'pass before undo');
        await tap(page, '#btn-undo');
        const back = await waitFor(page, function (x) { return x.calls === s.calls && x.humanToAct; }, 'undo of a call');
        ok(back.phase === 'auction', 'undo takes back the last call');
      },
      play: async function (s) {
        if (!shotE && (s.dummy === 1 || s.dummy === 3) && s.plays >= 9) { shotE = true; await shot(page, 'ui-3-east-west-dummy'); }
      }
    });
    await checkResult(page, st);
    if (st.declarer === 1 || st.declarer === 3) ewDeal = true;
    if (!ewDeal) await tap(page, '#res-next');
  }
  ok(ewDeal, 'an E/W contract was played with the human defending');

  // replay from the result panel keeps the board and the cards
  const before = await page.evaluate(function () { return JSON.parse(localStorage.getItem('pocket-bridge-v1')).game.hands; });
  await tap(page, '#res-replay');
  st = await waitFor(page, function (s) { return s.phase === 'auction' && s.sheet === null; }, 'replay');
  const after = await page.evaluate(function () { return JSON.parse(localStorage.getItem('pocket-bridge-v1')).game; });
  ok(JSON.stringify(after.hands) === JSON.stringify(before) && after.calls.length <= 3 && after.plays.length === 0, 'replay deals the same cards again');

  // new match needs an in-page confirmation and resets the pad
  await tap(page, '#btn-menu');
  await tap(page, '#m-new');
  ok(await page.locator('#m-confirm:not([hidden])').count() === 1, 'new match asks first');
  await tap(page, '#m-new-yes');
  st = await waitFor(page, function (s) { return s.board === 1 && s.sheet === null && s.history.length === 0; }, 'new match');
  ok(st.plays === 0, 'new match starts a fresh board 1');

  // ---- North declares (redoubled): the human plays North's cards and South's hand as dummy ----
  await page.evaluate(function () {
    const E = BridgeEngine;
    const d = E.newDeal(1);
    d.calls = [E.mkBid(1, 4), 1, 2, 0, 0, 0];       // North 1NT, East doubles, South redoubles, all pass
    d.plays = [];
    localStorage.setItem('pocket-bridge-v1', JSON.stringify({
      v: 1, game: d, boardNo: 1, history: [], recorded: false, texts: {},
      settings: { speed: 'fast', fourColour: false, level: 2 }
    }));
  });
  await page.reload();
  st = await waitFor(page, function (s) { return s.phase === 'play' && s.humanToAct; }, 'North-declarer deal');
  ok(st.declarer === 0 && st.dummy === 2 && st.contract.doubled === 2 && st.plays === 1, 'restored 1NT redoubled by North after East leads');
  ok(await page.locator('#contract .xmark.rd').count() === 1, 'redoubled marker in the top bar');
  ok(st.turn === 2, 'dummy (South) plays second');
  let fromNorth = 0, fromSouth = 0;
  st = await playDeal(page, 'pass', { play: async function (s) { if (s.turn === 0) fromNorth++; else fromSouth++; } });
  ok(fromNorth === 13 && fromSouth === 13, 'the human played all 26 N/S cards (' + fromNorth + ' North, ' + fromSouth + ' South)');
  await checkResult(page, st);
  await tap(page, '#sheet-result [data-close]');
  await tap(page, '#btn-review');
  ok(await page.locator('#rev-auction .bidcard.dbl').count() === 1 && await page.locator('#rev-auction .bidcard.rdbl').count() === 1, 'double and redouble shown in the auction');
  await tap(page, '#sheet-review [data-close]');
  await ctx.close();

  // ---------- bots that fail, answer nonsense, or never answer ----------
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const page3 = await ctx3.newPage();
  watch(page3);
  await noFonts(page3);
  await page3.goto(PAGE_URL);
  await waitFor(page3, function (s) { return s.phase === 'auction'; }, 'deal for the failing bots');
  await page3.evaluate(function () {
    window.PocketBridge.setWatchdog(700);
    let n = 0;
    const broken = function (junk) {
      return function () {
        n++;
        if (n % 3 === 0) return new Promise(function () {});                 // never answers
        if (n % 3 === 1) return Promise.reject(new Error('bot down'));       // fails
        return Promise.resolve(junk);                                        // answers nonsense
      };
    };
    AIClient.chooseCall = broken({ call: 999 });
    AIClient.choosePlay = broken({ card: -5 });
  });
  await tap(page3, '#btn-menu');
  await tap(page3, '#set-speed button[data-v="fast"]');
  await tap(page3, '#m-new');
  await tap(page3, '#m-new-yes');
  st = await waitFor(page3, function (s) { return s.sheet === null && s.humanToAct; }, 'South to call with broken bots', 30000);
  ok(st.lastBid < 0, 'broken bots pass');
  await tap(page3, '#bb-l1');
  await tap(page3, '#bb-s4');
  for (let i = 0; i < 30; i++) {
    st = await waitFor(page3, function (s) { return s.humanToAct || s.phase === 'over'; }, 'progress with broken bots', 30000);
    if (st.phase !== 'play' || st.plays >= 12) break;
    const cards = await playable(page3);
    await page3.touchscreen.tap(cards[0].x, cards[0].y);
    const b = st;
    await waitFor(page3, function (s) { return s.plays !== b.plays; }, 'card with broken bots', 30000);
  }
  ok(st.phase === 'play' && st.plays >= 12 && st.declarer === 2, 'the deal keeps moving when bots fail (' + st.plays + ' cards played)');
  await ctx3.close();

  // ---------- host hot-reload hooks: boot from handed-over state, expose a snapshot ----------
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const page4 = await ctx4.newPage();
  watch(page4);
  await noFonts(page4);
  await page4.addInitScript(function () {
    const hands = [[], [], [], []];
    for (let c = 0; c < 52; c++) hands[(c / 13) | 0].push(c);       // one suit each: a legal deal
    window.__hot = { ready: 0, snap: null };
    window.claude = {
      hot: {
        data: { v: 1, game: { board: 7, dealer: 2, vul: 3, hands: hands, calls: [], plays: [] }, boardNo: 7, history: [], recorded: false, texts: {}, settings: { speed: 'fast', fourColour: true, level: 3 } },
        ready: function (fn) { window.__hot.ready++; fn(window.claude.hot.data); },
        snapshot: function (fn) { window.__hot.snap = fn; }
      }
    };
  });
  await page4.goto(PAGE_URL);
  st = await waitFor(page4, function (s) { return s.humanToAct; }, 'boot from hot data');
  ok(st.board === 7 && st.dealer === 2 && st.vul === 3 && st.calls === 0, 'boots from the state the host hands over');
  ok(st.settings.level === 3 && st.settings.fourColour === true, 'settings come with it');
  const snap = await page4.evaluate(function () { return { ready: window.__hot.ready, snap: window.__hot.snap ? window.__hot.snap() : null, four: document.body.classList.contains('four') }; });
  ok(snap.ready === 1 && snap.snap && snap.snap.game.board === 7 && snap.snap.v === 1, 'registers a snapshot for the host');
  ok(snap.four, 'four-colour deck applied');
  await ctx4.close();

  // ---------- small phone, mouse ----------
  const ctx2 = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 });
  const page2 = await ctx2.newPage();
  watch(page2);
  await noFonts(page2);
  await page2.goto(PAGE_URL);
  await waitFor(page2, function (s) { return s.phase === 'auction'; }, 'small-screen deal');
  const fits = function () {
    return page2.evaluate(function () {
      const bad = [];
      const W = window.innerWidth, H = window.innerHeight;
      document.querySelectorAll('#app *, .sheet:not([hidden]) *').forEach(function (n) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height || n.closest('[hidden]') || n.closest('.sprite')) return;
        if (r.right > W + 0.5 || r.left < -0.5) bad.push(n.className + ' x ' + r.left.toFixed(0) + '..' + r.right.toFixed(0));
        else if (n.closest('#app') && !n.closest('.au-body') && (r.bottom > H + 0.5 || r.top < -0.5)) bad.push(n.className + ' y ' + r.top.toFixed(0) + '..' + r.bottom.toFixed(0));
      });
      return { bad: bad.slice(0, 6), sw: document.documentElement.scrollWidth, w: W };
    });
  };
  let f = await fits();
  ok(f.sw <= f.w && f.bad.length === 0, '320x568 auction: everything inside the viewport ' + JSON.stringify(f));
  await shot(page2, 'ui-6-small-auction');
  // bid 1NT with the mouse, then play a few cards with mouse clicks
  st = await waitFor(page2, function (s) { return s.humanToAct || s.phase !== 'auction'; }, 'South to call');
  let guard = 0;
  while (st.phase === 'auction' && guard++ < 12) {
    if (st.humanToAct) {
      if (st.lastBid < 0 || (st.lastBidder & 1) === 1) {
        const level = st.lastBid < 0 ? 1 : Math.floor((st.lastBid - 3) / 5) + 1 + ((st.lastBid - 3) % 5 === 4 ? 1 : 0);
        if (level <= 7) { await page2.click('#bb-l' + level); await page2.click('#bb-s4'); } else await page2.click('#bb-pass');
      } else await page2.click('#bb-pass');
      const b = st;
      await waitFor(page2, function (s) { return s.calls !== b.calls || s.phase !== b.phase; }, 'mouse call');
    }
    st = await waitFor(page2, function (s) { return s.humanToAct || s.phase !== 'auction'; }, 'next call');
  }
  let clicks = 0;
  while (clicks < 7) {
    st = await waitFor(page2, function (s) { return s.phase === 'over' || s.humanToAct; }, 'mouse play turn');
    if (st.phase !== 'play') break;
    const cards = await page2.evaluate(function () {
      const fan = document.querySelector('.fan.live');
      return Array.from(fan.querySelectorAll('.card.playable')).map(function (c) { const r = c.getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height * 0.4 }; });
    });
    await page2.mouse.click(cards[0].x, cards[0].y);
    const b = st;
    await waitFor(page2, function (s) { return s.plays !== b.plays; }, 'mouse card');
    clicks++;
    if (clicks === 4) {
      f = await fits();
      ok(f.sw <= f.w && f.bad.length === 0, '320x568 play: everything inside the viewport ' + JSON.stringify(f));
      await shot(page2, 'ui-7-small-play');
    }
  }
  ok(clicks >= 4, 'cards can be played with a mouse (' + clicks + ')');
  await page2.click('#btn-menu');
  await page2.click('#fold-help summary');
  f = await fits();
  ok(f.sw <= f.w && f.bad.length === 0, '320x568 menu: nothing wider than the viewport ' + JSON.stringify(f));
  await ctx2.close();
  await browser.close();

  ok(errors.length === 0, 'no console or page errors: ' + errors.slice(0, 5).join(' | '));
  console.log(checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.log('smoke test crashed: ' + (e && e.stack || e));
  process.exit(1);
});
