// ===== play.js — card play =====
// The bot never sees hidden cards. It deals the unseen cards at random many times, consistent with
// what the bidding and the play have revealed (shown-out suits, promised lengths and strength),
// solves every such layout double-dummy, and plays the card with the best average score.
//   playStartJob(view, level) -> {step(ms) -> done?, result: {card, samples}}

function playMakeCtx(view) {
  const ps = publicPlayState(view.dealer, view.calls, view.plays);
  if (!ps || ps.over) throw new Error('no card to play');
  const me = view.seat, turn = ps.turn, playedBy = ps.playedBy;
  const vis = [null, null, null, null];
  vis[me] = view.hand.filter(function (c) { return playedBy[c] < 0; });
  if (view.dummyHand) vis[ps.dummy] = view.dummyHand.filter(function (c) { return playedBy[c] < 0; });
  if (!vis[turn]) throw new Error('the hand on turn is not visible to seat ' + me);
  const seen = new Uint8Array(52), gone = new Uint8Array(52);
  for (let c = 0; c < 52; c++) if (playedBy[c] >= 0) { seen[c] = 1; gone[c] = 1; }
  for (const c of ps.cur) gone[c] = 0;                       // cards of the current trick are still "in play"
  for (let s = 0; s < 4; s++) if (vis[s]) for (const c of vis[s]) seen[c] = 1;
  const unknown = [], hidden = [];
  for (let c = 0; c < 52; c++) if (!seen[c]) unknown.push(c);
  for (let s = 0; s < 4; s++) if (!vis[s]) hidden.push(s);
  const size = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) size[s] = 13 - ps.tricks.length - ((((s - ps.leader + 4) & 3) < ps.cur.length) ? 1 : 0);

  const voidIn = [[false, false, false, false], [false, false, false, false], [false, false, false, false], [false, false, false, false]];
  const playedLen = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], playedHcp = [0, 0, 0, 0];
  const tricks = ps.tricks.concat([{ leader: ps.leader, cards: ps.cur }]);
  for (const t of tricks) {
    if (!t.cards.length) continue;
    const led = cardSuit(t.cards[0]);
    for (let i = 0; i < t.cards.length; i++) {
      const seat = (t.leader + i) & 3, c = t.cards[i], cs = cardSuit(c);
      if (cs !== led) voidIn[seat][led] = true;
      playedLen[seat][cs]++;
      if (cardRank(c) > 8) playedHcp[seat] += cardRank(c) - 8;
    }
  }
  const hand = vis[turn];
  let legal = hand;
  if (ps.cur.length) {
    const led = cardSuit(ps.cur[0]);
    const follow = hand.filter(function (c) { return cardSuit(c) === led; });
    if (follow.length) legal = follow;
  }
  let bid = null;
  try { bid = bidState(view.dealer, view.vul, view.calls); } catch (e) { bid = null; }
  // what the bidding says about each hidden hand, restated for the cards it still holds
  const cons = hidden.map(function (h) {
    const k = { lenMin: [0, 0, 0, 0], lenMax: [13, 13, 13, 13], hcpMin: -99, hcpMax: 99 };
    if (bid) {
      const inf = bid.info[h];
      k.hcpMin = inf.hcpMin - playedHcp[h]; k.hcpMax = inf.hcpMax - playedHcp[h];
      for (let s = 0; s < 4; s++) { k.lenMin[s] = Math.max(0, inf.lenMin[s] - playedLen[h][s]); k.lenMax[s] = Math.max(0, inf.lenMax[s] - playedLen[h][s]); }
    }
    for (let s = 0; s < 4; s++) { if (voidIn[h][s]) k.lenMax[s] = 0; if (k.lenMin[s] > k.lenMax[s]) k.lenMin[s] = k.lenMax[s]; }
    return k;
  });
  // What the opening lead says about a hidden leader: an honour is led from touching honours
  // (so the card just below it is probably there too), a small card against notrump from a 4+ card suit.
  const first = ps.tricks.length ? ps.tricks[0] : { leader: ps.leader, cards: ps.cur };
  if (first.cards.length && !vis[first.leader]) {
    const k = cons[hidden.indexOf(first.leader)], lc = first.cards[0], ls = cardSuit(lc), lr = cardRank(lc);
    if (ls !== ps.trump) {
      if (lr >= 8 && lr <= 11) { if (unknown.indexOf(mkCard(ls, lr - 1)) >= 0) k.want = mkCard(ls, lr - 1); }
      else if (ps.trump === NT && lr <= 5 && !voidIn[first.leader][ls]) {
        k.lenMin[ls] = Math.min(k.lenMax[ls], Math.max(k.lenMin[ls], 4 - playedLen[first.leader][ls]));
      }
    }
  }
  const c = ps.contract, sign = ((turn ^ ps.declarer) & 1) === 0 ? 1 : -1;
  const util = [];
  for (let k = 0; k <= 13; k++) util.push(sign * scoreContract(c.level, c.strain, c.doubled, seatVul(view.vul, ps.declarer), k));
  return {
    view: view, ps: ps, me: me, turn: turn, trump: ps.trump, vis: vis, hidden: hidden, unknown: unknown, size: size,
    voidIn: voidIn, gone: gone, legal: legal, hand: hand, bid: bid, cons: cons, util: util, sign: sign,
    declSide: ps.declarer & 1, isDefender: ((turn ^ ps.declarer) & 1) === 1
  };
}

