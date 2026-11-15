// ===== bid-natural.js — general natural bidding for every auction the specific rules do not cover =====
// bidNaturalPlan picks a call from the partnership picture (what partner has shown + my cards):
// combined points decide the level (part score / invite / game / slam), known 8-card fits decide the strain.
// bidNaturalMeaning reads any call the same way, so partners stay in step.

function bidNatStrain(st, me, f) {
  const P = st.info[me ^ 2], ag = st.agreed[me & 1];
  if (ag >= 0) return { trump: ag, total: f.len[ag] + Math.max(P.lenMin[ag], 1) };
  const theirs = bidTheirSuits(st, me);
  const free = function (s) { return theirs.indexOf(s) < 0; };      // a suit the opponents have bid is not ours to play in
  let best = -1, bt = 0;
  for (let s = 3; s >= 2; s--) { const t = f.len[s] + P.lenMin[s]; if (free(s) && t >= 8 && t > bt) { best = s; bt = t; } }
  if (best < 0) {
    for (let s = 3; s >= 2; s--) {                       // a major that can stand on its own
      if (free(s) && (f.len[s] >= 7 || (f.len[s] >= 6 && bidSuitOk(f, s))) && P.lenMax[s] >= 2 && f.len[s] > bt) { best = s; bt = f.len[s]; }
    }
    if (best >= 0) return { trump: best, total: bt + Math.max(1, P.lenMin[best]) };
    for (let s = 1; s >= 0; s--) { const t = f.len[s] + P.lenMin[s]; if (free(s) && t >= 8 && t > bt) { best = s; bt = t; } }
  }
  return best >= 0 ? { trump: best, total: bt } : { trump: NT, total: 0 };
}
function bidNatPts(f, t, P) {
  if (t === NT) return f.hcp + (f.sorted[0] >= 5 ? 1 : 0);
  return P.lenMin[t] >= f.len[t] ? bidSupportPts(f, t) : bidFitPts(f, t);
}
// The game contract this hand would aim for, or -1.
function bidNatGame(f, t, lo, P) {
  if (t === 2 || t === 3) return mkBid(4, t);
  if (t === NT) return mkBid(3, 4);
  const ntLo = f.hcp + (f.sorted[0] >= 5 ? 1 : 0) + P.hcpMin;
  if ((f.semiBal || P.bal) && ntLo >= BID_GAME - 1) return mkBid(3, 4);
  if (lo >= 28) return mkBid(5, t);
  return ntLo >= BID_GAME ? mkBid(3, 4) : -1;
}
// With game values and no fit yet: a forcing new suit below 3NT, or -1.
function bidNatExplore(st, f, t, me) {
  if (t !== NT || f.balanced || st.suits[me].length >= 3) return -1;
  const P = st.info[me ^ 2], theirs = bidTheirSuits(st, me);
  let best = -1;
  for (let s = 3; s >= 0; s--) {
    if (st.suits[me].indexOf(s) >= 0 || theirs.indexOf(s) >= 0 || P.lenMax[s] < 3) continue;
    if (f.len[s] < (s >= 2 ? 4 : 5) || (f.len[s] === 4 && P.lenMax[s] < 4)) continue;
    const c = bidCheapest(st, s);
    if (c >= mkBid(3, 4) || bidInterpret(st, c).forcing < 1) continue;
    if (best < 0 || f.len[s] > f.len[bidStrain(best)]) best = c;
  }
  return best;
}
// Must bid, with nothing extra: the cheapest sensible description.
function bidNatForcedBid(st, f, t, me) {
  if (t < 4) return bidCheapest(st, t);
  const pa = me ^ 2, P = st.info[pa], ps = st.suits[pa], ms = st.suits[me];
  const theirs = bidTheirSuits(st, me);
  const cand = [];
  for (const s of ps) if (f.len[s] >= 3 || (f.len[s] === 2 && P.lenMin[s] >= 5)) cand.push(bidCheapest(st, s));
  for (const s of ms) if (f.len[s] >= 6) cand.push(bidCheapest(st, s));
  if (f.semiBal && (theirs.length === 0 || bidStopAll(f, theirs))) cand.push(bidCheapest(st, NT));
  for (let s = 0; s < 4; s++) {
    if (f.len[s] >= 4 && ms.indexOf(s) < 0 && ps.indexOf(s) < 0 && theirs.indexOf(s) < 0) cand.push(bidCheapest(st, s));
  }
  for (const s of ms) if (f.len[s] >= 5) cand.push(bidCheapest(st, s));
  if (!cand.length) {
    cand.push(bidCheapest(st, NT));
    for (const s of ps) cand.push(bidCheapest(st, s));
  }
  return Math.min.apply(null, cand);
}

