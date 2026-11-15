// Benchmark for src/dds.js.  Run: node test/dds.bench.js [deals-per-row=200] [seed]
// Times ddSolveBoard at a trick boundary (trick = [], every lead valued) on random deals:
// 13 cards per hand (opening lead), then random 11-, 9- and 7-card endings; notrump and a
// random suit contract. The transposition table is cleared once per row, then kept.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dds.js'), 'utf8');
const api = new Function(src + '\nreturn {ddSolveBoard, ddSolveBoardTarget, ddSolve, ddReset, ddLastNodes,' +
  ' ddTable: typeof ddTable === "function" ? ddTable : null};')();

const DEALS = +(process.argv[2] || 200);
let seed = +(process.argv[3] || 20240607);
function rnd() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(n) { return Math.floor(rnd() * n); }
function randomHold(n) {
  const c = [];
  for (let i = 0; i < 52; i++) c.push(i);
  for (let i = 51; i > 0; i--) { const j = rint(i + 1); const t = c[i]; c[i] = c[j]; c[j] = t; }
  const hold = new Array(16).fill(0);
  for (let i = 0; i < 4 * n; i++) hold[(i % 4) * 4 + Math.floor(c[i] / 13)] |= 1 << (c[i] % 13);
  return hold;
}
function now() { return Number(process.hrtime.bigint()) / 1e6; }
function stats(a) {
  const s = a.slice().sort((x, y) => x - y);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), mean: s.reduce((x, y) => x + y, 0) / s.length, p90: q(0.9), max: s[s.length - 1] };
}
function fmt(x) { return (x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : x.toFixed(0)).padStart(8); }

// warm-up so the JIT has compiled the search before anything is timed
for (let i = 0; i < 300; i++) api.ddSolveBoard(randomHold(8), i % 5, i % 4, []);

console.log('ddSolveBoard, all leads valued, ' + DEALS + ' random deals per row (ms per call)');
console.log('cards strain     median     mean      p90      max   nodes/call (median, mean)   nodes/ms');
for (const n of [13, 11, 9, 7]) {
  for (const strain of ['NT', 'suit']) {
    api.ddReset();
    const times = [], nodes = [];
    for (let d = 0; d < DEALS; d++) {
      const hold = randomHold(n);
      const trump = strain === 'NT' ? 4 : rint(4);
      const leader = rint(4);
      const t0 = now();
      api.ddSolveBoard(hold, trump, leader, []);
      times.push(now() - t0);
      nodes.push(api.ddLastNodes());
    }
    const st = stats(times), sn = stats(nodes);
    const total = times.reduce((x, y) => x + y, 0);
    console.log(String(n).padStart(5) + ' ' + strain.padEnd(6) + fmt(st.median) + ' ' + fmt(st.mean) + ' ' + fmt(st.p90) + ' ' + fmt(st.max) +
      '   ' + String(Math.round(sn.median)).padStart(9) + ' ' + String(Math.round(sn.mean)).padStart(9) +
      '   ' + String(Math.round(nodes.reduce((x, y) => x + y, 0) / total)).padStart(8));
  }
}

// Cheaper modes at the opening lead: one yes/no test per card, and exact values for 4 cards only.
for (const n of [13, 12]) {
  api.ddReset();
  const tt = [], to = [];
  for (let d = 0; d < Math.min(DEALS, 60); d++) {
    const hold = randomHold(n);
    const leader = rint(4);
    const all = [];
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if ((hold[leader * 4 + s] >> r) & 1) all.push(s * 13 + r);
    let t0 = now();
    api.ddSolveBoardTarget(hold, 4, leader, [], Math.ceil(n / 2));
    tt.push(now() - t0);
    t0 = now();
    api.ddSolveBoard(hold, 4, leader, [], 0, [all[0], all[3], all[6], all[9]]);
    to.push(now() - t0);
  }
  const a = stats(tt), b = stats(to);
  console.log(n + ' cards NT, ddSolveBoardTarget (target ' + Math.ceil(n / 2) + ', all leads): median' + fmt(a.median) + ' mean' + fmt(a.mean) + ' p90' + fmt(a.p90) + ' max' + fmt(a.max));
  console.log(n + ' cards NT, ddSolveBoard exact, only 4 candidate leads:      median' + fmt(b.median) + ' mean' + fmt(b.mean) + ' p90' + fmt(b.p90) + ' max' + fmt(b.max));
}

// Monte-Carlo pattern: one fixed set of 26 unseen cards re-dealt between two hidden hands
// (the other two hands fixed), same strain, table kept between deals.
{
  api.ddReset();
  const base = randomHold(13);
  const times = [];
  for (let d = 0; d < Math.min(DEALS, 60); d++) {
    const hold = base.slice();
    const cards = [];
    for (const seat of [1, 3]) for (let s = 0; s < 4; s++) { for (let r = 0; r < 13; r++) if ((hold[seat * 4 + s] >> r) & 1) cards.push(s * 13 + r); hold[seat * 4 + s] = 0; }
    for (let i = cards.length - 1; i > 0; i--) { const j = rint(i + 1); const t = cards[i]; cards[i] = cards[j]; cards[j] = t; }
    for (let i = 0; i < 26; i++) hold[(i < 13 ? 1 : 3) * 4 + Math.floor(cards[i] / 13)] |= 1 << (cards[i] % 13);
    const t0 = now();
    api.ddSolveBoard(hold, 4, 1, []);
    times.push(now() - t0);
  }
  const st = stats(times);
  console.log('Monte-Carlo re-deals of one NT layout (13 cards, table shared): median' + fmt(st.median) + ' mean' + fmt(st.mean) +
    ' p90' + fmt(st.p90) + ' max' + fmt(st.max));
}
if (api.ddTable) {
  api.ddReset();
  const times = [];
  for (let d = 0; d < Math.min(DEALS, 20); d++) { const hold = randomHold(13); const t0 = now(); api.ddTable(hold); times.push(now() - t0); }
  const st = stats(times);
  console.log('ddTable (20 solves of one deal): median' + fmt(st.median) + ' mean' + fmt(st.mean) + ' max' + fmt(st.max));
}