// ---------- sampling the unseen cards ----------
function playViolation(k, len, hcp) {
  let v = 0;
  for (let s = 0; s < 4; s++) {
    if (len[s] < k.lenMin[s]) v += 3 * (k.lenMin[s] - len[s]);
    else if (len[s] > k.lenMax[s]) v += 3 * (len[s] - k.lenMax[s]);
  }
  if (hcp < k.hcpMin) v += k.hcpMin - hcp; else if (hcp > k.hcpMax) v += hcp - k.hcpMax;
  return v;
}
// One random layout: array (parallel to ctx.hidden) of card arrays.
function playSample(ctx, rnd) {
  const H = ctx.hidden, n = H.length;
  const eligCount = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) for (let i = 0; i < n; i++) if (!ctx.voidIn[H[i]][s]) eligCount[s]++;
  let out = null;
  for (let attempt = 0; attempt < 12 && !out; attempt++) {
    const cards = ctx.unknown.slice();
    for (let i = cards.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = cards[i]; cards[i] = cards[j]; cards[j] = t; }
    if (attempt < 10) cards.sort(function (a, b) { return eligCount[cardSuit(a)] - eligCount[cardSuit(b)]; });   // most restricted suits first
    const room = H.map(function (h) { return ctx.size[h]; });
    const hands = H.map(function () { return []; });
    let ok = true;
    for (const c of cards) {
      const s = cardSuit(c);
      let tot = 0, lastOk = -1;
      for (let i = 0; i < n; i++) if (room[i] > 0 && (attempt >= 10 || !ctx.voidIn[H[i]][s])) { tot += room[i]; lastOk = i; }
      if (lastOk < 0) { ok = false; break; }
      let x = rnd() * tot, pick = lastOk;
      for (let i = 0; i < n; i++) {
        if (room[i] > 0 && (attempt >= 10 || !ctx.voidIn[H[i]][s])) { x -= room[i]; if (x < 0) { pick = i; break; } }
      }
      hands[pick].push(c); room[pick]--;
    }
    if (ok) out = hands;
  }
  if (!out) throw new Error('cannot place the unseen cards');
  // nudge the layout toward what the bidding promised (swap cards between hidden hands while it helps)
  const len = out.map(function () { return [0, 0, 0, 0]; }), hcp = out.map(function () { return 0; });
  for (let i = 0; i < n; i++) for (const c of out[i]) { len[i][cardSuit(c)]++; if (cardRank(c) > 8) hcp[i] += cardRank(c) - 8; }
  const has = out.map(function (h, i) { return ctx.cons[i].want === undefined || h.indexOf(ctx.cons[i].want) >= 0; });
  const v = out.map(function (h, i) { return playViolation(ctx.cons[i], len[i], hcp[i]) + (has[i] ? 0 : 2); });
  let total = 0;
  for (let i = 0; i < n; i++) total += v[i];
  for (let it = 0; it < 240 && total > 0 && n > 1; it++) {
    const a = (rnd() * n) | 0;
    let b = (rnd() * (n - 1)) | 0;
    if (b >= a) b++;
    if (!out[a].length || !out[b].length) continue;
    const ia = (rnd() * out[a].length) | 0, ib = (rnd() * out[b].length) | 0;
    const ca = out[a][ia], cb = out[b][ib], sa = cardSuit(ca), sb = cardSuit(cb);
    if (ctx.voidIn[H[b]][sa] || ctx.voidIn[H[a]][sb]) continue;
    const ha = cardRank(ca) > 8 ? cardRank(ca) - 8 : 0, hb = cardRank(cb) > 8 ? cardRank(cb) - 8 : 0;
    len[a][sa]--; len[a][sb]++; len[b][sb]--; len[b][sa]++;
    const wa = ctx.cons[a].want, wb = ctx.cons[b].want;
    const hasA = wa === undefined || cb === wa || (has[a] && ca !== wa), hasB = wb === undefined || ca === wb || (has[b] && cb !== wb);
    const na = playViolation(ctx.cons[a], len[a], hcp[a] - ha + hb) + (hasA ? 0 : 2), nb = playViolation(ctx.cons[b], len[b], hcp[b] - hb + ha) + (hasB ? 0 : 2);
    if (na + nb <= v[a] + v[b]) {
      has[a] = hasA; has[b] = hasB;
      out[a][ia] = cb; out[b][ib] = ca; hcp[a] += hb - ha; hcp[b] += ha - hb;
      total += na + nb - v[a] - v[b]; v[a] = na; v[b] = nb;
    } else { len[a][sa]++; len[a][sb]--; len[b][sb]++; len[b][sa]--; }
  }
  return out;
}

