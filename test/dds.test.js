// Correctness tests for src/dds.js.  Run: node test/dds.test.js   (add --quick for a short run)
//
// 0. The reference itself: a bitmask alpha-beta minimax (no table, no move ordering, no
//    equivalence pruning) is checked against a naive list-based full minimax.
// 1. ddSolveBoard: every legal card's value vs that brute-force reference, hand sizes 1-7,
//    all strains / leaders / trick lengths, interleaved so the persistent table is shared
//    between different deals, strains and sizes.
// 2. Bigger endings (8-10 cards) vs the reference with an exact-holdings memo added.
// 3. API options: node budget (null / -1 on abort, solver still correct afterwards), the
//    `only` candidate filter, and ddSolveBoardTarget vs the exact values.
// 4. Full 13-card deals: ddSolve == best ddSolveBoard value, complete best-line play-outs
//    reproduce the value, ddTable agrees with ddSolve.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dds.js'), 'utf8');
const api = new Function(src + '\nreturn {ddSolveBoard, ddSolveBoardTarget, ddSolve, ddReset, ddLastNodes,' +
  ' ddTable: typeof ddTable === "function" ? ddTable : null};')();
const { ddSolveBoard, ddSolveBoardTarget, ddSolve, ddReset, ddLastNodes, ddTable } = api;

const QUICK = process.argv.includes('--quick');
const NO_FULL = process.argv.includes('--no-full');     // skip the full-deal section

