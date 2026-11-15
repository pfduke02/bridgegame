// ===== dds.js — exact double-dummy solver =====================================
// Conventions: suits 0=C 1=D 2=H 3=S; trump 0-3 or 4 = notrump; ranks 0..12
// (deuce..ace); card = suit*13 + rank; seats 0=N 1=E 2=S 3=W (clockwise);
// hold[seat*4+suit] = 13-bit mask of the ranks held.
//
// Method: zero-window search ("can the side on lead take >= need of the n
// remaining tricks?") driven MTD(f)-style, with a transposition table at trick
// boundaries. Table keys are deal-independent: per-hand suit lengths plus the
// owners of only the top-k cards of each suit that actually mattered for the
// result ("winning ranks" / partition search), so one entry covers every
// position that differs only in the placement of irrelevant small cards.

const ddPop = new Uint8Array(8192);        // popcount of a 13-bit mask
const ddHi = new Int8Array(8192);          // index of the highest set bit, -1 for 0
const ddPextLo = new Uint8Array(16384);    // pext for the low 7 bits  [u<<7 | m]
const ddPextHi = new Uint8Array(4096);     // pext for the high 6 bits [u<<6 | m]
const ddSpread = new Int32Array(8192);     // bit i -> bit 2i
const ddUp = new Uint16Array(8192 * 14);   // [u*14+k] ranks >= the k-th highest card of u
const ddUpR = new Uint16Array(16);         // [r] ranks >= r
const ddMaskNK = new Int32Array(14 * 14);  // [n*14+k] owner-code mask: top k of n cards

const ddH = new Int32Array(16);            // working holdings [seat*4+suit]
const ddAll = new Int32Array(4);           // per suit: cards not yet gone in completed tricks
const ddW = new Int32Array(64 * 4);        // per ply: winning-rank masks (upper sets)
const ddMv = new Int32Array(64 * 16);      // per ply: move list, (score<<10)|(lowest rank of class<<6)|(suit<<4)|rank
const ddHist = new Int32Array(4 * 64);     // [seat*64+move] history counters
let ddTrump = 4;
let ddNodes = 0;                           // trick-boundary nodes searched by the current/last call
let ddLimit = 0x7FFFFFFF;                  // node budget of the current call
const ddAbort = { ddAbort: true };         // thrown when the budget is exceeded

const ddTTWin = 16;                        // slots probed per lookup
const ddTTBits = 20;                       // 2^20 entries * 32 bytes = 32 MB
let ddTT = null;                           // Int32Array, 8 ints per entry
let ddTTClock = 0;

function ddInit() {
  for (let m = 1; m < 8192; m++) {
    ddPop[m] = ddPop[m >> 1] + (m & 1);
    ddHi[m] = 31 - Math.clz32(m);
  }
  ddHi[0] = -1;
  for (let m = 0; m < 8192; m++) {
    let x = 0;
    for (let b = 0; b < 13; b++) if ((m >> b) & 1) x |= 1 << (2 * b);
    ddSpread[m] = x;
    let t = m, mask = 0;
    for (let k = 1; k <= 13; k++) {
      if (t !== 0) { const r = ddHi[t]; mask = (0x1FFF << r) & 0x1FFF; t ^= 1 << r; }
      ddUp[m * 14 + k] = mask;
    }
  }
  for (let r = 0; r < 13; r++) ddUpR[r] = (0x1FFF << r) & 0x1FFF;
  for (let u = 0; u < 128; u++) {
    for (let m = 0; m < 128; m++) {
      let x = 0, k = 0;
      for (let b = 0; b < 7; b++) if ((u >> b) & 1) { if ((m >> b) & 1) x |= 1 << k; k++; }
      ddPextLo[(u << 7) | m] = x;
    }
  }
  for (let u = 0; u < 64; u++) {
    for (let m = 0; m < 64; m++) {
      let x = 0, k = 0;
      for (let b = 0; b < 6; b++) if ((u >> b) & 1) { if ((m >> b) & 1) x |= 1 << k; k++; }
      ddPextHi[(u << 6) | m] = x;
    }
  }
  for (let n = 0; n <= 13; n++) {
    for (let k = 1; k <= n; k++) ddMaskNK[n * 14 + k] = ((1 << (2 * k)) - 1) << (2 * (n - k));
  }
}
ddInit();