// ---------- conventional choices among cards the analysis rates equal ----------
function playSuitRanks(cards, s) {
  const r = [];
  for (const c of cards) if (cardSuit(c) === s) r.push(cardRank(c));
  r.sort(function (a, b) { return b - a; });
  return r;
}
// Standard lead from a holding (ranks high to low): top of touching honours, fourth best, top of a doubleton.
function playLeadRank(r, vsSuit) {
  const n = r.length;
  if (n === 1) return r[0];
  if (r[0] - r[1] === 1 && r[0] >= 9) {
    if (vsSuit || n <= 3 || r[1] - r[2] <= 2) return r[0];
  }
  if (n >= 3 && r[0] >= 10 && r[0] - r[1] >= 2 && r[1] - r[2] === 1 && r[1] >= 8 && !(vsSuit && r[0] === 12)) return r[1];   // KJT, AJT, QT9
  if (vsSuit && r[0] === 12) return 12;                       // never underlead an ace against a suit contract
  if (n >= 4) return r[3];
  if (n === 3) return r[0] >= 8 ? r[2] : r[0];
  return r[0];
}
// How attractive each suit is for the opening lead, roughly in tricks.
function playLeadPrior(ctx) {
  const f = handFeatures(ctx.hand), trump = ctx.trump, vsSuit = trump < 4;
  const pa = ctx.turn ^ 2, decl = ctx.ps.declarer, dum = ctx.ps.dummy;
  const shown = function (seat, s) { return !!ctx.bid && (ctx.bid.suits[seat].indexOf(s) >= 0 || ctx.bid.info[seat].lenMin[s] >= 4); };
  const prior = new Float64Array(52).fill(-9);
  for (let s = 0; s < 4; s++) {
    const n = f.len[s];
    if (!n) continue;
    const r = playSuitRanks(ctx.hand, s), m = f.mask[s];
    const A = (m >> 12) & 1, K = (m >> 11) & 1, Q = (m >> 10) & 1, J = (m >> 9) & 1, T = (m >> 8) & 1;
    const seq = A && K ? 4 : K && Q ? 3 : Q && J ? 2 : J && T ? 1 : 0;
    let p = 0;
    if (s === trump) {
      p = -0.25;
      if (n === 1) p -= 0.3;
      if ((K || Q || J) && n <= 3) p -= 0.25;
    } else if (vsSuit) {
      if (shown(pa, s)) p += 0.7;
      if (seq === 4) p += 0.6; else if (seq === 3) p += 0.45; else if (seq === 2) p += 0.3; else if (seq === 1) p += 0.15;
      else if (A) p -= 0.25; else if (K) p -= 0.15; else if (Q) p -= 0.1; else if (J) p -= 0.05;
      const tr = f.len[trump];
      if (n === 1 && tr >= 1 && tr <= 3) p += 0.45;
      if (n === 2 && !seq && tr >= 1 && tr <= 3) p += (m >> 9) ? -0.1 : 0.1;
      if (shown(decl, s)) p -= 0.5;
      if (shown(dum, s)) p -= 0.3;
      if (!shown(decl, s) && !shown(dum, s)) p += 0.1;
    } else {
      if (shown(pa, s)) p += 0.8;
      p += n >= 4 ? 0.3 + 0.12 * (n - 4) : n === 3 ? -0.05 : -0.3;
      if (seq && n >= 3) p += 0.35;
      p += 0.03 * f.hs[s];
      if (shown(decl, s)) p -= 0.6;
      if (shown(dum, s)) p -= 0.4;
    }
    const lead = playLeadRank(r, vsSuit);
    for (const rk of r) prior[mkCard(s, rk)] = rk === lead ? p : p - 0.6;
  }
  return prior;
}
// The trick in progress: who is winning, and whether partner's winning card can still be beaten
// by an opponent yet to play (dummy's cards are known; for a hidden hand, any unseen higher card counts).
function playTrickStatus(ctx) {
  const cur = ctx.ps.cur, trump = ctx.trump, led = cardSuit(cur[0]);
  let wi = 0;
  for (let i = 1; i < cur.length; i++) {
    const cb = cur[wi], ci = cur[i];
    if (cardSuit(ci) === cardSuit(cb) ? ci > cb : cardSuit(ci) === trump) wi = i;
  }
  const win = cur[wi], ws = cardSuit(win);
  const partnerWinning = ((((ctx.ps.leader + wi) & 3) ^ ctx.turn) & 1) === 0;
  let holds = partnerWinning;
  for (let k = cur.length + 1; k < 4 && holds; k++) {
    const seat = (ctx.ps.leader + k) & 3;
    if (((seat ^ ctx.turn) & 1) === 0) continue;                       // my partner cannot be next, but be safe
    const cards = ctx.vis[seat];
    if (cards) {
      let follows = false;
      for (const c of cards) if (cardSuit(c) === led) follows = true;
      for (const c of cards) {
        const cs = cardSuit(c);
        if (cs === ws && c > win && (cs === led || !follows)) holds = false;          // higher card of the winning suit
        else if (cs === trump && ws !== trump && !follows) holds = false;             // can ruff
      }
    } else {
      for (const c of ctx.unknown) if (cardSuit(c) === ws && c > win) holds = false;
    }
  }
  return { win: win, partnerWinning: partnerWinning, holds: holds };
}
// Small preferences used only to choose among cards whose analysed value is the same.
function playHeur(ctx, card) {
  const s = cardSuit(card), r = cardRank(card), cur = ctx.ps.cur, trump = ctx.trump, hand = ctx.hand;
  if (cur.length) {
    const led = cardSuit(cur[0]);
    if (s === led) return -0.05 * r;                                     // follow with the lowest that does the job
    if (s === trump) return (playTrickStatus(ctx).holds ? -0.6 : 0.3) - 0.05 * r;   // do not ruff partner's winner without reason
    // discard: low card from a long suit with nothing to guard
    const ranks = playSuitRanks(hand, s);
    let h = -0.08 * r + 0.1 * ranks.length;
    const top = ranks[0];
    if (top >= 9 && ranks.length <= 13 - top) h -= 1.0;                  // Kx, Qxx, Jxxx: keep the guard
    if (r === 12) h -= 1.5;
    return h;
  }
  // leading
  const ranks = playSuitRanks(hand, s);
  const idx = ranks.indexOf(r);
  let h = 0;
  const touchingBelow = idx + 1 < ranks.length && ranks[idx + 1] === r - 1, touchingAbove = idx > 0 && ranks[idx - 1] === r + 1;
  if (r >= 9) h += touchingBelow && !touchingAbove ? 0.5 : touchingAbove ? -0.2 : -0.3;   // top of a sequence, not a bare honour
  else h -= 0.02 * r;
  if (ctx.isDefender) {
    const tr = ctx.ps.tricks;
    if (tr.length && cardSuit(tr[0].cards[0]) === s && s !== trump) h += 0.4;        // carry on with the suit our side led
    for (let i = tr.length - 1; i >= 1; i--) {                                        // or return the suit partner switched to
      if (tr[i].leader === (ctx.turn ^ 2)) { if (cardSuit(tr[i].cards[0]) === s && s !== trump) h += 0.3; break; }
    }
  } else if (s === trump) {
    let out = 0;
    for (const c of ctx.unknown) if (cardSuit(c) === trump) out++;
    if (out > 0) h += 0.4;                                                             // draw trumps
  }
  return h;
}
// Cards that are interchangeable right now (touching, counting cards already played as gone).
function playClassKey(ctx, card) {
  const s = cardSuit(card);
  let r = cardRank(card);
  const own = new Uint8Array(13);
  for (const c of ctx.hand) if (cardSuit(c) === s) own[cardRank(c)] = 1;
  while (r < 12 && (own[r + 1] || ctx.gone[mkCard(s, r + 1)])) r++;
  while (r > cardRank(card) && !own[r]) r--;
  return mkCard(s, r);                                                                // highest card of the run
}

