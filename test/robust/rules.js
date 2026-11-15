// Robustness: the rules and the dealing, checked against independent reference implementations.
//   node test/robust/rules.js [deals=200000]
const load = require('../load.js');
const E = load(['Game', 'newDeal', 'dealCards', 'auctionInfo', 'isLegalCall', 'scoreContract', 'trickWinner', 'mkCard', 'cardSuit', 'cardRank',
  'mulberry32', 'mkBid', 'bidLevel', 'bidStrain', 'boardDealer', 'boardVul', 'seatVul', 'publicPlayState']);
const N = +(process.argv[2] || 200000);
let failed = 0;
const report = function (label, ok, detail) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); };
const rnd = E.mulberry32(20261115);
const ri = function (n) { return Math.floor(rnd() * n); };

// ---- 1. scoring: every contract, doubling, vulnerability and trick count against a table-driven reference ----
function refScore(level, strain, doubled, vul, tricks) {
  const diff = tricks - (level + 6);
  if (diff < 0) {
    if (!doubled) return diff * (vul ? 100 : 50);
    const nv = [0, 100, 300, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3500];
    const v = [0, 200, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3500, 3800];
    return -(vul ? v : nv)[-diff] * (doubled === 2 ? 2 : 1);
  }
  const minor = strain <= 1;
  let below = 0;
  for (let k = 1; k <= level; k++) below += strain === 4 ? (k === 1 ? 40 : 30) : minor ? 20 : 30;
  below *= [1, 2, 4][doubled];
  let total = below + (below >= 100 ? (vul ? 500 : 300) : 50);
  if (level === 6) total += vul ? 750 : 500;
  if (level === 7) total += vul ? 1500 : 1000;
  total += [0, 50, 100][doubled];
  total += diff * (doubled === 0 ? (minor ? 20 : 30) : (vul ? 200 : 100) * doubled);
  return total;
}
{
  let n = 0, bad = 0;
  for (let level = 1; level <= 7; level++) for (let strain = 0; strain < 5; strain++) for (let d = 0; d < 3; d++) for (const vul of [false, true]) for (let t = 0; t <= 13; t++) {
    n++;
    if (E.scoreContract(level, strain, d, vul, t) !== refScore(level, strain, d, vul, t)) { bad++; if (bad < 4) console.log('   mismatch', level, strain, d, vul, t, E.scoreContract(level, strain, d, vul, t), refScore(level, strain, d, vul, t)); }
  }
  report('scoring: all ' + n + ' contract/result combinations match the reference', bad === 0);
}

// ---- 2. auction: legality of every call and the final contract against a reference, on random auctions ----
function refAuction(dealer, calls) {
  let hi = null, state = 0, passes = 0, any = false;      // hi = {level, strain, seat}
  const first = {};
  calls.forEach(function (c, i) {
    const seat = (dealer + i) % 4;
    if (c === 0) { passes++; return; }
    passes = 0; any = true;
    if (c === 1) state = 1; else if (c === 2) state = 2;
    else { hi = { level: E.bidLevel(c), strain: E.bidStrain(c), seat: seat }; state = 0; const k = (seat % 2) + ':' + hi.strain; if (!(k in first)) first[k] = seat; }
  });
  const finished = hi ? passes >= 3 : calls.length >= 4;
  const turn = (dealer + calls.length) % 4;
  const legal = function (c) {
    if (finished) return false;
    if (c === 0) return true;
    if (c === 1) return !!hi && state === 0 && hi.seat % 2 !== turn % 2;
    if (c === 2) return !!hi && state === 1 && hi.seat % 2 === turn % 2;
    const l = E.bidLevel(c), s = E.bidStrain(c);
    return !hi || l > hi.level || (l === hi.level && s > hi.strain);
  };
  const contract = finished && hi ? { level: hi.level, strain: hi.strain, doubled: state, declarer: first[(hi.seat % 2) + ':' + hi.strain] } : null;
  return { finished: finished, legal: legal, contract: contract, passedOut: finished && !any && !hi };
}
{
  let seqs = 0, checks = 0, bad = 0, ended = 0;
  for (let t = 0; t < 30000; t++) {
    const dealer = ri(4), calls = [];
    for (let step = 0; step < 60; step++) {
      const a = E.auctionInfo(dealer, calls), r = refAuction(dealer, calls);
      if (a.finished !== r.finished) { bad++; break; }
      if (a.finished) {
        ended++;
        if (JSON.stringify(a.contract) !== JSON.stringify(r.contract)) { bad++; if (bad < 4) console.log('   contract mismatch', calls.join(' '), JSON.stringify(a.contract), JSON.stringify(r.contract)); }
        break;
      }
      const legal = [];
      for (let c = 0; c <= 37; c++) { checks++; const x = E.isLegalCall(a, c); if (x !== r.legal(c)) bad++; if (x) legal.push(c); }
      if (E.isLegalCall(a, 38) || E.isLegalCall(a, -1) || E.isLegalCall(a, 2.5)) bad++;
      const p = rnd();
      calls.push(p < 0.45 ? 0 : p < 0.6 && legal.indexOf(1) >= 0 ? 1 : p < 0.7 && legal.indexOf(2) >= 0 ? 2 : legal[Math.min(legal.length - 1, ri(7))]);
    }
    seqs++;
  }
  report('auction: ' + seqs + ' random auctions (' + ended + ' to the end), ' + checks + ' legality checks and every final contract match the reference', bad === 0, bad ? bad + ' mismatches' : '');
}