function ddReset() {
  if (ddTT !== null) ddTT.fill(0);
  ddHist.fill(0);
  ddTTClock = 0;
}

// Owner code of suit s: 2 bits per remaining card (lowest card in the low bits).
function ddCode(s) {
  const u = ddAll[s];
  const a = ddH[4 + s] | ddH[12 + s], b = ddH[8 + s] | ddH[12 + s];
  const ul = u & 127, uh = u >> 7, sh = ddPop[ul];
  const pa = ddPextLo[(ul << 7) | (a & 127)] | (ddPextHi[(uh << 6) | (a >> 7)] << sh);
  const pb = ddPextLo[(ul << 7) | (b & 127)] | (ddPextHi[(uh << 6) | (b >> 7)] << sh);
  return ddSpread[pa] | (ddSpread[pb] << 1);
}

// Tricks the hand at base hb can cash from the top when on lead (counting stops
// at `need`). Sets ddW[wb+s] for the cards relied on. Sound lower bound.
function ddQuick(hb, o1, o2, need, wb) {
  const H = ddH, A = ddAll, W = ddW, tr = ddTrump;
  let qt = 0, r1 = 0, r2 = 0;
  if (tr < 4) {
    r1 = ddPop[H[o1 + tr]]; r2 = ddPop[H[o2 + tr]];
    const h = H[hb + tr];
    if (h !== 0) {
      const u = A[tr], o = u ^ h;
      const t = o === 0 ? ddPop[h] : ddPop[h >> (ddHi[o] + 1)];
      if (t !== 0) {
        if (t >= need) { if (o !== 0) W[wb + tr] = ddUp[u * 14 + need]; return need; }
        qt = t;
        if (o !== 0) W[wb + tr] = ddUp[u * 14 + t];
        r1 = r1 > t ? r1 - t : 0; r2 = r2 > t ? r2 - t : 0;
      }
    }
  }
  for (let s = 0; s < 4; s++) {
    if (s === tr) continue;
    const h = H[hb + s];
    if (h === 0) continue;
    const u = A[s], o = u ^ h;
    let t = o === 0 ? ddPop[h] : ddPop[h >> (ddHi[o] + 1)];
    if (r1 !== 0) { const l = ddPop[H[o1 + s]]; if (l < t) t = l; }
    if (r2 !== 0) { const l = ddPop[H[o2 + s]]; if (l < t) t = l; }
    if (t === 0) continue;
    if (qt + t >= need) { if (o !== 0) W[wb + s] = ddUp[u * 14 + (need - qt)]; return need; }
    qt += t;
    if (o !== 0) W[wb + s] = ddUp[u * 14 + t];
  }
  return qt;
}

// Last trick: every hand has exactly one card.
function ddLast(leader, wb) {
  const H = ddH, tr = ddTrump;
  const lb = leader << 2;
  let ls = 0;
  while (H[lb + ls] === 0) ls++;
  let ws = ls, wr = ddHi[H[lb + ls]], wp = 0, cont = 0;
  for (let pos = 1; pos < 4; pos++) {
    const b = ((leader + pos) & 3) << 2;
    const h = H[b + ls];
    if (h !== 0) {
      if (ws === ls) { cont = 1; const r = ddHi[h]; if (r > wr) { wr = r; wp = pos; } }
    } else if (tr < 4) {
      const ht = H[b + tr];
      if (ht !== 0) {
        const r = ddHi[ht];
        if (ws === tr) { cont = 1; if (r > wr) { wr = r; wp = pos; } }
        else { ws = tr; wr = r; wp = pos; cont = 0; }
      }
    }
  }
  if (cont !== 0) ddW[wb + ws] = ddUpR[wr];
  return (wp & 1) === 0;
}

function ddSortMoves(mb, cnt) {
  const MV = ddMv;
  for (let i = 1; i < cnt; i++) {
    const v = MV[mb + i];
    let j = i - 1;
    while (j >= 0 && MV[mb + j] < v) { MV[mb + j + 1] = MV[mb + j]; j--; }
    MV[mb + j + 1] = v;
  }
}