function bidNaturalPlan(st, f) {
  const me = st.turn, pa = me ^ 2, rho = (me + 3) & 3, lho = (me + 1) & 3, side = me & 1;
  const P = st.info[pa], pm = st.last[pa], rm = st.last[rho];
  const rhoPassed = !rm || rm.call === PASS;
  const lb = st.lastBid;
  if (lb < 0) return PASS;
  const ours = ((st.lastBidder ^ me) & 1) === 0;
  if (st.doubled && rhoPassed && pm && (pm.call === DBL || pm.call === RDBL) && pm.tag !== 'takeout' && pm.tag !== 'negdbl') return PASS;
  if (ours && rhoPassed && bidLevel(lb) >= 6) return PASS;
  if (ours && rhoPassed && pm && pm.stop) return PASS;
  const forced = bidForced(st);
  const wide = P.hcpMax - P.hcpMin > 6;
  const pMin = P.hcpMin, pMax = wide ? pMin + 3 : P.hcpMax, pMid = (pMin + pMax) / 2;
  const S = bidNatStrain(st, me, f), t = S.trump;
  const pts = bidNatPts(f, t, P);
  const lo = pts + pMin, hi = pts + pMax, mid = pts + pMid;
  const above = function (c) { return c > lb; };
  const theirs = bidTheirSuits(st, me);
  const ntOk = theirs.length === 0 || st.nt[pa] || bidStopAll(f, theirs);     // notrump needs their suit stopped

  // ----- slam -----
  if (lo >= BID_SLAM && (t < 4 || f.balanced || P.bal)) {
    const asked = st.mean.some(function (m) { return (m.seat & 1) === side && m.tag === 'blackwood'; });
    if (t < 4 && !asked) {
      if (lb < mkBid(4, 4) && f.sorted[3] > 0 && bidTrumpGuess(st, side) === t && bidInterpret(st, mkBid(4, 4)).tag === 'blackwood') return mkBid(4, 4);
      if (above(mkBid(6, t)) && f.aces >= 2) return mkBid(6, t);
    } else if (t === NT) {
      const g = lo >= BID_GRAND ? mkBid(7, 4) : mkBid(6, 4);
      if (above(g)) return g;
    }
  }

  // ----- game -----
  let game = bidNatGame(f, t, lo, P);
  if (game === mkBid(3, 4) && !ntOk) game = -1;
  const invited = !!(pm && pm.inv && rhoPassed && ours);
  const I = st.info[me];
  // invited: accept with the upper half of what I have shown, or when the points are simply there
  const upper = I.hcpMax - I.hcpMin <= 6 && pts >= Math.ceil((I.hcpMin + I.hcpMax) / 2) + 1;
  const goGame = game >= 0 && (lo >= BID_GAME || (invited && (mid >= BID_GAME - 0.5 || upper)));
  if (goGame) {
    if (ours && bidIsGame(lb)) {
      if ((t === 2 || t === 3) && bidStrain(lb) !== t && S.total >= 8 && above(game)) return game;   // 3NT -> 4 of the major fit
      return PASS;
    }
    const ex = bidNatExplore(st, f, t, me);
    if (ex >= 0) return ex;
    if (above(game)) return game;
    if (!ours) {
      if (t < 4 && S.total >= 10 && lo >= 27 && bidLevel(lb) <= 4 && above(mkBid(5, t))) return mkBid(5, t);
      if (isLegalCall(st, DBL) && bidLevel(lb) >= 3) return DBL;
    }
    return PASS;
  }
  if (invited && !forced) return PASS;

  // values but no fit: an unbalanced or stopperless hand shows its long suit rather than notrump
  if (t === NT && hi >= BID_GAME && (!f.semiBal || !ntOk)) {
    let ls = -1;
    for (let s = 3; s >= 0; s--) {
      if (theirs.indexOf(s) >= 0 || f.len[s] < (st.suits[me].indexOf(s) >= 0 ? 6 : 5)) continue;
      if (ls < 0 || f.len[s] > f.len[ls]) ls = s;
    }
    if (ls >= 0) {
      const c = bidCheapest(st, ls);
      if (bidLevel(c) <= 3 && !(ours && rhoPassed && bidStrain(lb) === ls)) return c;
    }
  }

  // ----- invitation -----
  if (ours && rhoPassed && !invited && game >= 0 && hi >= BID_GAME && mid >= BID_GAME - 1.5) {
    let inv = -1;
    if (t === 2 || t === 3) {
      const three = mkBid(3, t);
      if (above(three) && (bidCheapest(st, t) < three || lb === mkBid(2, t))) inv = three;
    } else if (above(mkBid(2, 4)) && ntOk && (t === NT || f.semiBal)) inv = mkBid(2, 4);
    else if (t < 2 && above(mkBid(3, t)) && bidCheapest(st, t) < mkBid(3, t)) inv = mkBid(3, t);
    if (inv >= 0 && bidInterpret(st, inv).inv) return inv;
    if (mid >= BID_GAME && above(game)) return game;
  }

  // ----- part score -----
  if (forced) return bidNatForcedBid(st, f, t, me);
  if (ours && rhoPassed) {
    const ps = st.suits[pa], second = bidStrain(lb);
    if (ps.length >= 2 && second < 4 && second !== ps[0] && st.lastBidder === pa) {      // preference between partner's suits
      const first = ps[0];
      if (f.len[first] > f.len[second] || (f.len[first] === f.len[second] && P.lenMin[first] > P.lenMin[second])) {
        const c = bidCheapest(st, first);
        if (bidLevel(c) === bidLevel(lb)) return c;
      }
    }
    return PASS;
  }
  // ----- competing for the part score -----
  if (t < 4 && S.total >= 8) {
    const c = bidCheapest(st, t), L = bidLevel(c);
    if (L <= S.total - 6 && lo >= 16 + 3 * (L - 2) - 2 * (S.total - 8) && !(L >= 4 && seatVul(st.vul, me) && lo < 22)) return c;
  }
  if (!ours && isBid(lb) && bidStrain(lb) < 4) {
    const x = bidStrain(lb);
    // opener, passed back to after an overcall: reopen with shortness in their suit
    if (st.opener === me && st.lastBidder === lho && st.acts[pa] === 0 && rhoPassed && bidLevel(lb) <= 2 && isLegalCall(st, DBL)) {
      let ok = f.len[x] <= 2 && f.hcp >= 12;
      for (let s = 0; s < 4 && ok; s++) if (s !== x && f.len[s] < 3) ok = false;
      if (ok && bidInterpret(st, DBL).tag === 'takeout') return DBL;
    }
    if (bidLevel(lb) >= 2 && lo >= 21 && f.len[x] >= 4 && f.top5[x] >= 2 && isLegalCall(st, DBL) && bidInterpret(st, DBL).tag === 'penalty') return DBL;
  }
  return PASS;
}

