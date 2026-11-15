// ===== bid-eval.js — hand evaluation, what-each-player-has-shown bookkeeping, rule matching =====
// The bidding system is a set of rules {call, constraints, text}. The same rules are used both ways:
//   choosing a call   = first rule (in priority order) that the hand satisfies
//   reading a call    = the constraints of the rule(s) carrying that call
// so every bot "hears" exactly what its partner's bid promises. Where no specific rule applies,
// bid-natural.js supplies a general natural bidder and a matching interpreter.

const BID_GAME = 25, BID_SLAM = 33, BID_GRAND = 37;
const BID_SUIT_WORD = ['clubs', 'diamonds', 'hearts', 'spades'];

function handFeatures(cards) {
  const len = [0, 0, 0, 0], hs = [0, 0, 0, 0], mask = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) {
    const s = cardSuit(cards[i]), r = cardRank(cards[i]);
    len[s]++; mask[s] |= 1 << r;
    if (r > 8) hs[s] += r - 8;
  }
  const hcp = hs[0] + hs[1] + hs[2] + hs[3];
  const sorted = len.slice().sort(function (a, b) { return b - a; });
  const shape = sorted[0] * 1000 + sorted[1] * 100 + sorted[2] * 10 + sorted[3];
  const balanced = shape === 4333 || shape === 4432 || shape === 5332;
  const semiBal = balanced || shape === 5422 || shape === 6322;
  let lenPts = 0, aces = 0, kings = 0;
  const top3 = [0, 0, 0, 0], top5 = [0, 0, 0, 0], stop = [false, false, false, false];
  for (let s = 0; s < 4; s++) {
    const m = mask[s];
    lenPts += Math.max(0, len[s] - 4);
    if (m & 4096) aces++;
    if (m & 2048) kings++;
    top3[s] = ((m >> 12) & 1) + ((m >> 11) & 1) + ((m >> 10) & 1);
    top5[s] = top3[s] + ((m >> 9) & 1) + ((m >> 8) & 1);
    stop[s] = (m & 4096) !== 0 || ((m & 2048) !== 0 && len[s] >= 2) ||
      ((m & 1024) !== 0 && len[s] >= 3) || ((m & 512) !== 0 && len[s] >= 4);
  }
  return {
    cards: cards, len: len, mask: mask, hs: hs, hcp: hcp, sorted: sorted, shape: shape,
    balanced: balanced, semiBal: semiBal, lenPts: lenPts, pts: hcp + lenPts,
    aces: aces, kings: kings, top3: top3, top5: top5, stop: stop
  };
}

// Points as dummy for partner's suit: HCP plus shortness, worth more with a fourth trump.
function bidSupportPts(f, trump) {
  let p = f.hcp;
  const t = f.len[trump];
  for (let s = 0; s < 4; s++) {
    if (s === trump) continue;
    const l = f.len[s];
    if (t >= 4) p += l === 0 ? 5 : l === 1 ? 3 : l === 2 ? 1 : 0;
    else if (t === 3) p += l === 0 ? 3 : l === 1 ? 2 : l === 2 ? 1 : 0;
  }
  return p;
}
// Points as declarer once a fit is known: HCP plus shortness plus extra trump length.
function bidFitPts(f, trump) {
  let p = f.hcp + Math.max(0, f.len[trump] - 5);
  for (let s = 0; s < 4; s++) {
    if (s === trump) continue;
    const l = f.len[s];
    p += l === 0 ? 3 : l === 1 ? 2 : l === 2 ? 1 : 0;
  }
  return p;
}
function bidSuitOk(f, s) { return f.top3[s] >= 2 || f.top5[s] >= 3; }   // a suit worth preempting or overcalling in
function bidIsGame(call) {
  if (!isBid(call)) return false;
  const l = bidLevel(call), s = bidStrain(call);
  return l >= 5 || (l === 4 && s >= 2) || (l >= 3 && s === NT);
}
function bLen(s, n, s2, n2) { const a = [0, 0, 0, 0]; a[s] = n; if (s2 !== undefined) a[s2] = n2; return a; }
function bMax(s, n, s2, n2) { const a = [13, 13, 13, 13]; a[s] = n; if (s2 !== undefined) a[s2] = n2; return a; }