function ddStore(base, L0, L1, mk, p0, p1, p2, p3, need, res, n, best) {
  const T = ddTT;
  let victim = -1;
  for (let e = base, end = base + (ddTTWin << 3); e < end; e += 8) {
    if (T[e] === L0 && T[e + 1] === L1) {
      const m = T[e + 2];
      if ((m & 0x1FFFFF) === mk && T[e + 3] === p0 && T[e + 4] === p1 && T[e + 5] === p2 && T[e + 6] === p3) {
        let lo = (m >> 21) & 15, hi = (m >> 25) & 15;
        if (res) { if (need > lo) lo = need; T[e + 7] = best; }
        else if (need - 1 < hi) hi = need - 1;
        T[e + 2] = mk | (lo << 21) | (hi << 25);
        return;
      }
    } else if (victim < 0 && T[e] === 0 && T[e + 1] === 0) victim = e;
  }
  if (victim < 0) victim = base + ((ddTTClock++ & (ddTTWin - 1)) << 3);
  T[victim] = L0; T[victim + 1] = L1;
  T[victim + 2] = res ? (mk | (need << 21) | (n << 25)) : (mk | ((need - 1) << 25));
  T[victim + 3] = p0; T[victim + 4] = p1; T[victim + 5] = p2; T[victim + 6] = p3;
  T[victim + 7] = res ? best : 255;
}