// ---------- deterministic RNG ----------
let seed = 0x2F6E2B1;
function rnd() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(n) { return Math.floor(rnd() * n); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ---------- naive ground truth: list-based full minimax, no pruning at all ----------
function trickWinner(cards, leader, trump) {
  // cards[i] was played by seat (leader+i)%4; highest trump wins, else highest of the suit led
  let best = 0;
  for (let i = 1; i < 4; i++) {
    const c = cards[i], b = cards[best];
    const cs = Math.floor(c / 13), bs = Math.floor(b / 13);
    if (cs === bs) { if (c % 13 > b % 13) best = i; }
    else if (cs === trump) best = i;
  }
  return (leader + best) % 4;
}
function legalCards(hand, trick) {
  if (trick.length === 0) return hand.slice();
  const ls = Math.floor(trick[0] / 13);
  const f = hand.filter(c => Math.floor(c / 13) === ls);
  return f.length ? f : hand.slice();
}
function naive(hands, trump, leader, trick) {        // NS tricks from here on
  const seat = (leader + trick.length) % 4;
  const hand = hands[seat];
  if (hand.length === 0 && trick.length === 0) return 0;
  let best = (seat % 2 === 0) ? -1 : 99;
  for (const c of legalCards(hand, trick)) {
    hands[seat] = hand.filter(x => x !== c);
    trick.push(c);
    let v;
    if (trick.length === 4) {
      const w = trickWinner(trick, leader, trump);
      v = (w % 2 === 0 ? 1 : 0) + naive(hands, trump, w, []);
    } else v = naive(hands, trump, leader, trick);
    trick.pop();
    hands[seat] = hand;
    if (seat % 2 === 0) { if (v > best) best = v; } else if (v < best) best = v;
  }
  return best;
}
function naiveValues(hands, trump, leader, trick) {   // per legal card, for the mover's side
  const seat = (leader + trick.length) % 4;
  const hand = hands[seat], n = hand.length;
  const out = new Map();
  for (const c of legalCards(hand, trick)) {
    hands[seat] = hand.filter(x => x !== c);
    const t2 = trick.concat([c]);
    let v;
    if (t2.length === 4) { const w = trickWinner(t2, leader, trump); v = (w % 2 === 0 ? 1 : 0) + naive(hands, trump, w, []); }
    else v = naive(hands, trump, leader, t2);
    hands[seat] = hand;
    out.set(c, seat % 2 === 0 ? v : n - v);
  }
  return out;
}

// ---------- fast reference: bitmask alpha-beta minimax ----------
// No move ordering, no equivalence pruning, no bounds heuristics. Optional memo keyed on the
// exact holdings (used only for the 8-10 card section).
const RH = new Int32Array(16);
let refTrump = 4;
let refMemo = null;
function refWinner(leader, c0, c1, c2, c3) {
  let bestPos = 0, bc = c0;
  const t = refTrump;
  let bs = (bc / 13) | 0;
  let c = c1, cs = (c / 13) | 0;
  if (cs === bs) { if (c > bc) { bc = c; bestPos = 1; } } else if (cs === t) { bc = c; bs = cs; bestPos = 1; }
  c = c2; cs = (c / 13) | 0;
  if (cs === bs) { if (c > bc) { bc = c; bestPos = 2; } } else if (cs === t) { bc = c; bs = cs; bestPos = 2; }
  c = c3; cs = (c / 13) | 0;
  if (cs === bs) { if (c > bc) { bc = c; bestPos = 3; } } else if (cs === t) { bc = c; bs = cs; bestPos = 3; }
  return (leader + bestPos) & 3;
}
// NS tricks from here (n = tricks left including the current one); fail-soft.
function refAB(leader, pos, c0, c1, c2, n, alpha, beta) {
  let key = null, a0 = alpha, b0 = beta;
  if (pos === 0) {
    if (n === 0) return 0;
    if (refMemo !== null) {
      key = String.fromCharCode(leader, RH[0], RH[1], RH[2], RH[3], RH[4], RH[5], RH[6], RH[7],
        RH[8], RH[9], RH[10], RH[11], RH[12], RH[13], RH[14], RH[15]);
      const m = refMemo.get(key);
      if (m !== undefined) {
        const lo = m >> 4, hi = m & 15;
        if (lo >= beta) return lo;
        if (hi <= alpha) return hi;
        if (lo === hi) return lo;
        if (lo > alpha) alpha = lo;
        if (hi < beta) beta = hi;
        a0 = alpha; b0 = beta;
      }
    }
  }
  const seat = (leader + pos) & 3, b = seat << 2;
  const isMax = (seat & 1) === 0;
  const ls = pos > 0 ? (c0 / 13) | 0 : -1;
  const follow = pos > 0 && RH[b + ls] !== 0;
  let best = isMax ? -1 : 99;
  outer:
  for (let s = 0; s < 4; s++) {
    if (follow && s !== ls) continue;
    let h = RH[b + s];
    while (h !== 0) {
      const r = 31 - Math.clz32(h);
      h ^= 1 << r;
      const c = s * 13 + r;
      RH[b + s] ^= 1 << r;
      let v;
      if (pos === 0) v = refAB(leader, 1, c, 0, 0, n, alpha, beta);
      else if (pos === 1) v = refAB(leader, 2, c0, c, 0, n, alpha, beta);
      else if (pos === 2) v = refAB(leader, 3, c0, c1, c, n, alpha, beta);
      else {
        const w = refWinner(leader, c0, c1, c2, c);
        const add = (w & 1) === 0 ? 1 : 0;
        v = add + refAB(w, 0, 0, 0, 0, n - 1, alpha - add, beta - add);
      }
      RH[b + s] ^= 1 << r;
      if (isMax) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break outer;
    }
  }
  if (key !== null) {
    const m = refMemo.get(key);
    let lo = 0, hi = n;
    if (m !== undefined) { lo = m >> 4; hi = m & 15; }
    if (best <= a0) { if (best < hi) hi = best; }
    else if (best >= b0) { if (best > lo) lo = best; }
    else { lo = best; hi = best; }
    refMemo.set(key, (lo << 4) | hi);
  }
  return best;
}
function toHold(hands) {
  const hold = new Array(16).fill(0);
  for (let s = 0; s < 4; s++) for (const c of hands[s]) hold[s * 4 + Math.floor(c / 13)] |= 1 << (c % 13);
  return hold;
}
// Value of each legal card for the mover's side (tricks out of those remaining), exact.
function refValues(hands, trump, leader, trick, useMemo) {
  const hold = toHold(hands);
  for (let i = 0; i < 16; i++) RH[i] = hold[i];
  refTrump = trump;
  refMemo = useMemo ? new Map() : null;
  const pos = trick.length;
  const seat = (leader + pos) % 4;
  const n = hands[seat].length;
  const out = new Map();
  for (const c of legalCards(hands[seat], trick)) {
    const s = Math.floor(c / 13), r = c % 13;
    RH[seat * 4 + s] ^= 1 << r;
    let v;
    if (pos === 0) v = refAB(leader, 1, c, 0, 0, n, -1, 99);
    else if (pos === 1) v = refAB(leader, 2, trick[0], c, 0, n, -1, 99);
    else if (pos === 2) v = refAB(leader, 3, trick[0], trick[1], c, n, -1, 99);
    else {
      const w = refWinner(leader, trick[0], trick[1], trick[2], c);
      const add = (w & 1) === 0 ? 1 : 0;
      v = add + refAB(w, 0, 0, 0, 0, n - 1, -1, 99);
    }
    RH[seat * 4 + s] ^= 1 << r;
    out.set(c, seat % 2 === 0 ? v : n - v);
  }
  refMemo = null;
  return out;
}

// ---------- helpers ----------
const SUITS = 'CDHS', RANKS = '23456789TJQKA';
function cardName(c) { return SUITS[Math.floor(c / 13)] + RANKS[c % 13]; }
function show(hands, trump, leader, trick) {
  return 'trump=' + (trump === 4 ? 'NT' : SUITS[trump]) + ' leader=' + 'NESW'[leader] +
    ' trick=[' + trick.map(cardName).join(' ') + '] ' +
    hands.map((h, i) => 'NESW'[i] + ':' + h.slice().sort((a, b) => b - a).map(cardName).join(' ')).join(' | ');
}
// Random position: n cards per hand at the trick boundary, then `tl` random legal cards played.
function randomPosition(n, tl, pool) {
  const cards = shuffle(pool.slice()).slice(0, 4 * n);
  const hands = [[], [], [], []];
  for (let i = 0; i < 4 * n; i++) hands[i % 4].push(cards[i]);
  const leader = rint(4);
  const trick = [];
  for (let i = 0; i < tl; i++) {
    const seat = (leader + i) % 4;
    const lc = legalCards(hands[seat], trick);
    const c = lc[rint(lc.length)];
    hands[seat] = hands[seat].filter(x => x !== c);
    trick.push(c);
  }
  return { hands, leader, trick };
}
const FULL = []; for (let c = 0; c < 52; c++) FULL.push(c);
function randomPool(size) { return shuffle(FULL.slice()).slice(0, size); }

let failures = 0, checked = 0, cardsChecked = 0;
function checkPosition(hands, trump, leader, trick, useMemo) {
  const hold = toHold(hands);
  const holdCopy = hold.slice(), trickCopy = trick.slice();
  const res = ddSolveBoard(hold, trump, leader, trick);
  const ref = refValues(hands, trump, leader, trick, useMemo);
  checked++;
  let ok = true, why = '';
  for (let i = 0; i < 16; i++) if (hold[i] !== holdCopy[i]) { ok = false; why = 'hold mutated'; }
  if (trick.length !== trickCopy.length || trick.some((c, i) => c !== trickCopy[i])) { ok = false; why = 'trick mutated'; }
  if (res.seat !== (leader + trick.length) % 4) { ok = false; why = 'wrong seat'; }
  if (res.cards.length !== ref.size || res.tricks.length !== res.cards.length) { ok = false; why = 'card count ' + res.cards.length + ' vs ' + ref.size; }
  if (new Set(res.cards).size !== res.cards.length) { ok = false; why = 'duplicate cards'; }
  for (let i = 0; ok && i < res.cards.length; i++) {
    cardsChecked++;
    if (!ref.has(res.cards[i])) { ok = false; why = 'illegal card ' + cardName(res.cards[i]); }
    else if (ref.get(res.cards[i]) !== res.tricks[i]) {
      ok = false; why = cardName(res.cards[i]) + ' got ' + res.tricks[i] + ' want ' + ref.get(res.cards[i]);
    }
  }
  if (!ok) {
    failures++;
    if (failures <= 10) console.log('FAIL: ' + why + '\n  ' + show(hands, trump, leader, trick));
  }
  return ok;
}

const t0 = Date.now();
function secs() { return '  [' + ((Date.now() - t0) / 1000).toFixed(1) + 's]'; }
ddReset();

// ---------- 0. the reference itself ----------
{
  let bad = 0, cnt = 0;
  const N = QUICK ? 600 : 3000;
  for (let i = 0; i < N; i++) {
    const n = 1 + rint(4);
    const { hands, leader, trick } = randomPosition(n, rint(4), rnd() < 0.5 ? FULL : randomPool(4 * n + rint(4)));
    const trump = rint(5);
    const a = naiveValues(hands.map(h => h.slice()), trump, leader, trick.slice());
    const b = refValues(hands, trump, leader, trick, false);
    const c = refValues(hands, trump, leader, trick, true);
    cnt++;
    if (a.size !== b.size || a.size !== c.size) bad++;
    for (const [card, v] of a) if (b.get(card) !== v || c.get(card) !== v) bad++;
  }
  if (bad) { console.log('reference self-check FAILED (' + bad + ')'); process.exit(1); }
  console.log('reference self-check ok: ' + cnt + ' positions, alpha-beta (with and without memo) == naive full minimax' + secs());
}

// ---------- 1. random positions vs brute force ----------
{
  // [hand size, count]
  const plan = QUICK
    ? [[1, 300], [2, 600], [3, 800], [4, 800], [5, 500], [6, 300], [7, 40]]
    : [[1, 1000], [2, 3000], [3, 5000], [4, 5000], [5, 5000], [6, 4000], [7, 500]];
  const jobs = [];
  for (const [n, count] of plan) for (let i = 0; i < count; i++) jobs.push(n);
  shuffle(jobs);
  // jobs of one size share a pool of cards (and usually a strain) for a few deals in a row,
  // the way a Monte-Carlo caller re-deals the same unseen cards; sizes are interleaved
  const pools = {};
  const bySize = {};
  let k = 0;
  for (const n of jobs) {
    if (!pools[n] || pools[n].uses >= 6) {
      const size = rnd() < 0.5 ? 4 * n : Math.min(52, 4 * n + rint(12));
      pools[n] = { cards: randomPool(size), uses: 0, trump: rint(5) };
    }
    const pool = pools[n]; pool.uses++;
    const { hands, leader, trick } = randomPosition(n, rint(4), pool.cards);
    const trump = rnd() < 0.7 ? pool.trump : rint(5);
    checkPosition(hands, trump, leader, trick, false);
    bySize[n] = (bySize[n] || 0) + 1;
    if (++k % 3000 === 0 && rnd() < 0.3) ddReset();     // occasionally restart from an empty table
  }
  console.log('brute-force comparison: ' + checked + ' positions, ' + cardsChecked + ' card values, by hand size ' +
    JSON.stringify(bySize) + ', failures ' + failures + secs());
}

// ---------- 2. bigger endings vs the memoised reference ----------
{
  const before = checked, f0 = failures;
  const plan = QUICK ? [[8, 40], [9, 10]] : [[8, 300], [9, 100], [10, 25]];
  for (const [n, count] of plan) {
    for (let i = 0; i < count; i++) {
      const pool = randomPool(rnd() < 0.5 ? 4 * n : Math.min(52, 4 * n + rint(8)));
      const { hands, leader, trick } = randomPosition(n, rint(4), pool);
      checkPosition(hands, rint(5), leader, trick, true);
    }
  }
  console.log('memoised-reference comparison (8-10 cards): ' + (checked - before) + ' positions, failures ' + (failures - f0) + secs());
}

// ---------- 3. API options: node budget, `only`, boolean target ----------
{
  const f0 = failures;
  let positions = 0, aborted = 0, withinBudget = 0, onlyChecks = 0, targetChecks = 0, solveChecks = 0;
  function fail(msg, hands, trump, leader, trick) {
    failures++;
    if (failures - f0 <= 10) console.log('FAIL (options): ' + msg + '\n  ' + show(hands, trump, leader, trick));
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const N = QUICK ? 400 : 4000;
  for (let i = 0; i < N; i++) {
    const n = 2 + rint(7);                                   // 2..8 cards per hand
    const pool = randomPool(rnd() < 0.5 ? 4 * n : Math.min(52, 4 * n + rint(10)));
    const { hands, leader, trick } = randomPosition(n, rint(4), pool);
    const trump = rint(5);
    const hold = toHold(hands);
    positions++;
    // --- node budget: null (or a complete, correct answer), then an unlimited call ---
    const budget = 1 + rint(n >= 6 ? 40 : 4);
    const lim = ddSolveBoard(hold, trump, leader, trick, budget);
    const used = ddLastNodes();
    const exact = ddSolveBoard(hold, trump, leader, trick);
    if (lim === null) { aborted++; if (used !== budget + 1) fail('aborted call reports ' + used + ' nodes for budget ' + budget, hands, trump, leader, trick); }
    else { withinBudget++; if (used > budget || !same(lim, exact)) fail('budgeted result differs from unlimited', hands, trump, leader, trick); }
    const ref = refValues(hands, trump, leader, trick, n >= 7);
    if (exact === null || exact.cards.length !== ref.size || exact.cards.some((c, k) => ref.get(c) !== exact.tricks[k])) {
      fail('value after an aborted call is wrong', hands, trump, leader, trick);
      continue;
    }
    // --- only: a random subset of the legal cards plus one card that is not legal ---
    const pick = exact.cards.filter(() => rnd() < 0.5);
    const illegal = FULL.find(c => !exact.cards.includes(c));
    const only = shuffle(pick.concat(illegal === undefined ? [] : [illegal]));
    const sub = ddSolveBoard(hold, trump, leader, trick, 0, only);
    const expCards = exact.cards.filter(c => pick.includes(c));
    const expTricks = exact.tricks.filter((t, k) => pick.includes(exact.cards[k]));
    onlyChecks++;
    if (sub === null || sub.seat !== exact.seat || !same(sub.cards, expCards) || !same(sub.tricks, expTricks)) fail('only-filter result wrong', hands, trump, leader, trick);
    // --- boolean target vs exact values ---
    const targets = [rint(n + 3) - 1, rint(n + 1), Math.max.apply(null, exact.tricks), Math.max.apply(null, exact.tricks) + 1];
    for (const target of targets) {
      targetChecks++;
      const tg = ddSolveBoardTarget(hold, trump, leader, trick, target);
      if (tg === null || tg.seat !== exact.seat || !same(tg.cards, exact.cards) || tg.ok.length !== exact.cards.length ||
          tg.ok.some((v, k) => v !== (exact.tricks[k] >= target))) {
        fail('ddSolveBoardTarget(target=' + target + ') disagrees with exact values', hands, trump, leader, trick);
        break;
      }
      const tgo = ddSolveBoardTarget(hold, trump, leader, trick, target, 0, only);
      if (tgo === null || !same(tgo.cards, expCards) || tgo.ok.some((v, k) => v !== (expTricks[k] >= target))) {
        fail('ddSolveBoardTarget with only-filter wrong', hands, trump, leader, trick);
        break;
      }
      const tgl = ddSolveBoardTarget(hold, trump, leader, trick, target, budget);
      if (tgl !== null && !same(tgl, tg)) { fail('budgeted ddSolveBoardTarget differs', hands, trump, leader, trick); break; }
      if (tgl === null && ddLastNodes() !== budget + 1) { fail('aborted target call node count', hands, trump, leader, trick); break; }
    }
    // --- ddSolve with and without a budget ---
    if (trick.length === 0) {
      solveChecks++;
      const best = Math.max.apply(null, exact.tricks);
      const vb = ddSolve(hold, trump, leader, budget);
      const v = ddSolve(hold, trump, leader);
      if (v !== best || (vb !== -1 && vb !== v)) fail('ddSolve ' + v + ' / budgeted ' + vb + ' vs best card ' + best, hands, trump, leader, trick);
    }
  }
  console.log('API options: ' + positions + ' positions (' + aborted + ' budgeted calls aborted -> null, ' + withinBudget +
    ' finished within budget), ' + onlyChecks + ' only-filter checks, ' + targetChecks + ' target checks, ' + solveChecks +
    ' ddSolve checks, failures ' + (failures - f0) + secs());
}

// ---------- 4. full deals: internal consistency ----------
if (!NO_FULL) {
  let bad = 0;
  const deals = QUICK ? 6 : 40;        // 13-card solves take about a second each
  let playouts = 0, tables = 0;
  for (let d = 0; d < deals; d++) {
    const cards = shuffle(FULL.slice());
    const hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(cards[i]);
    const trump = d % 5, leader = rint(4);
    const hold = toHold(hands);
    const v = ddSolve(hold, trump, leader);
    const res = ddSolveBoard(hold, trump, leader, []);
    const mx = Math.max.apply(null, res.tricks);
    if (res.cards.length !== 13 || mx !== v) {
      bad++;
      if (bad <= 5) console.log('FAIL full deal: ddSolve ' + v + ' vs board max ' + mx + '\n  ' + show(hands, trump, leader, []));
      continue;
    }
    // play-out: every player picks a random best card; the value must be reproduced at
    // every step and by the final trick count
    if (d % 8 === 0) {
      playouts++;
      const h = hands.map(x => x.slice());
      const side = leader % 2, won = [0, 0];
      let ld = leader, trick = [], ok = true;
      while (h[0].length + h[1].length + h[2].length + h[3].length > 0) {
        const seat = (ld + trick.length) % 4;
        const r = ddSolveBoard(toHold(h), trump, ld, trick);
        const m = Math.max.apply(null, r.tricks);
        const remaining = h[seat].length;
        const exp = seat % 2 === side ? v - won[side] : remaining - (v - won[side]);
        if (m !== exp) { ok = false; console.log('FAIL play-out: got ' + m + ' expected ' + exp + '\n  ' + show(h, trump, ld, trick)); break; }
        const bestCards = r.cards.filter((c, i) => r.tricks[i] === m);
        const c = bestCards[rint(bestCards.length)];
        h[seat] = h[seat].filter(x => x !== c);
        trick.push(c);
        if (trick.length === 4) { const w = trickWinner(trick, ld, trump); won[w % 2]++; ld = w; trick = []; }
      }
      if (ok && won[side] !== v) { ok = false; console.log('FAIL play-out total: ' + won[side] + ' vs ' + v); }
      if (!ok) bad++;
    }
    if (d % 20 === 5 && ddTable) {
      tables++;
      const tb = ddTable(hold);
      for (let t = 0; t < 5; t++) for (let dec = 0; dec < 4; dec++) {
        if (tb[t][dec] !== 13 - ddSolve(hold, t, (dec + 1) % 4)) { bad++; console.log('FAIL ddTable'); }
      }
    }
  }
  failures += bad;
  console.log('full-deal consistency: ' + deals + ' deals (' + playouts + ' complete play-outs, ' + tables +
    ' ddTable checks), failures ' + bad + secs());
}

if (failures) { console.log('FAILED: ' + failures + ' failure(s)'); process.exit(1); }
console.log('ALL PASSED');