// ---- 3. tricks: winner of random tricks against a reference ----
function refWinner(leader, cards, trump) {
  const led = E.cardSuit(cards[0]);
  let best = -1, bw = -1;
  cards.forEach(function (c, i) {
    const s = E.cardSuit(c), w = s === trump ? 200 + E.cardRank(c) : s === led ? 100 + E.cardRank(c) : 0;
    if (w > bw) { bw = w; best = i; }
  });
  return (leader + best) % 4;
}
{
  let bad = 0; const T = 300000;
  for (let t = 0; t < T; t++) {
    const cards = [];
    while (cards.length < 4) { const c = ri(52); if (cards.indexOf(c) < 0) cards.push(c); }
    const leader = ri(4), trump = ri(5);
    if (E.trickWinner(leader, cards, trump) !== refWinner(leader, cards, trump)) bad++;
  }
  report('tricks: ' + T + ' random tricks in every strain give the same winner as the reference', bad === 0);
}

// ---- 4. play: legal cards, turn order and trick bookkeeping on random playthroughs ----
{
  let bad = 0, cards = 0;
  for (let t = 0; t < 1500; t++) {
    const g = new E.Game(E.newDeal(1 + ri(64), rnd));
    const strain = ri(5), level = 1 + ri(7), opener = g.turn;
    g.makeCall(E.mkBid(level, strain)); g.makeCall(0); g.makeCall(0); g.makeCall(0);
    if (g.declarer !== opener || g.turn !== (opener + 1) % 4) bad++;
    const held = g.hands.map(function (h) { return h.slice(); });
    let leader = g.turn, trick = [], won = [0, 0];
    while (g.phase === 'play') {
      const seat = g.turn;
      if (seat !== (leader + trick.length) % 4) bad++;
      const hand = held[seat];
      const follow = trick.length ? hand.filter(function (c) { return E.cardSuit(c) === E.cardSuit(trick[0]); }) : [];
      const ref = (follow.length ? follow : hand).slice().sort(function (a, b) { return a - b; });
      const got = g.legalCards().slice().sort(function (a, b) { return a - b; });
      if (JSON.stringify(ref) !== JSON.stringify(got)) bad++;
      const c = ref[ri(ref.length)];
      hand.splice(hand.indexOf(c), 1); trick.push(c); g.playCard(c); cards++;
      if (trick.length === 4) { leader = refWinner(leader, trick, strain); won[leader % 2]++; trick = []; }
    }
    if (g.taken[0] !== won[0] || g.taken[1] !== won[1]) bad++;
    const decl = won[opener % 2];
    if (g.result.declTricks !== decl || g.result.score !== refScore(level, strain, 0, E.seatVul(g.vul, opener), decl)) bad++;
  }
  report('play: ' + cards + ' cards over 1,500 deals: legal cards, whose turn, trick counts and final score match the reference', bad === 0);
}