// Rule-of-thumb play, used when no analysis is available (and to rank candidates early in a deal):
// lead conventions, second hand low, third hand high, win as cheaply as possible in fourth seat.
function playRuleScore(ctx) {
  const cur = ctx.ps.cur, trump = ctx.trump, legal = ctx.legal;
  const score = new Float64Array(52).fill(-99);
  if (!cur.length) {
    const prior = playLeadPrior(ctx);
    let out = 0;
    for (const c of ctx.unknown) if (cardSuit(c) === trump) out++;
    for (const c of legal) {
      let v = prior[c] + 0.2 * playHeur(ctx, c);
      if (!ctx.isDefender && cardSuit(c) === trump && out > 0) v += 1.2;      // declarer: draw trumps
      score[c] = v;
    }
    return score;
  }
  const led = cardSuit(cur[0]);
  const ts = playTrickStatus(ctx), win = ts.win, partnerWinning = ts.partnerWinning;
  const pos = cur.length;                                   // 1 second hand, 2 third hand, 3 fourth hand
  for (const c of legal) {
    const s = cardSuit(c), r = cardRank(c);
    if (s === led) {
      const beats = cardSuit(win) === led && c > win;
      let v = -0.05 * r;                                    // default: lowest
      if (beats && !partnerWinning) {
        if (pos === 3) v = 2 - 0.05 * r;                    // fourth hand: cheapest winner
        else if (pos === 2) v = 1 + 0.05 * cardRank(playClassKey(ctx, c)) - 0.001 * r;      // third hand high, lowest of touching cards
        else if (r >= 9 && cardRank(win) >= 9) v = 0.5 - 0.05 * r;                        // cover an honour with an honour
      } else if (beats && pos === 2 && cardRank(win) < 10) v = 1 + 0.05 * cardRank(playClassKey(ctx, c)) - 0.001 * r;   // partner's low card may not hold
      score[c] = v;
    } else if (s === trump) {
      const over = cardSuit(win) !== trump || c > win;
      score[c] = (!ts.holds && over ? 2 : -2) - 0.05 * r;                                 // ruff (cheaply) unless partner's card will hold
    } else score[c] = playHeur(ctx, c);
  }
  return score;
}