// Trick boundary: can the leader's side take >= need of the n remaining tricks?
function ddLead(leader, need, n, ply) {
  const W = ddW, H = ddH, A = ddAll;
  const wb = ply << 2;
  W[wb] = 0; W[wb + 1] = 0; W[wb + 2] = 0; W[wb + 3] = 0;
  if (need <= 0) return true;
  if (need > n) return false;
  if (n === 1) return ddLast(leader, wb);
  if (++ddNodes > ddLimit) throw ddAbort;
  const lb = leader << 2;
  const o1 = ((leader + 1) & 3) << 2, o2 = ((leader + 3) & 3) << 2, pb = lb ^ 8;
  const tr = ddTrump;

  // --- quick tricks ---
  const qt = ddQuick(lb, o1, o2, need, wb);
  if (qt >= need) return true;
  // ... then cross to partner's top card in a suit and cash partner's winners too
  {
    let entry = -1;
    for (let s = 0; s < 4; s++) {
      if (H[lb + s] === 0) continue;
      const hp = H[pb + s];
      if (hp === 0 || ((hp >> ddHi[A[s]]) & 1) === 0) continue;
      if (tr < 4 && s !== tr && ((H[o1 + tr] !== 0 && H[o1 + s] === 0) || (H[o2 + tr] !== 0 && H[o2 + s] === 0))) continue;
      entry = s;
      break;
    }
    if (entry >= 0 && qt + ddQuick(pb, o1, o2, need - qt, wb) >= need) {
      W[wb + entry] |= ddUp[A[entry] * 14 + 1];
      return true;
    }
  }
  W[wb] = 0; W[wb + 1] = 0; W[wb + 2] = 0; W[wb + 3] = 0;

  // --- transposition table ---
  const P = ddPop, MK = ddMaskNK, T = ddTT;
  const L0 = P[H[0]] | (P[H[4]] << 4) | (P[H[8]] << 8) | (P[H[12]] << 12) |
             (P[H[1]] << 16) | (P[H[5]] << 20) | (P[H[9]] << 24) | (P[H[13]] << 28);
  const L1 = P[H[2]] | (P[H[6]] << 4) | (P[H[10]] << 8) | (P[H[14]] << 12) |
             (P[H[3]] << 16) | (P[H[7]] << 20) | (P[H[11]] << 24) | (P[H[15]] << 28);
  const key5 = (tr << 2) | leader;
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3];
  const c0 = ddCode(0), c1 = ddCode(1), c2 = ddCode(2), c3 = ddCode(3);
  const n0 = P[a0] * 14, n1 = P[a1] * 14, n2 = P[a2] * 14, n3 = P[a3] * 14;
  let x = Math.imul(L0, 0x9E3779B1) + key5 | 0;
  x = Math.imul(x ^ (x >>> 15), 0x85EBCA6B) ^ L1;
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35);
  x ^= x >>> 16;
  const base = (x & ((1 << ddTTBits) - 1)) << 3;
  let best = 255;
  for (let e = base, end = base + (ddTTWin << 3); e < end; e += 8) {
    if (T[e] !== L0 || T[e + 1] !== L1) continue;
    const m = T[e + 2];
    if ((m & 31) !== key5) continue;
    const k0 = (m >> 5) & 15, k1 = (m >> 9) & 15, k2 = (m >> 13) & 15, k3 = (m >> 17) & 15;
    if ((c0 & MK[n0 + k0]) !== T[e + 3] || (c1 & MK[n1 + k1]) !== T[e + 4] ||
        (c2 & MK[n2 + k2]) !== T[e + 5] || (c3 & MK[n3 + k3]) !== T[e + 6]) continue;
    if (((m >> 21) & 15) >= need) {
      W[wb] = ddUp[a0 * 14 + k0]; W[wb + 1] = ddUp[a1 * 14 + k1];
      W[wb + 2] = ddUp[a2 * 14 + k2]; W[wb + 3] = ddUp[a3 * 14 + k3];
      return true;
    }
    if (((m >> 25) & 15) < need) {
      W[wb] = ddUp[a0 * 14 + k0]; W[wb + 1] = ddUp[a1 * 14 + k1];
      W[wb + 2] = ddUp[a2 * 14 + k2]; W[wb + 3] = ddUp[a3 * 14 + k3];
      return false;
    }
    if (T[e + 7] !== 255) best = T[e + 7];
  }

  // --- generate and order moves ---
  const MV = ddMv, mb = ply << 4;
  let cnt = 0;
  let bs = -1, bbit = 0;
  if (best !== 255) {
    bs = best >> 4;
    let h = H[lb + bs];
    for (let i = best & 15; i > 0 && h !== 0; i--) h ^= 1 << ddHi[h];
    if (h !== 0) bbit = 1 << ddHi[h]; else bs = -1;
  }
  const hb = leader << 6;
  for (let s = 0; s < 4; s++) {
    let h = H[lb + s];
    if (h === 0) continue;
    const u = A[s], o = u ^ h;
    const top = ddHi[u];
    const l1 = P[H[o1 + s]], l2 = P[H[o2 + s]], lp = P[H[pb + s]];
    let sw = 40 - 2 * (l1 + l2);
    let topOwner = 0;                    // 0 leader, 1 partner, 2 opponents
    if (((H[lb + s] >> top) & 1) === 0) topOwner = ((H[pb + s] >> top) & 1) !== 0 ? 1 : 2;
    if (tr < 4 && s !== tr) {
      if ((l1 === 0 && H[o1 + tr] !== 0) || (l2 === 0 && H[o2 + tr] !== 0)) sw -= 20;
      if (lp === 0 && H[pb + tr] !== 0) sw += 20;
    }
    while (h !== 0) {
      const r = ddHi[h];
      const below = o & ((1 << r) - 1);
      const cm = below === 0 ? h : (h & ~((2 << ddHi[below]) - 1));
      h ^= cm;
      let sc = sw;
      if (r === top) sc += 30;
      else if (topOwner === 1) sc += 24 - (r >> 1);
      else if (topOwner === 0) sc += 10 - (r >> 1);
      else sc += 12 - (r >> 1);
      const mv = (s << 4) | r;
      if (s === bs && (cm & bbit) !== 0) sc += 400;
      sc += ddHist[hb | mv];
      MV[mb + cnt++] = (sc << 10) | (ddHi[cm & -cm] << 6) | mv;
    }
  }
  if (cnt > 1) ddSortMoves(mb, cnt);

  // --- search ---
  const cb = wb + 4;
  let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
  for (let i = 0; i < cnt; i++) {
    const me = MV[mb + i], mv = me & 63;
    const s = mv >> 4, r = mv & 15, bit = 1 << r;
    H[lb + s] ^= bit;
    const res = ddFollow(1, leader, need, n, ply + 1, s, mv);
    H[lb + s] ^= bit;
    if (res) {
      w0 = W[cb]; w1 = W[cb + 1]; w2 = W[cb + 2]; w3 = W[cb + 3];
      W[wb] = w0; W[wb + 1] = w1; W[wb + 2] = w2; W[wb + 3] = w3;
      if (ddHist[hb | mv] < 200) ddHist[hb | mv]++;
      const k0 = P[a0 & w0], k1 = P[a1 & w1], k2 = P[a2 & w2], k3 = P[a3 & w3];
      ddStore(base, L0, L1, key5 | (k0 << 5) | (k1 << 9) | (k2 << 13) | (k3 << 17),
        c0 & MK[n0 + k0], c1 & MK[n1 + k1], c2 & MK[n2 + k2], c3 & MK[n3 + k3],
        need, true, n, (s << 4) | P[H[lb + s] >> (r + 1)]);
      return true;
    }
    // A refuted move stands for its whole class of touching cards. If its own rank
    // mattered, the lower cards of the class must be pinned down as well.
    if (((W[cb + s] >> r) & 1) !== 0) W[cb + s] |= ddUpR[(me >> 6) & 15];
    w0 |= W[cb]; w1 |= W[cb + 1]; w2 |= W[cb + 2]; w3 |= W[cb + 3];
  }
  W[wb] = w0; W[wb + 1] = w1; W[wb + 2] = w2; W[wb + 3] = w3;
  {
    const k0 = P[a0 & w0], k1 = P[a1 & w1], k2 = P[a2 & w2], k3 = P[a3 & w3];
    ddStore(base, L0, L1, key5 | (k0 << 5) | (k1 << 9) | (k2 << 13) | (k3 << 17),
      c0 & MK[n0 + k0], c1 & MK[n1 + k1], c2 & MK[n2 + k2], c3 & MK[n3 + k3],
      need, false, n, 255);
  }
  return false;
}

