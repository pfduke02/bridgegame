// Rules and scoring tests: node test/core.test.js
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'dealCards', 'auctionInfo', 'isLegalCall', 'legalCalls', 'parseCall', 'callName',
  'scoreContract', 'trickWinner', 'mkCard', 'cardSuit', 'cardRank', 'mulberry32', 'boardDealer', 'boardVul',
  'publicPlayState', 'PASS', 'DBL', 'RDBL', 'mkBid', 'NT', 'seatVul']);

let failed = 0, checks = 0;
function eq(actual, expected, label) {
  checks++;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { failed++; console.log('FAIL ' + label + ': got ' + a + ', expected ' + b); }
}
const C = 0, D = 1, H = 2, S = 3, N = 4;
const calls = function (str) { return str.split(/\s+/).filter(Boolean).map(E.parseCall); };

// ---- scoring: made contracts (level, strain, doubled, vul, tricks) ----
eq(E.scoreContract(3, N, 0, false, 9), 400, '3NT= nv');
eq(E.scoreContract(3, N, 0, true, 9), 600, '3NT= vul');
eq(E.scoreContract(3, N, 0, false, 10), 430, '3NT+1 nv');
eq(E.scoreContract(4, S, 0, false, 10), 420, '4S= nv');
eq(E.scoreContract(4, H, 0, true, 11), 650, '4H+1 vul');
eq(E.scoreContract(5, C, 0, false, 11), 400, '5C= nv');
eq(E.scoreContract(5, D, 0, true, 12), 620, '5D+1 vul');
eq(E.scoreContract(2, C, 0, false, 8), 90, '2C=');
eq(E.scoreContract(1, N, 0, false, 7), 90, '1NT=');
eq(E.scoreContract(1, N, 0, true, 9), 150, '1NT+2');
eq(E.scoreContract(2, S, 0, true, 10), 170, '2S+2');
eq(E.scoreContract(3, D, 0, false, 9), 110, '3D=');
eq(E.scoreContract(6, N, 0, true, 12), 1440, '6NT= vul');
eq(E.scoreContract(6, S, 0, false, 12), 980, '6S= nv');
eq(E.scoreContract(6, C, 0, false, 13), 940, '6C+1 nv');
eq(E.scoreContract(7, N, 0, false, 13), 1520, '7NT= nv');
eq(E.scoreContract(7, H, 0, true, 13), 2210, '7H= vul');
eq(E.scoreContract(4, H, 1, false, 10), 590, '4HX= nv');
eq(E.scoreContract(4, H, 1, true, 10), 790, '4HX= vul');
eq(E.scoreContract(2, S, 1, false, 8), 470, '2SX= nv (doubled into game)');
eq(E.scoreContract(2, D, 1, false, 8), 180, '2DX= nv (still a part-score)');
eq(E.scoreContract(2, H, 1, true, 9), 870, '2HX+1 vul');
eq(E.scoreContract(1, N, 2, true, 7), 760, '1NTXX= vul');
eq(E.scoreContract(1, N, 2, false, 8), 760, '1NTXX+1 nv');
eq(E.scoreContract(3, N, 1, false, 11), 750, '3NTX+2 nv');
eq(E.scoreContract(1, C, 1, false, 7), 140, '1CX=');
eq(E.scoreContract(1, C, 2, false, 7), 230, '1CXX=');
eq(E.scoreContract(5, C, 2, true, 11), 1000, '5CXX= vul');
eq(E.scoreContract(6, S, 1, true, 12), 1660, '6SX= vul');
// ---- scoring: undertricks ----
eq(E.scoreContract(4, S, 0, false, 9), -50, 'down 1 nv');
eq(E.scoreContract(4, S, 0, true, 7), -300, 'down 3 vul');
eq(E.scoreContract(4, S, 1, false, 9), -100, 'X down 1 nv');
eq(E.scoreContract(4, S, 1, false, 8), -300, 'X down 2 nv');
eq(E.scoreContract(4, S, 1, false, 7), -500, 'X down 3 nv');
eq(E.scoreContract(4, S, 1, false, 6), -800, 'X down 4 nv');
eq(E.scoreContract(4, S, 1, false, 5), -1100, 'X down 5 nv');
eq(E.scoreContract(4, S, 1, true, 9), -200, 'X down 1 vul');
eq(E.scoreContract(4, S, 1, true, 8), -500, 'X down 2 vul');
eq(E.scoreContract(4, S, 1, true, 7), -800, 'X down 3 vul');
eq(E.scoreContract(4, S, 2, false, 9), -200, 'XX down 1 nv');
eq(E.scoreContract(4, S, 2, false, 7), -1000, 'XX down 3 nv');
eq(E.scoreContract(4, S, 2, true, 8), -1000, 'XX down 2 vul');
eq(E.scoreContract(7, N, 1, true, 0), -3800, '7NTX down 13 vul');
eq(E.scoreContract(7, N, 1, false, 0), -3500, '7NTX down 13 nv');

