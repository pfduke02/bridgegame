// Robustness: the bots under hostile conditions.   node test/robust/engine.js [deals=240] [seed=1]
// Any seat may be a "chaos" player (random legal calls and cards) or a "liar" (wild, misleading bids,
// then normal play). The bots must never throw, never fall back to their emergency choice, never make
// an illegal call or play, always finish, and stay within their time budget.
const load = require('../load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'aiRun', 'aiStartJob', 'legalCalls', 'callName', 'bidExplainAuction', 'cardSuit', 'cardRank',
  'mkCard', 'mkBid', 'ddSolve', 'scoreContract', 'seatVul', 'handFeatures', 'cardText']);
const N = +(process.argv[2] || 240), seed = +(process.argv[3] || 1);
const rnd = E.mulberry32(seed * 7919 + 13);
const ri = function (n) { return Math.floor(rnd() * n); };
let failed = 0;
const report = function (label, ok, detail) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); };
const problems = [];
const note = function (msg) { if (problems.length < 12) problems.push(msg); };

function chaosCall(g) {
  const legal = E.legalCalls(g.auction), p = rnd();
  if (p < 0.5) return 0;
  if (p < 0.9) return legal[Math.min(legal.length - 1, 1 + ri(8))];
  return legal[ri(legal.length)];
}
const WILD = ['2C', '2N', '1N', '3S', '4H', '4N', '5N', '2D', '3N', '1S', '6C', '7N'];
function liarCall(g, used) {
  const legal = E.legalCalls(g.auction);
  if (used >= 4 || rnd() < 0.3) return 0;
  if (rnd() < 0.3) { if (legal.indexOf(2) >= 0) return 2; if (legal.indexOf(1) >= 0) return 1; }
  const want = WILD.map(function (s) { return E.mkBid(+s[0], 'CDHSN'.indexOf(s[1])); }).filter(function (c) { return legal.indexOf(c) >= 0; });
  return want.length ? want[ri(Math.min(want.length, 5))] : 0;
}