// Trick complete: st = winning rank | suit<<4 | position<<6 | contested<<8.
function ddTrickEnd(leader, need, n, ply, st) {
  const H = ddH, A = ddAll, W = ddW;
  const wb = ply << 2;
  const wp = (st >> 6) & 3;
  const winner = (leader + wp) & 3;
  let res;
  if ((wp & 1) === 0) {
    if (need <= 1) { W[wb] = 0; W[wb + 1] = 0; W[wb + 2] = 0; W[wb + 3] = 0; res = true; }
    else {
      const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3];
      A[0] = H[0] | H[4] | H[8] | H[12]; A[1] = H[1] | H[5] | H[9] | H[13];
      A[2] = H[2] | H[6] | H[10] | H[14]; A[3] = H[3] | H[7] | H[11] | H[15];
      res = ddLead(winner, need - 1, n - 1, ply);
      A[0] = a0; A[1] = a1; A[2] = a2; A[3] = a3;
    }
  } else {
    if (need >= n) { W[wb] = 0; W[wb + 1] = 0; W[wb + 2] = 0; W[wb + 3] = 0; res = false; }
    else {
      const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3];
      A[0] = H[0] | H[4] | H[8] | H[12]; A[1] = H[1] | H[5] | H[9] | H[13];
      A[2] = H[2] | H[6] | H[10] | H[14]; A[3] = H[3] | H[7] | H[11] | H[15];
      res = !ddLead(winner, n - need, n - 1, ply);
      A[0] = a0; A[1] = a1; A[2] = a2; A[3] = a3;
    }
  }
  if ((st & 256) !== 0) W[wb + ((st >> 4) & 3)] |= ddUpR[st & 15];
  return res;
}