function bidNaturalMeaning(st, call) {
  const me = st.turn, pa = me ^ 2, side = me & 1;
  const P = st.info[pa], I = st.info[me];
  const pm = st.last[pa], rm = st.last[(me + 3) & 3];
  const rhoPassed = !rm || rm.call === PASS;
  const lb = st.lastBid, ours = lb >= 0 && ((st.lastBidder ^ me) & 1) === 0;
  const wide = P.hcpMax - P.hcpMin > 6;
  const pMin = P.hcpMin, pMax = wide ? pMin + 3 : P.hcpMax, pMid = (pMin + pMax) / 2;
  const m = { text: '', tag: '', forcing: 0, inv: false, stop: false, art: false, suit: -1, show: { hcp: [0, 37], len: [0, 0, 0, 0], max: [13, 13, 13, 13], bal: false } };
  const atLeast = function (v) { return Math.max(I.hcpMin, Math.min(v, I.hcpMax)); };
  const capNoGame = Math.max(I.hcpMin, BID_GAME - 1 - pMin);
  const forcedNow = bidForced(st);

  if (call === PASS) {
    m.text = 'Pass';
    if (lb < 0) { m.show.hcp = [0, 12]; return m; }
    if (ours && rhoPassed && pm && pm.inv) { m.text = 'Pass: declines the invitation'; m.show.hcp = [0, Math.max(I.hcpMin, Math.floor(BID_GAME - 0.5 - pMid))]; }
    else if (ours && rhoPassed && pm && pm.call !== PASS && !bidIsGame(lb)) { m.text = 'Pass: content with this contract'; m.show.hcp = [0, Math.max(I.hcpMin, BID_GAME + 1 - pMax)]; }
    return m;
  }
  if (call === DBL) {
    const x = lb >= 0 ? bidStrain(lb) : NT;
    if (x < 4 && lb <= mkBid(4, 2) && st.acts[pa] === 0 && st.agreed[side] < 0) {
      m.text = 'Takeout double: asks partner to bid'; m.tag = 'takeout'; m.forcing = 1;
      m.show.hcp = [Math.max(I.hcpMin, 11), 37];
      const theirs = bidTheirSuits(st, me);
      for (let s = 0; s < 4; s++) { if (theirs.indexOf(s) >= 0) m.show.max[s] = 3; else if (st.suits[me].indexOf(s) < 0) m.show.len[s] = 3; }
    } else { m.text = 'Penalty double'; m.tag = 'penalty'; }
    return m;
  }
  if (call === RDBL) { m.text = 'Redouble: values'; m.tag = 'redbl'; m.show.hcp = [atLeast(10), 37]; return m; }

  const L = bidLevel(call), s = bidStrain(call);
  const contested = !(ours && rhoPassed);
  if (s === NT) {
    if (L === 4) {
      const pNT = !!pm && isBid(pm.call) && bidStrain(pm.call) === NT && !pm.art;
      if (pNT && st.agreed[side] < 0) { m.text = 'Quantitative: invites 6NT'; m.tag = 'quant'; m.inv = true; m.show.hcp = [atLeast(BID_SLAM - pMax - 1), 37]; }
      else { m.text = 'Blackwood: asks for aces'; m.tag = 'blackwood'; m.forcing = 1; m.art = true; }
      return m;
    }
    if (L >= 5) { m.text = 'To play'; m.stop = L >= 6; return m; }
    if (L === 3) { m.text = 'To play'; m.show.hcp = [atLeast(Math.ceil(BID_GAME - 0.5 - pMid) - 1), 37]; return m; }
    if (L === 2 && forcedNow) { m.text = 'Natural: no better bid'; return m; }
    if (L === 2) { m.text = 'Natural, invitational'; m.inv = !contested; m.show.hcp = [atLeast(BID_GAME - pMax - 1), Math.max(I.hcpMin, BID_GAME - 1 - pMin)]; return m; }
    m.text = 'Natural: minimum values'; m.show.hcp = [I.hcpMin, capNoGame];
    return m;
  }
  const theirs = bidTheirSuits(st, me);
  const pSuit = st.suits[pa].indexOf(s) >= 0 || P.lenMin[s] >= 4, mine = st.suits[me].indexOf(s) >= 0;
  if (theirs.indexOf(s) >= 0 && !pSuit && !mine) {
    m.text = 'Cue bid of their suit: strong hand, forcing'; m.forcing = 1; m.art = true; m.show.hcp = [atLeast(11), 37];
    return m;
  }
  m.suit = s;
  const jump = call > bidCheapest(st, s);
  if (pSuit) {
    const pref = st.suits[pa].length >= 2 && !jump;
    m.show.len[s] = pref ? 2 : Math.max(2, Math.min(4, 8 - P.lenMin[s]));
    if (!pref) m.agree = s;
  } else if (mine) m.show.len[s] = Math.min(7, Math.max(5, I.lenMin[s] + 1));
  else m.show.len[s] = L >= 3 ? 5 : 4;
  if (L >= 6) { m.text = 'To play'; m.stop = true; return m; }
  if (bidIsGame(call)) { m.text = 'To play'; m.show.hcp = [atLeast(Math.ceil(BID_GAME - 0.5 - pMid) - 3), 37]; return m; }
  if (!contested && L === 3 && s >= 2 && (pSuit || mine) && !(forcedNow && !jump)) {
    m.inv = true; m.text = 'Invitational: bid game with extra values';
    m.show.hcp = [atLeast(BID_GAME - pMax - 2), Math.max(I.hcpMin, BID_GAME - 1 - pMin)];
    return m;
  }
  if (!pSuit && !mine) {
    if (st.mean.some(function (x) { return x.seat === me && x.tag === 'takeout'; })) {   // doubled first, now bids a suit
      m.show.len[s] = 5; m.show.hcp = [atLeast(17), 37];
      m.text = 'Strong hand: 17+ points with 5+ ' + BID_SUIT_WORD[s];
      return m;
    }
    const unlimited = I.hcpMax - I.hcpMin > 6 && I.hcpMax > 12;
    if (unlimited && st.acts[pa] > 0) { m.forcing = 1; m.text = 'Natural: ' + m.show.len[s] + '+ ' + BID_SUIT_WORD[s] + '. Forcing.'; }
    else m.text = 'Natural: ' + m.show.len[s] + '+ ' + BID_SUIT_WORD[s];
    return m;
  }
  if (contested) { m.text = pSuit ? 'Competitive raise' : 'Competitive rebid of the suit'; return m; }
  if (jump) { m.inv = true; m.text = 'Jump: extra values (invitational)'; m.show.hcp = [atLeast(BID_GAME - pMax - 2), Math.max(I.hcpMin, BID_GAME - 1 - pMin)]; return m; }
  m.text = pSuit ? 'Support for partner, minimum values' : 'Rebid: extra length, minimum values';
  m.show.hcp = [I.hcpMin, capNoGame];
  return m;
}