const st = { deals: 0, passedOut: 0, botCalls: 0, botPlays: 0, errors: 0, illegal: 0, maxAuction: 0, maxFastMs: 0, maxMs: [0, 0, 0, 0], full: 0, explainBad: 0, unfinished: 0, kinds: { bot: 0, chaos: 0, liar: 0 } };
const t0 = Date.now();
for (let t = 0; t < N; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  const kind = [0, 1, 2, 3].map(function () { const p = rnd(); return p < 0.55 ? 'bot' : p < 0.8 ? 'chaos' : 'liar'; });
  kind.forEach(function (k) { st.kinds[k]++; });
  const full = rnd() < 0.15, level = 1 + ri(3);
  if (full) st.full++;
  const used = [0, 0, 0, 0];
  let guard = 0;
  try {
    while (g.phase === 'auction') {
      const seat = g.turn;
      let call;
      if (kind[seat] === 'bot') {
        const r = E.aiRun({ type: 'call', view: g.view(seat) });
        st.botCalls++;
        if (r.error) { st.errors++; note('call error: ' + String(r.error).split('\n')[0] + ' | ' + g.calls.map(E.callName).join(' ')); }
        call = r.call;
        if (!g.isLegalCall(call)) { st.illegal++; note('illegal call ' + E.callName(call) + ' | ' + g.calls.map(E.callName).join(' ')); call = 0; }
      } else if (kind[seat] === 'chaos') call = chaosCall(g);
      else { call = liarCall(g, used[seat]); if (call !== 0) used[seat]++; }
      g.makeCall(call);
      if (++guard > 150) throw new Error('auction did not end: ' + g.calls.map(E.callName).join(' '));
    }
    st.maxAuction = Math.max(st.maxAuction, g.calls.length);
    const texts = E.bidExplainAuction(g.dealer, g.vul, g.calls);
    if (texts.length !== g.calls.length || texts.some(function (x) { return typeof x !== 'string' || !x; })) st.explainBad++;
    if (!g.contract) { st.passedOut++; st.deals++; continue; }
    while (g.phase === 'play') {
      const actor = g.actor(), legal = g.legalCards();
      let card;
      if (kind[actor] === 'chaos') card = legal[ri(legal.length)];
      else {
        const view = g.view(actor);
        view.seed = (seed * 1000003 + t * 131 + g.plays.length) >>> 0;
        if (!full) view.rulesOnly = g.rem[g.turn].length > 9;
        const s0 = Date.now();
        const r = E.aiRun({ type: 'play', view: view, level: full ? level : 1 });
        const ms = Date.now() - s0;
        st.botPlays++;
        if (full) st.maxMs[level] = Math.max(st.maxMs[level], ms); else st.maxFastMs = Math.max(st.maxFastMs, ms);
        if (r.error) { st.errors++; note('play error: ' + String(r.error).split('\n')[0]); }
        card = r.card;
        if (legal.indexOf(card) < 0) { st.illegal++; note('illegal card ' + card); card = legal[0]; }
      }
      g.playCard(card);
    }
    if (g.phase !== 'over' || g.taken[0] + g.taken[1] !== 13) st.unfinished++;
    st.deals++;
  } catch (e) { st.errors++; note('exception: ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' / ')); }
}
problems.forEach(function (p) { console.log('   ' + p); });
report('chaos: ' + st.deals + ' of ' + N + ' deals finished (' + st.passedOut + ' passed out); seats were ' + JSON.stringify(st.kinds), st.deals === N && st.unfinished === 0);
report('chaos: ' + st.botCalls + ' bot calls and ' + st.botPlays + ' bot plays, none illegal, none needing the emergency fallback', st.errors === 0 && st.illegal === 0, 'errors ' + st.errors + ', illegal ' + st.illegal);
report('chaos: every call in every auction (longest ' + st.maxAuction + ' calls) has an explanation', st.explainBad === 0);
report('timing: slowest decision by strength level', st.maxMs[1] < 2500 && st.maxMs[2] < 4500 && st.maxMs[3] < 9000,
  'quick ' + st.maxMs[1] + ' ms, standard ' + st.maxMs[2] + ' ms, strong ' + st.maxMs[3] + ' ms over ' + st.full + ' fully analysed deals; late-play-only decisions ' + st.maxFastMs + ' ms');

// ---- extreme deals ----
function fromSuits(spec) {       // spec[seat] = array of 4 rank strings, spades first
  return spec.map(function (suits) {
    const h = [];
    suits.forEach(function (rs, i) { for (const ch of rs) h.push(E.mkCard(3 - i, '23456789TJQKA'.indexOf(ch))); });
    return h;
  });
}
function fillRest(fixed) {       // fixed: {seat: cards}; the rest dealt at random
  const usedC = new Set(); Object.keys(fixed).forEach(function (s) { fixed[s].forEach(function (c) { usedC.add(c); }); });
  const rest = []; for (let c = 0; c < 52; c++) if (!usedC.has(c)) rest.push(c);
  for (let i = rest.length - 1; i > 0; i--) { const j = ri(i + 1); const x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
  const hands = [[], [], [], []];
  for (let s = 0; s < 4; s++) { hands[s] = (fixed[s] || []).slice(); while (hands[s].length < 13) hands[s].push(rest.pop()); }
  return hands;
}
const ALL = '23456789TJQKA';
const extremes = [
  ['each player holds one whole suit', fromSuits([[ALL, '', '', ''], ['', ALL, '', ''], ['', '', ALL, ''], ['', '', '', ALL]])],
  ['North holds 37 points', fillRest({ 0: fromSuits([['AKQJ', 'AKQ', 'AKQ', 'AKQ']])[0] })],
  ['North and South hold no honours at all', fromSuits([['98765', '9876', '98', '98'], ['AKQJ', 'AKQ', 'AKQ', 'AKQ'], ['432', '5432', '765432', ''], ['T', 'JT', 'JT', 'JT765432']])],
  ['two-suited freaks', fromSuits([['AKQJT98', 'AKQJT9', '', ''], ['', '', 'AKQJT98', 'AKQJT9'], ['765432', '8765432', '', ''], ['', '', '765432', '8765432']])],
  ['thirteen clubs in one hand', fillRest({ 2: fromSuits([['', '', '', ALL]])[0] })],
  ['all four hands 4-3-3-3', fromSuits([['AJ73', 'K96', 'Q85', 'T42'], ['K962', 'Q85', 'T42', 'AJ7'], ['Q85', 'T42', 'AJ73', 'K96'], ['T4', 'AJ73', 'K96', 'Q853']])]
];
let exBad = 0, exRun = 0;
extremes.forEach(function (ex) {
  const hands = ex[1], seen = new Set();
  let valid = hands.length === 4;
  hands.forEach(function (h) { if (h.length !== 13) valid = false; h.forEach(function (c) { seen.add(c); }); });
  if (!valid || seen.size !== 52) { console.log('   (skipped, not a legal deal: ' + ex[0] + ' ' + hands.map(function (h) { return h.length; }).join('/') + ' ' + seen.size + ')'); exBad++; return; }
  for (let d = 0; d < 4; d++) {
    exRun++;
    try {
      const job = E.aiStartJob({ type: 'replay', deal: { board: 1 + d, dealer: d, vul: d, hands: hands }, level: 2, seed: 5 + d });
      let steps = 0;
      while (!job.step(200)) { if (++steps > 3000) throw new Error('did not finish'); }
      const r = job.result;
      const g = new E.Game({ board: 1 + d, dealer: d, vul: d, hands: hands, calls: r.calls, plays: r.plays });
      if (g.phase !== 'over') throw new Error('incomplete record');
      if (d === 0) console.log('   ' + ex[0] + ': ' + (r.contract ? r.contract.level + 'CDHSN'[r.contract.strain] + ['', 'X', 'XX'][r.contract.doubled] + ' by ' + 'NESW'[r.contract.declarer] + ', ' + r.declTricks + ' tricks' : 'passed out'));
      for (let strain = 0; strain < 5; strain++) { const hold = new Array(16).fill(0); hands.forEach(function (h, s) { h.forEach(function (c) { hold[s * 4 + E.cardSuit(c)] |= 1 << E.cardRank(c); }); }); const v = E.ddSolve(hold, strain, d, 3000000); if (v < -1 || v > 13) throw new Error('solver value out of range'); }
    } catch (e) { exBad++; console.log('   ' + ex[0] + ' (dealer ' + 'NESW'[d] + '): ' + String(e && e.message || e)); }
  }
});
report('extreme deals: ' + exRun + ' runs of ' + extremes.length + ' freak layouts bid, played and solved without error', exBad === 0);

// ---- a whole deal in 10 ms slices (what a page without worker support does) ----
{
  let worst = 0, total = 0, bad = 0;
  for (let t = 0; t < 6; t++) {
    const deal = E.newDeal(1 + t, rnd), job = E.aiStartJob({ type: 'replay', deal: deal, level: 2, seed: 77 + t });
    const s0 = Date.now();
    for (;;) { const a = Date.now(); const done = job.step(10); worst = Math.max(worst, Date.now() - a); if (done) break; }
    total += Date.now() - s0;
    try { const g = new E.Game({ board: deal.board, dealer: deal.dealer, vul: deal.vul, hands: deal.hands, calls: job.result.calls, plays: job.result.plays }); if (g.phase !== 'over') bad++; } catch (e) { bad++; }
  }
  report('sliced replay: 6 deals by four bots in 10 ms slices give complete legal records', bad === 0, 'average ' + Math.round(total / 6) + ' ms per deal, longest single slice ' + worst + ' ms');
}
const mem = process.memoryUsage();
console.log('memory: heap ' + Math.round(mem.heapUsed / 1048576) + ' MB, typed arrays ' + Math.round(mem.arrayBuffers / 1048576) + ' MB after ' + Math.round((Date.now() - t0) / 1000) + ' s');
console.log(failed ? 'FAILED: ' + failed : 'ALL PASSED');
process.exit(failed ? 1 : 0);