// Second, third or fourth hand to a trick led by `leader` (suit ls).
// Returns whether the LEADER's side takes >= need of the n tricks.
function ddFollow(pos, leader, need, n, ply, ls, st) {
  const W = ddW, H = ddH, MV = ddMv, A = ddAll, P = ddPop;
  const wb = ply << 2, cb = wb + 4, mb = ply << 4;
  const seat = (leader + pos) & 3, sb = seat << 2;
  const tr = ddTrump;
  const wr = st & 15, ws = (st >> 4) & 3;
  const pw = (((st >> 6) ^ pos) & 1) === 0;       // partner holds the trick so far
  const hb = seat << 6;
  let cnt = 0;
  let h = H[sb + ls];
  if (h !== 0) {
    // must follow suit
    const o = A[ls] ^ h;
    // best card a later opponent could still produce in the suit led
    let later = -1, ruffRisk = false;
    if (pos < 3) {
      const nb = ((seat + 1) & 3) << 2;           // next hand is an opponent
      const hn = H[nb + ls];
      if (hn !== 0) later = ddHi[hn];
      else if (tr < 4 && ls !== tr && H[nb + tr] !== 0) ruffRisk = true;
    }
    const canWin = ws === ls;
    const thr = wr > later ? wr : later;
    const safe = pw && canWin && wr > later && !ruffRisk;   // partner's card stands up
    while (h !== 0) {
      const r = ddHi[h];
      const below = o & ((1 << r) - 1);
      const cm = below === 0 ? h : (h & ~((2 << ddHi[below]) - 1));
      h ^= cm;
      let sc;
      if (!canWin || ruffRisk || safe) sc = 100 - r;
      else if (r > thr) sc = 300 - r;
      else if (r > wr) sc = pos === 1 ? 90 - r : 150 + r;
      else sc = 100 - r;
      const mv = (ls << 4) | r;
      sc += ddHist[hb | mv];
      MV[mb + cnt++] = (sc << 10) | (ddHi[cm & -cm] << 6) | mv;
    }
  } else {
    // void: ruff or discard
    let safe = false;
    if (pw) {
      safe = true;
      if (pos < 3) {
        const nb = ((seat + 1) & 3) << 2;
        const hn = H[nb + ls];
        if (hn !== 0) { if (ws === ls && ddHi[hn] > wr) safe = false; }
        else if (tr < 4 && H[nb + tr] !== 0 && (ws !== tr || ddHi[H[nb + tr]] > wr)) safe = false;
      }
    }
    for (let s = 0; s < 4; s++) {
      h = H[sb + s];
      if (h === 0) continue;
      const u = A[s], o = u ^ h;
      const len = P[h];
      const top = ddHi[u];
      while (h !== 0) {
        const r = ddHi[h];
        const below = o & ((1 << r) - 1);
        const cm = below === 0 ? h : (h & ~((2 << ddHi[below]) - 1));
        h ^= cm;
        let sc;
        if (s === tr) {
          const wins = ws !== tr || r > wr;
          if (wins && !safe) sc = 300 - r;
          else sc = 20 - r;
        } else {
          sc = 100 - 2 * r + len;
          if (r === top) sc -= 30;
        }
        const mv = (s << 4) | r;
        sc += ddHist[hb | mv];
        MV[mb + cnt++] = (sc << 10) | (ddHi[cm & -cm] << 6) | mv;
      }
    }
  }
  if (cnt > 1) ddSortMoves(mb, cnt);

  const isMax = pos === 2;
  let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
  for (let i = 0; i < cnt; i++) {
    const me = MV[mb + i], mv = me & 63;
    const s = mv >> 4, r = mv & 15, bit = 1 << r;
    let st2 = st;
    if (s === ws) st2 = r > wr ? (mv | (pos << 6) | 256) : (st | 256);
    else if (s === tr) st2 = mv | (pos << 6);
    H[sb + s] ^= bit;
    const res = pos < 3 ? ddFollow(pos + 1, leader, need, n, ply + 1, ls, st2)
                        : ddTrickEnd(leader, need, n, ply + 1, st2);
    H[sb + s] ^= bit;
    if (res === isMax) {
      W[wb] = W[cb]; W[wb + 1] = W[cb + 1]; W[wb + 2] = W[cb + 2]; W[wb + 3] = W[cb + 3];
      if (ddHist[hb | mv] < 200) ddHist[hb | mv]++;
      return res;
    }
    if (((W[cb + s] >> r) & 1) !== 0) W[cb + s] |= ddUpR[(me >> 6) & 15];
    w0 |= W[cb]; w1 |= W[cb + 1]; w2 |= W[cb + 2]; w3 |= W[cb + 3];
  }
  W[wb] = w0; W[wb + 1] = w1; W[wb + 2] = w2; W[wb + 3] = w3;
  return !isMax;
}

// ---- root helpers ------------------------------------------------------------

function ddSetup(hold, trump, maxNodes) {
  if (ddTT === null) ddTT = new Int32Array(((1 << ddTTBits) + ddTTWin) << 3);
  ddNodes = 0;
  ddLimit = maxNodes > 0 ? maxNodes : 0x7FFFFFFF;
  ddTrump = trump;
  for (let i = 0; i < 16; i++) ddH[i] = hold[i] & 0x1FFF;
  for (let s = 0; s < 4; s++) ddAll[s] = ddH[s] | ddH[4 + s] | ddH[8 + s] | ddH[12 + s];
}

// Rough first guess of the tricks (out of n) for the side of `seat`.
function ddGuess(seat, n) {
  let mine = 0, tot = 0;
  for (let s = 0; s < 4; s++) {
    let u = ddAll[s];
    const hm = ddH[(seat << 2) + s] | ddH[((seat ^ 2) << 2) + s];
    for (let w = 4; w > 0 && u !== 0; w--) {
      const r = ddHi[u];
      u ^= 1 << r;
      tot += w;
      if ((hm >> r) & 1) mine += w;
    }
  }
  if (tot === 0) return (n + 1) >> 1;
  return Math.round(n * mine / tot);
}