// ---- 5. dealing: fairness of the shuffle the app uses (the platform's cryptographic generator) ----
const zOfChi = function (chi, df) { return (Math.pow(chi / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df)); };
const C = function (n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
{
  const seatOf = new Int32Array(52 * 4), hcpHist = new Int32Array(38), shapes = {};
  let dealBad = 0, sameSeat = 0, prev = null, sxy = 0, sx = 0, sy = 0, sxx = 0, syy = 0, prevH = -1, pairs = 0;
  for (let t = 0; t < N; t++) {
    const hands = E.dealCards();
    const where = new Int8Array(52).fill(-1);
    for (let s = 0; s < 4; s++) { if (hands[s].length !== 13) dealBad++; for (const c of hands[s]) { if (where[c] >= 0) dealBad++; where[c] = s; seatOf[c * 4 + s]++; } }
    for (let c = 0; c < 52; c++) if (where[c] < 0) dealBad++;
    if (prev) for (let c = 0; c < 52; c++) if (prev[c] === where[c]) sameSeat++;
    prev = where;
    let h = 0; const len = [0, 0, 0, 0];
    for (const c of hands[0]) { h += Math.max(0, E.cardRank(c) - 8); len[E.cardSuit(c)]++; }
    hcpHist[h]++;
    const key = len.sort(function (a, b) { return b - a; }).join('');
    shapes[key] = (shapes[key] || 0) + 1;
    if (prevH >= 0) { pairs++; sx += prevH; sy += h; sxy += prevH * h; sxx += prevH * prevH; syy += h * h; }
    prevH = h;
  }
  report('dealing: ' + N + ' deals, every one has 52 different cards, 13 to each seat', dealBad === 0);
  let chi = 0;
  for (let i = 0; i < 208; i++) chi += Math.pow(seatOf[i] - N / 4, 2) / (N / 4);
  let z = zOfChi(chi, 156);
  report('dealing: every card reaches every seat equally often', Math.abs(z) < 4, 'chi-square ' + chi.toFixed(1) + ' on 156 df, z = ' + z.toFixed(2));
  // high-card points against the exact distribution
  const total = C(52, 13), pH = new Array(38).fill(0);
  for (let a = 0; a <= 4; a++) for (let k = 0; k <= 4; k++) for (let q = 0; q <= 4; q++) for (let j = 0; j <= 4; j++) {
    if (a + k + q + j <= 13) pH[4 * a + 3 * k + 2 * q + j] += C(4, a) * C(4, k) * C(4, q) * C(4, j) * C(36, 13 - a - k - q - j) / total;
  }
  let chiH = 0, dfH = -1, tailO = 0, tailE = 0, mean = 0;
  for (let h = 0; h <= 37; h++) { mean += h * hcpHist[h] / N; const e = pH[h] * N; if (e >= 20) { chiH += Math.pow(hcpHist[h] - e, 2) / e; dfH++; } else { tailO += hcpHist[h]; tailE += e; } }
  if (tailE > 0) { chiH += Math.pow(tailO - tailE, 2) / tailE; dfH++; }
  z = zOfChi(chiH, dfH);
  report('dealing: high-card points follow the exact distribution', Math.abs(z) < 4 && Math.abs(mean - 10) < 0.05, 'mean ' + mean.toFixed(3) + ' (exact 10), chi-square ' + chiH.toFixed(1) + ' on ' + dfH + ' df, z = ' + z.toFixed(2));
  // hand shapes against the exact distribution
  let chiS = 0, dfS = -1, restO = 0, restE = 0; const top = [];
  for (let a = 13; a >= 4; a--) for (let b = Math.min(a, 13 - a); b >= 0; b--) for (let c = Math.min(b, 13 - a - b); c >= 0; c--) {
    const d = 13 - a - b - c; if (d > c || d < 0) continue;
    const cnt = {}; [a, b, c, d].forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
    let perms = 24; Object.keys(cnt).forEach(function (x) { for (let i = 2; i <= cnt[x]; i++) perms /= i; });
    const p = perms * C(13, a) * C(13, b) * C(13, c) * C(13, d) / total, e = p * N, o = shapes['' + a + b + c + d] || 0;
    if (e >= 20) { chiS += Math.pow(o - e, 2) / e; dfS++; top.push([p, '' + a + '-' + b + '-' + c + '-' + d, o / N]); } else { restO += o; restE += e; }
  }
  if (restE > 0) { chiS += Math.pow(restO - restE, 2) / restE; dfS++; }
  z = zOfChi(chiS, dfS);
  top.sort(function (x, y) { return y[0] - x[0]; });
  report('dealing: hand shapes follow the exact distribution', Math.abs(z) < 4, 'chi-square ' + chiS.toFixed(1) + ' on ' + dfS + ' df, z = ' + z.toFixed(2) +
    '; e.g. ' + top.slice(0, 3).map(function (x) { return x[1] + ' ' + (100 * x[2]).toFixed(2) + '% (exact ' + (100 * x[0]).toFixed(2) + '%)'; }).join(', '));
  // one deal tells nothing about the next
  const n2 = 52 * (N - 1), zs = (sameSeat - n2 / 4) / Math.sqrt(n2 * 0.25 * 0.75);
  const r = (pairs * sxy - sx * sy) / Math.sqrt((pairs * sxx - sx * sx) * (pairs * syy - sy * sy));
  report('dealing: consecutive deals are unrelated', Math.abs(zs) < 4 && Math.abs(r * Math.sqrt(pairs)) < 4,
    'a card repeats its seat ' + (100 * sameSeat / n2).toFixed(3) + '% of the time (expected 25%), z = ' + zs.toFixed(2) + '; point-count correlation ' + r.toFixed(4));
}
console.log(failed ? 'FAILED: ' + failed : 'ALL PASSED');
process.exit(failed ? 1 : 0);