// ---------- rules ----------
// Rule fields: call, text, and any of
//   hcp:[lo,hi]  pts:[lo,hi] (HCP + length)  sp:[lo,hi,suit] (dummy points for suit)  fp:[lo,hi,suit] (declarer points with a fit)
//   len:[4] minimum lengths   max:[4] maximum lengths   bal:1 (balanced)   when:fn(features)
//   show:{hcp,len,max,bal}    what the call promises, when it differs from the matching fields
//   tag  forcing (1 = one round, 2 = to game)  inv (invitational)  stop (sign-off)  art (artificial)  agree (trump suit set)
function bidRuleMatches(r, f) {
  if (r.hcp && (f.hcp < r.hcp[0] || f.hcp > r.hcp[1])) return false;
  if (r.pts && (f.pts < r.pts[0] || f.pts > r.pts[1])) return false;
  if (r.sp) { const p = bidSupportPts(f, r.sp[2]); if (p < r.sp[0] || p > r.sp[1]) return false; }
  if (r.fp) { const p = bidFitPts(f, r.fp[2]); if (p < r.fp[0] || p > r.fp[1]) return false; }
  if (r.len) for (let s = 0; s < 4; s++) if (f.len[s] < r.len[s]) return false;
  if (r.max) for (let s = 0; s < 4; s++) if (f.len[s] > r.max[s]) return false;
  if (r.bal && !f.balanced) return false;
  if (r.when && !r.when(f)) return false;
  return true;
}
function bidRuleShow(r) {
  const sh = r.show || {};
  let hcp = sh.hcp || r.hcp;
  if (!hcp && r.pts) hcp = [Math.max(0, r.pts[0] - 2), r.pts[1]];
  if (!hcp && r.sp) hcp = [Math.max(0, r.sp[0] - 4), r.sp[1]];
  if (!hcp && r.fp) hcp = [Math.max(0, r.fp[0] - 3), r.fp[1]];
  return {
    hcp: hcp ? [hcp[0], Math.min(37, hcp[1])] : [0, 37],
    len: (sh.len || r.len || [0, 0, 0, 0]).slice(),
    max: (sh.max || r.max || [13, 13, 13, 13]).slice(),
    bal: !!(sh.bal || r.bal)
  };
}

// ---------- what each seat has shown ----------
function bidMkInfo() { return { hcpMin: 0, hcpMax: 37, lenMin: [0, 0, 0, 0], lenMax: [13, 13, 13, 13], bal: false }; }
function bidApplyShow(info, sh) {
  if (!sh) return;
  if (sh.hcp) {
    info.hcpMin = Math.max(info.hcpMin, sh.hcp[0]);
    info.hcpMax = Math.min(info.hcpMax, sh.hcp[1]);
    if (info.hcpMin > info.hcpMax) { info.hcpMin = sh.hcp[0]; info.hcpMax = sh.hcp[1]; }   // newest statement wins
  }
  for (let s = 0; s < 4; s++) {
    if (sh.len) info.lenMin[s] = Math.max(info.lenMin[s], sh.len[s]);
    if (sh.max) info.lenMax[s] = Math.min(info.lenMax[s], sh.max[s]);
    if (sh.bal) { info.lenMin[s] = Math.max(info.lenMin[s], 2); info.lenMax[s] = Math.min(info.lenMax[s], 5); }
    if (info.lenMin[s] > info.lenMax[s]) info.lenMax[s] = info.lenMin[s];
  }
  if (sh.bal) info.bal = true;
}