// Does the trick leader's side take >= need of n, with the player at trick
// position pos to move?
function ddProbe(pos, leader, need, n, ls, st) {
  if (need <= 0) return true;
  if (need > n) return false;
  return pos === 0 ? ddLead(leader, need, n, 0) : ddFollow(pos, leader, need, n, 0, ls, st);
}

// Same, after the player at position pos plays (s, r).
function ddProbeMove(pos, leader, need, n, ls, st, s, r) {
  if (need <= 0) return true;
  if (need > n) return false;
  const sb = ((leader + pos) & 3) << 2, bit = 1 << r;
  const mv = (s << 4) | r;
  let res;
  ddH[sb + s] ^= bit;
  if (pos === 0) res = ddFollow(1, leader, need, n, 1, s, mv);
  else {
    const wr = st & 15, ws = (st >> 4) & 3;
    let st2 = st;
    if (s === ws) st2 = r > wr ? (mv | (pos << 6) | 256) : (st | 256);
    else if (s === ddTrump) st2 = mv | (pos << 6);
    res = pos < 3 ? ddFollow(pos + 1, leader, need, n, 1, ls, st2) : ddTrickEnd(leader, need, n, 1, st2);
  }
  ddH[sb + s] ^= bit;
  return res;
}

// Exact leader-side tricks after the player at position pos plays (s, r); MTD from guess g.
function ddMoveValue(pos, leader, n, ls, st, s, r, g) {
  let lo = 0, hi = n;
  while (lo < hi) {
    const t = g <= lo ? lo + 1 : (g > hi ? hi : g);
    if (ddProbeMove(pos, leader, t, n, ls, st, s, r)) { lo = t; g = t + 1; } else { hi = t - 1; g = t - 1; }
  }
  return lo;
}

// target === null: exact values; otherwise one zero-window test per card.
function ddBoard(leader, trick, only, target) {
  const trump = ddTrump;
  const tl = trick.length;
  const seat = (leader + tl) & 3, sb = seat << 2;
  let ls = -1, st = 0;
  for (let i = 0; i < tl; i++) {
    const c = trick[i], s = (c / 13) | 0, r = c - s * 13;
    ddAll[s] |= 1 << r;
    const mv = (s << 4) | r;
    if (i === 0) { ls = s; st = mv; }
    else {
      const wr = st & 15, ws = (st >> 4) & 3;
      if (s === ws) st = r > wr ? (mv | (i << 6) | 256) : (st | 256);
      else if (s === trump) st = mv | (i << 6);
    }
  }
  const n = ddPop[ddH[sb]] + ddPop[ddH[sb + 1]] + ddPop[ddH[sb + 2]] + ddPop[ddH[sb + 3]];
  const exact = target === null;
  const cards = [], tricks = [];
  if (n === 0) return exact ? { seat: seat, cards: cards, tricks: tricks } : { seat: seat, cards: cards, ok: tricks };
  const mine = (tl & 1) === 0;              // mover is on the trick leader's side
  const want = [0x1FFF, 0x1FFF, 0x1FFF, 0x1FFF];
  const some = only !== undefined && only !== null;
  if (some) {
    want[0] = 0; want[1] = 0; want[2] = 0; want[3] = 0;
    for (let i = 0; i < only.length; i++) { const c = only[i], s = (c / 13) | 0; if (s >= 0 && s < 4) want[s] |= 1 << (c - s * 13); }
  }

  // value of the whole node for the leader's side (skipped when only some cards are wanted)
  let va = exact ? ddGuess(leader, n) : 0;
  if (exact && !some) {
    let lo = 0, hi = n, g = va;
    while (lo < hi) {
      const t = g <= lo ? lo + 1 : (g > hi ? hi : g);
      if (ddProbe(tl, leader, t, n, ls, st)) { lo = t; g = t + 1; } else { hi = t - 1; g = t - 1; }
    }
    va = lo;
  }

  const follow = tl > 0 && ddH[sb + ls] !== 0;
  for (let s = 0; s < 4; s++) {
    if (follow && s !== ls) continue;
    let h = ddH[sb + s];
    const o = ddAll[s] ^ h;
    while (h !== 0) {
      const r = ddHi[h];
      const below = o & ((1 << r) - 1);
      const cm = below === 0 ? h : (h & ~((2 << ddHi[below]) - 1));   // touching cards: one move
      h ^= cm;
      if ((cm & want[s]) === 0) continue;
      let v;
      if (!exact) {
        // mover's side takes >= target  <=>  (mine) leader's side >= target
        //                               <=>  (other side) not (leader's side >= n - target + 1)
        v = mine ? ddProbeMove(tl, leader, target, n, ls, st, s, r)
                 : !ddProbeMove(tl, leader, n - target + 1, n, ls, st, s, r);
      } else {
        let a;                              // leader-side tricks after this card
        if (some) { a = ddMoveValue(tl, leader, n, ls, st, s, r, va); va = a; }
        else {
          a = va;
          if (mine) { while (a > 0 && !ddProbeMove(tl, leader, a, n, ls, st, s, r)) a--; }
          else { while (a < n && ddProbeMove(tl, leader, a + 1, n, ls, st, s, r)) a++; }
        }
        v = mine ? a : n - a;
      }
      for (let m = cm & want[s]; m !== 0;) {
        const q = ddHi[m];
        m ^= 1 << q;
        cards.push(s * 13 + q);
        tricks.push(v);
      }
    }
  }
  return exact ? { seat: seat, cards: cards, tricks: tricks } : { seat: seat, cards: cards, ok: tricks };
}

