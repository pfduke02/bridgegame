// Card-play laboratory: node test/playlab.js [deals] [seed] [level] [verbose]
// Four bots bid and play whole deals. Checks legality, times every decision, and compares the
// result with the double-dummy value of the final contract.
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'callName', 'cardText', 'aiRun', 'bidChooseCall', 'playStartJob', 'ddSolve', 'ddSolveBoard',
  'cardSuit', 'cardRank', 'handFeatures', 'RANK_CH', 'scoreContract', 'seatVul']);
const N = +(process.argv[2] || 20), seed = +(process.argv[3] || 1), level = +(process.argv[4] || 2), verbose = +(process.argv[5] || 0);
const rnd = E.mulberry32(seed);
function holdOf(hands) { const h = new Array(16).fill(0); for (let s = 0; s < 4; s++) for (const c of hands[s]) h[s * 4 + E.cardSuit(c)] |= 1 << E.cardRank(c); return h; }
function handStr(h) { const su = [[], [], [], []]; for (const c of h) su[E.cardSuit(c)].push(E.RANK_CH[E.cardRank(c)]); return [3, 2, 1, 0].map(function (s) { return su[s].join('') || '-'; }).join('.'); }
let deals = 0, sumDiff = 0, absDiff = 0, maxMs = 0, totMs = 0, decisions = 0, errors = 0, made = 0, ddMade = 0, slow = 0;
const byTrick = new Array(13).fill(0), cntTrick = new Array(13).fill(0), maxTrick = new Array(13).fill(0);
const diffHist = {};
for (let t = 0; t < N; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  while (g.phase === 'auction') g.makeCall(E.bidChooseCall(g.view(g.turn)).call);
  if (!g.contract) continue;
  const dd = 13 - E.ddSolve(holdOf(g.hands), g.contract.strain, (g.declarer + 1) & 3);
  const log = [];
  while (g.phase === 'play') {
    const view = g.view(g.actor());
    view.seed = (seed * 7919 + g.plays.length * 104729 + t * 31) >>> 0;
    const t0 = Date.now();
    const r = E.aiRun({ type: 'play', view: view, level: level });
    const ms = Date.now() - t0;
    if (r.error) { errors++; console.log('ERROR in play:', r.error); }
    const k = g.tricks.length;
    byTrick[k] += ms; cntTrick[k]++; if (ms > maxTrick[k]) maxTrick[k] = ms;
    totMs += ms; decisions++; if (ms > maxMs) maxMs = ms; if (ms > 4000) slow++;
    if (g.legalCards().indexOf(r.card) < 0) { errors++; console.log('ILLEGAL card', r.card); break; }
    log.push('NESW'[g.turn] + E.cardText(r.card) + (r.how && r.how !== 'rule' ? '[' + r.how[0] + r.samples + ']' : r.how === 'rule' && g.legalCards().length > 1 ? '[r]' : ''));
    g.playCard(r.card);
  }
  if (g.phase !== 'over') continue;
  deals++;
  const got = g.result.declTricks, d = got - dd;
  sumDiff += d; absDiff += Math.abs(d); diffHist[d] = (diffHist[d] || 0) + 1;
  if (g.result.made >= 0) made++;
  if (dd >= g.contract.level + 6) ddMade++;
  if (verbose || Math.abs(d) >= (+process.env.TRACE || 99)) {
    console.log('board ' + g.board + ': ' + g.calls.map(E.callName).join(' '));
    for (let s = 0; s < 4; s++) console.log('   ' + 'NESW'[s] + ' ' + handStr(g.hands[s]));
    for (let k = 0; k < log.length; k += 4) console.log('     ' + (k / 4 + 1 + '. ').padStart(4) + log.slice(k, k + 4).join(' '));
    console.log('   ' + g.contract.level + 'CDHSN'[g.contract.strain] + ['', 'X', 'XX'][g.contract.doubled] + ' by ' + 'NESW'[g.declarer] + ': took ' + got + ', double-dummy ' + dd + ', score NS ' + g.result.nsScore);
  }
}
console.log('deals played ' + deals + ', errors ' + errors);
console.log('declarer tricks minus double-dummy: mean ' + (sumDiff / deals).toFixed(2) + ', mean abs ' + (absDiff / deals).toFixed(2) + ', hist ' + JSON.stringify(diffHist));
console.log('contracts made ' + made + ' (double-dummy makeable ' + ddMade + ') of ' + deals);
console.log('decision time: avg ' + (totMs / decisions).toFixed(0) + ' ms, max ' + maxMs + ' ms, over 4s: ' + slow);
console.log('avg ms by trick: ' + byTrick.map(function (v, i) { return cntTrick[i] ? Math.round(v / cntTrick[i]) : 0; }).join(' '));
console.log('max ms by trick: ' + maxTrick.join(' '));