// ---- board rotation ----
eq([1, 2, 3, 4, 5, 16, 17].map(E.boardDealer), [0, 1, 2, 3, 0, 3, 0], 'dealers');
eq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(E.boardVul),
  [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2, 0], 'vulnerability cycle');
eq([E.seatVul(1, 0), E.seatVul(1, 1), E.seatVul(2, 3), E.seatVul(3, 2), E.seatVul(0, 2)], [true, false, true, true, false], 'seatVul');

// ---- auction ----
let a = E.auctionInfo(0, calls('P P P'));
eq([a.finished, a.turn], [false, 3], 'three passes: not over');
a = E.auctionInfo(0, calls('P P P P'));
eq([a.finished, a.passedOut, a.contract], [true, true, null], 'passed out');
a = E.auctionInfo(1, calls('1H P P'));
eq(a.finished, false, 'two passes after a bid: not over');
a = E.auctionInfo(1, calls('1H P P P'));
eq(a.contract, { level: 1, strain: H, doubled: 0, declarer: 1 }, '1H by East');
// declarer = first of the side to name the strain
a = E.auctionInfo(0, calls('1S P 2C P 2S P 4S P P P'));
eq(a.contract, { level: 4, strain: S, doubled: 0, declarer: 0 }, '4S by North');
a = E.auctionInfo(0, calls('1C P 1N P 3N P P P'));
eq(a.contract.declarer, 2, '3NT by South (responder named NT first)');
a = E.auctionInfo(2, calls('1H 1S 2H 2S P P 3H P P X P P P'));
eq(a.contract, { level: 3, strain: H, doubled: 1, declarer: 2 }, '3HX by South');
a = E.auctionInfo(3, calls('1N X XX P P P'));
eq(a.contract, { level: 1, strain: N, doubled: 2, declarer: 3 }, '1NTXX by West');
// opponents bid the same strain first; declarer is still from the declaring side
a = E.auctionInfo(0, calls('1H 2H P 3H P P P'));
eq(a.contract.declarer, 1, 'cue-bid strain: East named hearts first for EW');
// legality
a = E.auctionInfo(0, []);
eq([E.isLegalCall(a, E.DBL), E.isLegalCall(a, E.RDBL), E.isLegalCall(a, E.PASS), E.isLegalCall(a, E.mkBid(1, C)), E.isLegalCall(a, 38)], [false, false, true, true, false], 'opening legality');
a = E.auctionInfo(0, calls('1H'));
eq([E.isLegalCall(a, E.DBL), E.isLegalCall(a, E.RDBL), E.isLegalCall(a, E.parseCall('1D')), E.isLegalCall(a, E.parseCall('1H')), E.isLegalCall(a, E.parseCall('1S'))], [true, false, false, false, true], 'over 1H');
a = E.auctionInfo(0, calls('1H P'));
eq(E.isLegalCall(a, E.DBL), false, 'cannot double partner');
a = E.auctionInfo(0, calls('1H P P'));
eq(E.isLegalCall(a, E.DBL), true, 'balancing double');
a = E.auctionInfo(0, calls('1H X'));
eq([E.isLegalCall(a, E.RDBL), E.isLegalCall(a, E.DBL)], [true, false], 'redouble by opener side');
a = E.auctionInfo(0, calls('1H X P'));
eq([E.isLegalCall(a, E.RDBL), E.isLegalCall(a, E.DBL)], [false, false], 'doubler side cannot redouble or re-double');
a = E.auctionInfo(0, calls('1H X P P'));
eq(E.isLegalCall(a, E.RDBL), true, 'redouble after two passes');
a = E.auctionInfo(0, calls('1H X XX'));
eq([E.isLegalCall(a, E.DBL), E.isLegalCall(a, E.RDBL), E.isLegalCall(a, E.parseCall('1S'))], [false, false, true], 'after redouble');
a = E.auctionInfo(0, calls('1H X XX 1S'));
eq(E.isLegalCall(a, E.DBL), true, 'new bid can be doubled');
a = E.auctionInfo(0, calls('7N'));
eq(E.legalCalls(a).map(E.callName), ['P', 'X'], 'over 7NT');
eq(E.legalCalls(E.auctionInfo(0, [])).length, 36, '35 bids + pass at the start');