// Values of the legal cards of the player to move: { seat, cards, tricks }, tricks[i] = tricks
// (of those still to be played, current one included) the mover's side takes after cards[i]
// with best play all round. `trick` = cards already played to the current trick (first by
// `leader`). maxNodes > 0 limits the search: returns null when the budget runs out.
// `only` (optional array of cards): value just those of the legal cards.
function ddSolveBoard(hold, trump, leader, trick, maxNodes, only) {
  ddSetup(hold, trump, maxNodes);
  try { return ddBoard(leader, trick, only, null); }
  catch (e) { if (e === ddAbort) return null; throw e; }
}

// Cheaper yes/no version: { seat, cards, ok }, ok[i] = true iff the mover's side can still
// take at least `target` of the remaining tricks (current one included) after cards[i].
// One zero-window search per card. Same maxNodes / only semantics as ddSolveBoard.
function ddSolveBoardTarget(hold, trump, leader, trick, target, maxNodes, only) {
  ddSetup(hold, trump, maxNodes);
  try { return ddBoard(leader, trick, only, target | 0); }
  catch (e) { if (e === ddAbort) return null; throw e; }
}

// Tricks for the leader's side with `leader` on lead at a trick boundary (-1 if the
// optional node budget runs out).
function ddSolve(hold, trump, leader, maxNodes) {
  ddSetup(hold, trump, maxNodes);
  const lb = leader << 2;
  const n = ddPop[ddH[lb]] + ddPop[ddH[lb + 1]] + ddPop[ddH[lb + 2]] + ddPop[ddH[lb + 3]];
  let lo = 0, hi = n;
  let g = ddGuess(leader, n);
  try {
    while (lo < hi) {
      const t = g <= lo ? lo + 1 : (g > hi ? hi : g);
      if (ddLead(leader, t, n, 0)) { lo = t; g = t + 1; } else { hi = t - 1; g = t - 1; }
    }
  } catch (e) { if (e === ddAbort) return -1; throw e; }
  return lo;
}

// Trick-boundary nodes searched by the most recent ddSolveBoard / ddSolve call.
function ddLastNodes() { return ddNodes; }

// [strain][declarer] -> tricks declarer's side takes (opening lead from declarer's LHO).
function ddTable(hold) {
  const out = [];
  for (let t = 0; t < 5; t++) {
    const row = [];
    for (let d = 0; d < 4; d++) {
      const lead = (d + 1) & 3, lb = lead << 2;
      const n = ddPop[hold[lb] & 0x1FFF] + ddPop[hold[lb + 1] & 0x1FFF] + ddPop[hold[lb + 2] & 0x1FFF] + ddPop[hold[lb + 3] & 0x1FFF];
      row.push(n - ddSolve(hold, t, lead));
    }
    out.push(row);
  }
  return out;
}