// ---------- auction state, rebuilt from the calls alone ----------
function bidNewState(dealer, vul) {
  return {
    dealer: dealer, vul: vul, calls: [], n: 0, turn: dealer,
    info: [bidMkInfo(), bidMkInfo(), bidMkInfo(), bidMkInfo()],
    mean: [], last: [null, null, null, null],
    lastBid: -1, lastBidder: -1, doubled: 0,
    opener: -1, openCall: -1,
    acts: [0, 0, 0, 0],            // non-pass calls per seat
    callCount: [0, 0, 0, 0],
    suits: [[], [], [], []],       // suits each seat has bid naturally, in order
    agreed: [-1, -1], gf: [false, false],
    nt: [false, false, false, false]   // seats that have bid notrump naturally
  };
}
function bidApply(st, call, m) {
  const seat = st.turn;
  m.seat = seat; m.call = call;
  st.calls.push(call); st.mean.push(m); st.last[seat] = m; st.callCount[seat]++;
  if (call !== PASS) st.acts[seat]++;
  if (call === DBL) st.doubled = 1;
  else if (call === RDBL) st.doubled = 2;
  else if (call !== PASS) {
    st.lastBid = call; st.lastBidder = seat; st.doubled = 0;
    if (st.opener < 0) { st.opener = seat; st.openCall = call; }
    if (m.suit >= 0 && st.suits[seat].indexOf(m.suit) < 0) st.suits[seat].push(m.suit);
    if (bidStrain(call) === NT && !m.art) st.nt[seat] = true;
  }
  bidApplyShow(st.info[seat], m.show);
  if (m.agree !== undefined && m.agree >= 0) st.agreed[seat & 1] = m.agree;
  if (m.forcing === 2) st.gf[seat & 1] = true;
  st.n++; st.turn = (seat + 1) & 3;
}
// Meaning of `call` if made now by the seat on turn.
function bidInterpret(st, call) {
  const rules = bidRules(st);
  let first = null, hull = null;
  if (rules) {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.call !== call) continue;
      const sh = bidRuleShow(r);
      if (!first) { first = r; hull = sh; continue; }
      hull.hcp[0] = Math.min(hull.hcp[0], sh.hcp[0]); hull.hcp[1] = Math.max(hull.hcp[1], sh.hcp[1]);
      for (let s = 0; s < 4; s++) { hull.len[s] = Math.min(hull.len[s], sh.len[s]); hull.max[s] = Math.max(hull.max[s], sh.max[s]); }
      hull.bal = hull.bal && sh.bal;
    }
  }
  if (!first) return bidNaturalMeaning(st, call);
  const natSuit = isBid(call) && bidStrain(call) < 4 && !first.art ? bidStrain(call) : -1;
  return {
    text: first.text, tag: first.tag || '', forcing: first.forcing || 0, inv: !!first.inv, stop: !!first.stop,
    art: !!first.art, suit: first.suit !== undefined ? first.suit : natSuit, show: hull, agree: first.agree
  };
}
function bidAdvance(st, call) { const m = bidInterpret(st, call); bidApply(st, call, m); return m; }
function bidState(dealer, vul, calls) {
  const st = bidNewState(dealer, vul);
  for (let i = 0; i < calls.length; i++) bidAdvance(st, calls[i]);
  return st;
}
// The call the system makes with these cards in this auction.
function bidChoose(st, f) {
  const rules = bidRules(st);
  if (rules) {
    for (let i = 0; i < rules.length; i++) {
      if (isLegalCall(st, rules[i].call) && bidRuleMatches(rules[i], f)) return rules[i].call;
    }
  }
  const call = bidNaturalPlan(st, f);
  return isLegalCall(st, call) ? call : PASS;
}
// Is the seat on turn obliged to keep the bidding open?
function bidForced(st) {
  const me = st.turn, pm = st.last[me ^ 2], rm = st.last[(me + 3) & 3];
  if (rm && rm.call !== PASS) return false;                       // right-hand opponent acted: no longer forced
  if (!pm || pm.call === PASS) return false;
  if (pm.forcing >= 1) return true;
  return st.gf[me & 1] && st.lastBid >= 0 && ((st.lastBidder ^ me) & 1) === 0 && !bidIsGame(st.lastBid);
}
