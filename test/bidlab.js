// Bidding laboratory: node test/bidlab.js [deals] [seed] [show]
// Runs bot-only auctions on random deals, checks legality/termination, and prints sample auctions.
const fs = require('fs');
const path = require('path');
const FILES = (process.env.BID_FILES || 'core.js,bid-eval.js,bid-open.js,bid-rebid.js,bid-comp.js,bid-natural.js,bidding.js').split(',');
const src = FILES.map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); }).join('\n;\n');
const E = new Function("'use strict';\n" + src + '\nreturn {Game,newDeal,mulberry32,callName,bidChooseCall,bidExplainAuction,handFeatures,cardSuit,cardRank,RANK_CH,auctionInfo,scoreContract,bidState};')();

const N = +(process.argv[2] || 2000), seed = +(process.argv[3] || 1), show = +(process.argv[4] || 0);
const rnd = E.mulberry32(seed);
function handStr(h) {
  const suits = [[], [], [], []];
  for (const c of h) suits[E.cardSuit(c)].push(E.RANK_CH[E.cardRank(c)]);
  return [3, 2, 1, 0].map(function (s) { return suits[s].join('') || '-'; }).join('.');
}
const stats = { passedOut: 0, long: 0, err: 0, contracts: {}, levels: [0, 0, 0, 0, 0, 0, 0, 0], doubled: 0 };
let shown = 0;
for (let t = 0; t < N; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  let guard = 0, bad = null;
  while (g.phase === 'auction') {
    let r;
    try { r = E.bidChooseCall(g.view(g.turn)); } catch (e) { bad = 'throw: ' + (e.stack || e); break; }
    if (!g.isLegalCall(r.call)) { bad = 'illegal ' + E.callName(r.call); break; }
    g.makeCall(r.call);
    if (++guard > 60) { bad = 'too long'; break; }
  }
  if (bad) {
    stats.err++;
    console.log('ERROR ' + bad + ' dealer ' + 'NESW'[g.dealer] + ' auction ' + g.calls.map(E.callName).join(' '));
    for (let s = 0; s < 4; s++) console.log('  ' + 'NESW'[s] + ' ' + handStr(g.hands[s]) + ' (' + E.handFeatures(g.hands[s]).hcp + ')');
    continue;
  }
  if (g.calls.length > 24) stats.long++;
  if (!g.contract) { stats.passedOut++; }
  else {
    const c = g.contract;
    stats.levels[c.level]++;
    if (c.doubled) stats.doubled++;
  }
  const FILTER = process.env.FILTER || '';
  const sideActs = [0, 0];
  g.calls.forEach(function (c, i) { if (c !== 0) sideActs[(g.dealer + i) & 1]++; });
  const keep = !FILTER || (FILTER === 'comp' && sideActs[0] && sideActs[1]) || (FILTER === 'slam' && g.contract && g.contract.level >= 6) ||
    (FILTER === 'five' && g.contract && g.contract.level === 5) || (FILTER === 'dbl' && g.contract && g.contract.doubled) ||
    (FILTER === 'long' && g.calls.length >= 14) ||
    (FILTER === 'lightgame' && g.contract && (function () {
      const c = g.contract, hc = g.hands.map(function (h) { return E.handFeatures(h).hcp; });
      const pts = (c.declarer & 1) === 0 ? hc[0] + hc[2] : hc[1] + hc[3];
      const game = c.level >= 5 || (c.level === 4 && c.strain >= 2) || (c.level >= 3 && c.strain === 4);
      return game && c.level < 6 && pts <= 21;
    })()) ||
    (FILTER === 'lightslam' && g.contract && (function () {
      const c = g.contract, hc = g.hands.map(function (h) { return E.handFeatures(h).hcp; });
      const pts = (c.declarer & 1) === 0 ? hc[0] + hc[2] : hc[1] + hc[3];
      return c.level >= 6 && pts <= 27;
    })());
  if (shown < show && keep) {
    shown++;
    const texts = E.bidExplainAuction(g.dealer, g.vul, g.calls);
    console.log('--- board ' + g.board + ' dealer ' + 'NESW'[g.dealer] + ' vul ' + ['none', 'NS', 'EW', 'both'][g.vul]);
    for (let s = 0; s < 4; s++) { const f = E.handFeatures(g.hands[s]); console.log('  ' + 'NESW'[s] + ' ' + handStr(g.hands[s]).padEnd(18) + ' ' + f.hcp + ' hcp'); }
    g.calls.forEach(function (c, i) { console.log('    ' + 'NESW'[(g.dealer + i) & 3] + ' ' + E.callName(c).padEnd(3) + ' ' + texts[i]); });
    if (g.contract) console.log('  => ' + g.contract.level + 'CDHSN'[g.contract.strain] + ['', 'X', 'XX'][g.contract.doubled] + ' by ' + 'NESW'[g.contract.declarer]);
  }
}
console.log(JSON.stringify(stats));