function playStartJob(view, level) {
  const ctx = playMakeCtx(view);
  level = level || 2;
  const legal = ctx.legal;
  const job = { result: null, step: null };
  const finish = function (card, n, how) { job.result = { card: card, samples: n, how: how }; return true; };
  const pickBy = function (cards, score) {
    let best = cards[0], bs = -1e9;
    for (const c of cards) { const v = score(c); if (v > bs + 1e-9 || (Math.abs(v - bs) <= 1e-9 && cardRank(c) < cardRank(best))) { best = c; bs = v; } }
    return best;
  };
  const isLead0 = ctx.ps.tricks.length === 0 && ctx.ps.cur.length === 0;
  ctx.isLead0 = isLead0;
  const prior = isLead0 ? playLeadPrior(ctx) : null;
  const heur = function (c) { return prior ? prior[c] : playHeur(ctx, c); };
  const rule = playRuleScore(ctx);
  // classes of interchangeable cards
  const keyOf = {}, members = {}, keys = [];
  for (const c of legal) {
    const k = playClassKey(ctx, c);
    keyOf[c] = k;
    if (!members[k]) { members[k] = []; keys.push(k); }
    members[k].push(c);
  }
  if (legal.length === 1 || keys.length === 1 || (isLead0 && level <= 1) || view.rulesOnly === true || typeof ddSolveBoard !== 'function') {
    const card = pickBy(legal, keys.length === 1 ? heur : function (c) { return rule[c]; });
    job.step = function () { return finish(card, 0, 'rule'); };
    return job;
  }
  // early in a deal the search is expensive: analyse only the more plausible plays
  const n13 = ctx.hand.length;
  const K = n13 >= 12 ? (level >= 3 ? 6 : 5) : n13 >= 10 ? 7 : 99;
  let cand = keys.slice();
  if (cand.length > K) {
    const best = function (k) { let b = -1e9; for (const c of members[k]) b = Math.max(b, rule[c]); return b; };
    cand.sort(function (a, b) { return best(b) - best(a); });
    const perSuit = [0, 0, 0, 0], kept = [], rest = [];
    for (const k of cand) { if (perSuit[cardSuit(k)] < 2) { perSuit[cardSuit(k)]++; kept.push(k); } else rest.push(k); }
    cand = kept.concat(rest).slice(0, K);
  }
  const only = cand.map(function (k) { return members[k][0]; });
  const budget = [0, 350, 1000, 2400][level] || 1000;
  const minN = [0, 5, 8, 12][level] || 8, maxN = [0, 20, 48, 110][level] || 48;
  const perSample = budget / minN;                        // time we would like one sample to take
  const sumK = {}, cntK = {};
  for (const k of keys) { sumK[k] = 0; cntK[k] = 0; }
  const rnd = mulberry32((view.seed !== undefined ? view.seed : (Math.random() * 4294967296)) >>> 0);
  const hold = new Array(16);
  const remaining = 13 - ctx.ps.tricks.length;
  const taken = ctx.ps.taken, moverSide = ctx.turn & 1, declSide = ctx.declSide;
  let n = 0, tries = 0, spent = 0, cap = view.nodeCap || 400000;
  // With 12-13 cards left exact trick counts cost too much: ask only "does this card still make / beat the contract?"
  const need = ctx.ps.contract.level + 6;
  let target = moverSide === declSide ? need - taken[declSide] : 14 - need - taken[moverSide];
  const useTarget = n13 >= 12 && typeof ddSolveBoardTarget === 'function' && target >= 1 && target <= remaining;
  // what reaching the target is worth: the score step at the trick it decides
  const swingAt = function (tg) {
    const d = moverSide === declSide ? taken[declSide] + tg : 14 - taken[moverSide] - tg;
    return d >= 1 && d <= 13 ? Math.max(20, Math.abs(ctx.util[d] - ctx.util[d - 1])) : 20;
  };
  let swing = swingAt(target), shifts = 0, shiftDir = 0;
  const decide = function () {
    const valued = legal.filter(function (c) { return cntK[keyOf[c]] > 0; });
    if (n < 3 || !valued.length) return finish(pickBy(legal, function (c) { return rule[c]; }), n, 'rule');
    const avg = function (c) { const k = keyOf[c]; return sumK[k] / cntK[k]; };
    let best = -1e18;
    for (const c of valued) best = Math.max(best, avg(c));
    if (prior) {
      const w = Math.min(1, n / 20);                       // few samples at the opening lead: lean on the lead conventions
      return finish(pickBy(valued, function (c) { return w * (avg(c) - best) + 45 * prior[c]; }), n, 'lead');
    }
    if (useTarget) {                                       // coarse analysis: let the rules of thumb settle close calls
      const w = Math.min(1, n / 16);
      return finish(pickBy(valued, function (c) { return w * (avg(c) - best) + 8 * rule[c]; }), n, 'target');
    }
    const close = valued.filter(function (c) { return avg(c) >= best - 4; });
    return finish(pickBy(close, heur), n, 'dd');
  };
  job.step = function (ms) {
    const t0 = Date.now(), end = t0 + (ms || 20);
    for (;;) {
      const s0 = Date.now();
      const hands = playSample(ctx, rnd);
      for (let i = 0; i < 16; i++) hold[i] = 0;
      for (let s = 0; s < 4; s++) if (ctx.vis[s]) for (const c of ctx.vis[s]) hold[s * 4 + cardSuit(c)] |= 1 << cardRank(c);
      for (let i = 0; i < ctx.hidden.length; i++) for (const c of hands[i]) hold[ctx.hidden[i] * 4 + cardSuit(c)] |= 1 << cardRank(c);
      const onlyArg = only.length < legal.length ? only : undefined;
      const res = useTarget ? ddSolveBoardTarget(hold, ctx.trump, ctx.ps.leader, ctx.ps.cur, target, cap, onlyArg)
        : ddSolveBoard(hold, ctx.trump, ctx.ps.leader, ctx.ps.cur, cap, onlyArg);
      tries++;
      const now = Date.now(), took = now - s0;
      if (res) {
        const done = {};
        for (let i = 0; i < res.cards.length; i++) {
          const k = keyOf[res.cards[i]];
          if (k === undefined || done[k]) continue;
          done[k] = 1;
          if (useTarget) sumK[k] += res.ok[i] ? swing : 0;
          else {
            const mine = res.tricks[i];                      // tricks the mover's side takes from here on
            const decl = moverSide === declSide ? taken[declSide] + mine : taken[declSide] + (remaining - mine);
            sumK[k] += ctx.util[decl];
          }
          cntK[k]++;
        }
        n++;
        if (took > 2 * perSample) cap = Math.max(20000, Math.round(cap * 0.7));
        if (useTarget && n === 6 && shifts < 2) {
          // contract safe (or hopeless) whatever we play: aim one trick higher (or lower) instead
          let lo = 1, hi = 0;
          for (const k of cand) if (cntK[k]) { const p = sumK[k] / cntK[k] / swing; if (p < lo) lo = p; if (p > hi) hi = p; }
          const dir = lo >= 0.84 ? 1 : hi <= 0.16 ? -1 : 0;
          if (dir !== 0 && (shiftDir === 0 || shiftDir === dir) && target + dir >= 1 && target + dir <= remaining) {
            target += dir; shiftDir = dir; shifts++; swing = swingAt(target); n = 0;
            for (const k of keys) { sumK[k] = 0; cntK[k] = 0; }
          }
        }
      } else if (took < 0.6 * perSample) cap = Math.round(cap * 1.6);          // gave up early: allow a deeper look next time
      const used = spent + (now - t0);
      if (n >= maxN || (used >= budget && (n >= minN || used >= 2.5 * budget))) { spent = used; return decide(); }
      if (now >= end) { spent = used; return false; }
    }
  };
  return job;
}