// ---- tricks ----
const c = E.mkCard;
eq(E.trickWinner(0, [c(S, 3), c(S, 12), c(S, 5), c(S, 11)], N), 1, 'highest of suit led');
eq(E.trickWinner(2, [c(S, 3), c(H, 12), c(D, 12), c(C, 12)], N), 2, 'discards never win at NT');
eq(E.trickWinner(2, [c(S, 12), c(H, 0), c(S, 5), c(S, 11)], H), 3, 'small trump beats the ace');
eq(E.trickWinner(1, [c(S, 12), c(H, 3), c(H, 9), c(S, 11)], H), 3, 'overruff');
eq(E.trickWinner(1, [c(S, 12), c(H, 9), c(H, 3), c(D, 12)], H), 2, 'underruff loses');
eq(E.trickWinner(3, [c(H, 1), c(H, 7), c(S, 12), c(H, 6)], H), 0, 'trump led');
eq(E.trickWinner(0, [c(D, 4), c(C, 12), c(S, 12), c(H, 12)], C), 1, 'only trump played wins');

// ---- dealing ----
{
  const rnd = E.mulberry32(12345);
  const count = new Array(52).fill(0);
  const seatSuit = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  let bad = 0;
  const T = 4000;
  for (let t = 0; t < T; t++) {
    const hands = E.dealCards(t % 2 ? rnd : undefined);
    const seen = new Set();
    for (let s = 0; s < 4; s++) {
      if (hands[s].length !== 13) bad++;
      for (const card of hands[s]) { seen.add(card); if (s === 0) count[card]++; seatSuit[s][E.cardSuit(card)]++; }
    }
    if (seen.size !== 52) bad++;
  }
  eq(bad, 0, 'every deal has 4 hands of 13 distinct cards');
  // each card lands with North about a quarter of the time
  const lo = Math.min.apply(null, count) / T, hi = Math.max.apply(null, count) / T;
  eq(lo > 0.21 && hi < 0.29, true, 'card distribution roughly uniform (' + lo.toFixed(3) + '..' + hi.toFixed(3) + ')');
}

// ---- full random playthroughs: legality invariants and bookkeeping ----
{
  const rnd = E.mulberry32(777);
  let problems = 0, played = 0, passedOut = 0;
  for (let t = 0; t < 3000; t++) {
    const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
    // random legal auction, biased to passing so it ends
    let guard = 0;
    while (g.phase === 'auction') {
      const legal = E.legalCalls(g.auction);
      let call = E.PASS;
      if (rnd() < 0.35) call = legal[Math.min(legal.length - 1, Math.floor(rnd() * Math.min(legal.length, 8)))];
      if (!g.isLegalCall(call)) problems++;
      g.makeCall(call);
      if (++guard > 400) { problems++; break; }
    }
    if (g.result && g.result.passedOut) { passedOut++; continue; }
    if (g.turn !== ((g.declarer + 1) & 3)) problems++;
    if (g.dummy !== ((g.declarer + 2) & 3)) problems++;
    let n = 0;
    while (g.phase === 'play') {
      const seat = g.turn, legal = g.legalCards();
      if (legal.length === 0) { problems++; break; }
      // must follow suit when able
      if (g.cur.cards.length) {
        const led = E.cardSuit(g.cur.cards[0]);
        const has = g.rem[seat].some(function (x) { return E.cardSuit(x) === led; });
        if (has && legal.some(function (x) { return E.cardSuit(x) !== led; })) problems++;
        if (!has && legal.length !== g.rem[seat].length) problems++;
        // an illegal card must be rejected
        if (has) {
          const off = g.rem[seat].find(function (x) { return E.cardSuit(x) !== led; });
          if (off !== undefined) { let threw = false; try { g.playCard(off); } catch (e) { threw = true; } if (!threw) problems++; }
        }
      }
      g.playCard(legal[Math.floor(rnd() * legal.length)]);
      n++;
    }
    if (n !== 52) problems++;
    if (g.taken[0] + g.taken[1] !== 13) problems++;
    if (g.rem.some(function (h) { return h.length; })) problems++;
    const r = g.result, k = g.contract;
    if (r.declTricks !== g.taken[g.declarer & 1]) problems++;
    if (r.score !== E.scoreContract(k.level, k.strain, k.doubled, E.seatVul(g.vul, g.declarer), r.declTricks)) problems++;
    if ((r.score > 0) !== (r.made >= 0)) problems++;
    // undo and replay reproduces the same state
    const copy = new E.Game(g.toJSON());
    if (JSON.stringify(copy.result) !== JSON.stringify(g.result)) problems++;
    copy.undo(5);
    if (copy.phase !== 'play' || copy.plays.length !== 47) problems++;
    played++;
  }
  eq(problems, 0, 'random playthrough invariants');
  console.log('playthroughs: ' + played + ' played, ' + passedOut + ' passed out');
}

console.log(checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
