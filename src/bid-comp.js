// ===== bid-comp.js — competitive bidding: overcalls, takeout doubles, advances, bidding over interference =====

function bidTheirSuits(st, me) {
  const out = [];
  for (const seat of [(me + 3) & 3, (me + 1) & 3]) {
    for (const s of st.suits[seat]) if (out.indexOf(s) < 0) out.push(s);
  }
  return out;
}
function bidCheapest(st, strain) {                      // lowest bid of a strain above the last bid
  if (st.lastBid < 0) return mkBid(1, strain);
  const l = bidLevel(st.lastBid);
  return mkBid(strain > bidStrain(st.lastBid) ? l : l + 1, strain);
}
function bidLongestOf(f, list) {                        // longest of the listed suits, higher of equals
  let b = -1;
  for (const s of list) if (b < 0 || f.len[s] > f.len[b] || (f.len[s] === f.len[b] && s > b)) b = s;
  return b;
}
function bidBestUnbid(f, unbid) {                       // suit to bid in reply to a takeout double
  let m = -1;
  for (const s of unbid) if (s >= 2 && f.len[s] >= 4 && (m < 0 || f.len[s] >= f.len[m])) m = s;
  if (m >= 0) return m;
  let b = -1;
  for (const s of unbid) if (b < 0 || f.len[s] > f.len[b]) b = s;
  return b;
}
function bidTakeoutShape(f, theirs, unbid) {
  for (const s of theirs) if (f.len[s] > (theirs.length === 1 ? 2 : 3)) return false;
  for (const s of unbid) if (f.len[s] < (unbid.length <= 2 ? 4 : 3)) return false;
  return true;
}
function bidStopAll(f, theirs) {
  for (const s of theirs) if (!f.stop[s]) return false;
  return theirs.length > 0;
}

// Opponents opened and our side has not acted yet (direct seat, balancing seat, or after their response).
function bidOvercallRules(st, me) {
  const lho = (me + 1) & 3, rho = (me + 3) & 3, pa = me ^ 2;
  const lb = st.lastBid, lvl = bidLevel(lb), str = bidStrain(lb);
  const lm = st.last[st.lastBidder];
  if (st.doubled || (lm && lm.art)) return null;
  const theirs = bidTheirSuits(st, me);
  const unbid = [0, 1, 2, 3].filter(function (s) { return theirs.indexOf(s) < 0; });
  const lp = st.last[pa], lr = st.last[rho];
  const balancing = st.lastBidder === lho && !!lp && lp.call === PASS && !!lr && lr.call === PASS;
  const adj = balancing && lvl <= 2 ? 3 : 0;         // balancing seat acts on 3 points less, at low levels only
  const R = [];
  if (str === NT) {
    if (st.opener === rho && lvl === 1 && st.acts[lho] === 0) {           // directly over their 1NT opening
      R.push({ call: DBL, hcp: [16, 37], text: 'Penalty double: 16+ points', tag: 'penalty' });
      for (let s = 3; s >= 0; s--) {
        R.push({
          call: mkBid(2, s), hcp: [9, 15], len: bLen(s, 5),
          when: function (f) { return bidLongestOf(f, [0, 1, 2, 3]) === s && (f.len[s] >= 6 || (bidSuitOk(f, s) && f.sorted[1] >= 4)); },
          text: 'Overcall: long ' + bidWord(s), tag: 'overcall'
        });
      }
    }
    R.push({ call: PASS, hcp: [0, 15], text: 'Pass' });
    return R;
  }
  const stops = function (f) { return bidStopAll(f, theirs); };
  if (lvl === 1) R.push({ call: mkBid(1, 4), hcp: [15 - adj, 18 - adj], bal: 1, when: stops, text: (15 - adj) + '–' + (18 - adj) + ' points, balanced, with a stopper in their suit', tag: 'ntOvercall' });
  else if (lvl === 2) R.push({ call: mkBid(2, 4), hcp: [15, 18], bal: 1, when: stops, text: '15–18 points, balanced, with a stopper in their suit', tag: 'ntOvercall' });
  else if (lvl === 3) R.push({ call: mkBid(3, 4), hcp: [17, 37], when: function (f) { return f.semiBal && stops(f); }, text: 'To play', stop: 1 });
  const canDbl = lb <= mkBid(4, 2);
  const minD = (lvl === 1 ? 12 : lvl === 2 ? 13 : lvl === 3 ? 15 : 17) - adj;
  const dblShow = { hcp: [minD, 37], len: [0, 0, 0, 0], max: [13, 13, 13, 13] };
  for (const s of unbid) dblShow.len[s] = 3;
  for (const s of theirs) dblShow.max[s] = 3;
  if (canDbl) R.push({ call: DBL, hcp: [17, 37], show: dblShow, text: 'Takeout double: asks partner to bid; opening values or better', tag: 'takeout', forcing: 1 });
  const over = function (s) {
    const c = bidCheapest(st, s), L = bidLevel(c);
    if (L > 3) return;
    const lo = (L === 1 ? 8 : L === 2 ? 11 : 13) - adj;
    R.push({
      call: c, hcp: [lo, 16],
      when: function (f) {
        if (f.len[s] < 5 || bidLongestOf(f, unbid) !== s) return false;
        if (L === 1) return f.hcp >= 11 || bidSuitOk(f, s);
        if (L === 2) return bidSuitOk(f, s) && (f.len[s] >= 6 || f.hcp >= 12 - adj);
        return bidSuitOk(f, s) && (f.len[s] >= 6 || (f.top3[s] >= 2 && f.hcp >= 13));
      },
      show: { hcp: [lo, 16], len: bLen(s, 5) }, tag: 'overcall',
      text: 'Overcall: 5+ ' + bidWord(s) + ', ' + lo + '–16 points'
    });
  };
  for (const s of [3, 2]) if (unbid.indexOf(s) >= 0) over(s);
  if (canDbl) R.push({ call: DBL, hcp: [minD, 37], when: function (f) { return bidTakeoutShape(f, theirs, unbid); }, show: dblShow, text: 'Takeout double: asks partner to bid; opening values or better', tag: 'takeout', forcing: 1 });
  for (const s of [1, 0]) if (unbid.indexOf(s) >= 0) over(s);
  if (!balancing && lvl === 1) {
    for (const s of unbid) {
      const c = bidCheapest(st, s) + 5, L = bidLevel(c);
      if (L > 3) continue;
      const n = L === 2 ? 6 : 7;
      R.push({ call: c, hcp: [5, 10], when: function (f) { return f.len[s] === n && bidSuitOk(f, s); }, show: { hcp: [5, 10], len: bLen(s, n) }, text: 'Weak jump overcall: ' + n + ' ' + bidWord(s) + ', 5–10 points', tag: 'weakJump' });
    }
  }
  R.push({ call: PASS, hcp: [0, 16], text: 'Pass' });
  return R;
}

// Partner overcalled in a suit.
function bidAdvanceOvercall(st, me) {
  const pc = st.last[me ^ 2].call, o = bidStrain(pc), L = bidLevel(pc);
  const theirs = bidTheirSuits(st, me);
  const R = [];
  if (theirs.length) {
    const cue = bidCheapest(st, theirs[0]);
    if (bidLevel(cue) <= L + 1) R.push({ call: cue, len: bLen(o, 3), sp: [11, 40, o], show: { hcp: [9, 37], len: bLen(o, 3) }, text: 'Cue bid: limit raise or better in ' + bidWord(o), tag: 'cueRaise', forcing: 1, art: 1, agree: o });
  }
  if (L + 2 <= 4) R.push({ call: mkBid(L + 2, o), len: bLen(o, 4), hcp: [0, 8], when: function (f) { return f.sorted[3] <= 1; }, text: 'Preemptive raise: 4+ trumps, weak hand', stop: 1, agree: o });
  R.push({ call: mkBid(L + 1, o), len: bLen(o, 3), sp: [6, 10, o], show: { hcp: [5, 10], len: bLen(o, 3) }, text: 'Raise: 6–10 points, 3+ trumps', tag: 'raise1', agree: o });
  for (let s = 3; s >= 0; s--) {
    if (s === o || theirs.indexOf(s) >= 0) continue;
    const c = bidCheapest(st, s);
    if (bidLevel(c) > 2) continue;
    R.push({ call: c, len: bLen(s, 5), hcp: [9, 15], when: function (f) { return bidSuitOk(f, s) && f.len[o] < 3; }, text: 'Natural: 5+ ' + bidWord(s) + ', 9+ points (not forcing)' });
  }
  const stops = function (f) { return bidStopAll(f, theirs); };
  R.push({ call: mkBid(1, 4), hcp: [8, 11], when: stops, text: '8–11 points with a stopper in their suit' });
  R.push({ call: mkBid(2, 4), hcp: [12, 14], when: stops, text: '12–14 points with a stopper (invitational)', inv: 1 });
  R.push({ call: mkBid(3, 4), hcp: [15, 18], when: stops, text: 'To play', stop: 1 });
  R.push({ call: PASS, hcp: [0, 13], text: 'Pass' });
  return R;
}
// Partner showed a limit raise or better (cue bid or Jordan 2NT) in our agreed suit.
function bidAfterCueRaise(st, me) {
  const o = st.agreed[me & 1];
  if (o < 0) return null;
  const thr = st.info[me].hcpMin + 4;
  const R = [];
  if (o >= 2) R.push({ call: mkBid(4, o), when: function (f) { return bidFitPts(f, o) >= thr; }, show: { hcp: [thr - 2, 37] }, text: 'Bids game: more than a minimum', stop: 1 });
  else { const theirs = bidTheirSuits(st, me); R.push({ call: mkBid(3, 4), when: function (f) { return bidFitPts(f, o) >= thr && bidStopAll(f, theirs); }, show: { hcp: [thr - 2, 37] }, text: 'To play', stop: 1 }); }
  R.push({ call: bidCheapest(st, o), show: { hcp: [0, thr] }, text: 'Minimum: no game interest' });
  return R;
}

// Partner made a takeout double.
function bidAdvanceDouble(st, me, rhoPassed) {
  const theirs = bidTheirSuits(st, me);
  const unbid = [0, 1, 2, 3].filter(function (s) { return theirs.indexOf(s) < 0; });
  if (!unbid.length || st.lastBid < 0) return null;
  const best = function (f) { return bidBestUnbid(f, unbid); };
  const stops = function (f) { return bidStopAll(f, theirs); };
  const R = [];
  if (rhoPassed && theirs.length === 1) {
    const t = theirs[0];
    R.push({ call: PASS, when: function (f) { return f.len[t] >= 5 && f.top5[t] >= 3; }, show: { len: bLen(t, 5) }, text: 'Pass for penalty: long, strong trumps' });
  }
  if (rhoPassed && bidLevel(st.lastBid) >= 4) {         // a double of a four-level bid is left in without a long suit
    R.push({ call: PASS, when: function (f) { return f.len[best(f)] < 5; }, text: 'Pass: leaves the double in' });
  }
  for (const s of unbid) {
    if (s < 2) continue;
    R.push({ call: mkBid(4, s), hcp: [12, 37], when: function (f) { return best(f) === s && f.len[s] >= 4; }, show: { hcp: [12, 37], len: bLen(s, 4) }, text: 'To play', stop: 1 });
  }
  R.push({ call: mkBid(3, 4), hcp: [13, 37], when: stops, text: 'To play', stop: 1 });
  for (const s of unbid) {
    const j = bidCheapest(st, s) + 5;
    if (bidLevel(j) > 3) continue;
    R.push({ call: j, hcp: [9, 37], when: function (f) { return best(f) === s; }, show: { hcp: [9, 11], len: bLen(s, 4) }, text: 'Jump reply: 9–11 points (invitational)', inv: 1 });
  }
  const nt = bidCheapest(st, NT);
  if (bidLevel(nt) === 1) R.push({ call: nt, hcp: [6, 10], when: function (f) { return stops(f) && best(f) < 2; }, text: '6–10 points with a stopper in their suit' });
  const lo = rhoPassed ? 0 : 6;
  for (const s of unbid) {
    if (!rhoPassed && bidLevel(bidCheapest(st, s)) > 3) continue;
    R.push({ call: bidCheapest(st, s), hcp: [lo, 8], when: function (f) { return best(f) === s && (rhoPassed || f.len[s] >= 4); }, show: { hcp: [lo, 8], len: bLen(s, 3) }, text: rhoPassed ? 'Reply to the double: 0–8 points, best suit' : 'Free bid: 6–8 points' });
  }
  for (const s of unbid) {                               // stronger hands with no jump available
    if (!rhoPassed && bidLevel(bidCheapest(st, s)) > 4) continue;
    R.push({ call: bidCheapest(st, s), hcp: [9, 37], when: function (f) { return best(f) === s && (rhoPassed || f.len[s] >= 4); }, show: { hcp: [lo, 11], len: bLen(s, 3) }, text: 'Reply to the double' });
  }
  if (!rhoPassed) R.push({ call: PASS, text: 'Pass: nothing to add' });
  return R;
}

function bidNegDblOk(f, o, x, xl) {
  const um = [2, 3].filter(function (s) { return s !== o && s !== x; });
  if (um.length === 2) {
    if (xl === 1) return f.len[2] >= 4 && f.len[3] >= 4;
    return (f.len[2] >= 4 && f.len[3] >= 3) || (f.len[3] >= 4 && f.len[2] >= 3);
  }
  if (um.length === 1) {
    const M = um[0];
    if (o < 2 && x === 2 && xl === 1) return f.len[3] === 4;              // 1m-(1H): exactly four spades
    return f.len[M] >= 4 && !(f.len[M] >= 5 && f.hcp >= 10);
  }
  return f.len[0] >= 4 && f.len[1] >= 4;
}
// Partner opened one of a suit and right-hand opponent overcalled in a suit.
function bidRespAfterOvercall(st, me, rm) {
  const o = bidStrain(st.last[me ^ 2].call), x = bidStrain(rm.call), xl = bidLevel(rm.call);
  const need = o >= 2 ? 3 : o === 1 ? 4 : 5;
  const R = [];
  const cue = bidCheapest(st, x), raise = bidCheapest(st, o);
  if (bidLevel(cue) <= 3) R.push({ call: cue, len: bLen(o, need), sp: [10, 40, o], show: { hcp: [9, 37], len: bLen(o, need) }, text: 'Cue bid: limit raise or better in ' + bidWord(o), tag: 'cueRaise', forcing: 1, art: 1, agree: o });
  if (bidLevel(raise) === 2) R.push({ call: mkBid(3, o), len: bLen(o, need + 1), hcp: [0, 8], text: 'Preemptive raise: weak hand, long trumps', stop: 1, agree: o });
  if (bidLevel(raise) <= 3) R.push({ call: raise, len: bLen(o, need), sp: [bidLevel(raise) === 2 ? 6 : 8, 10, o], show: { hcp: [5, 10], len: bLen(o, need) }, text: 'Raise: 6–10 points with support', tag: 'raise1', agree: o });
  if (xl <= 3) {
    const minH = xl === 1 ? 6 : xl === 2 ? 8 : 10;
    const um = [2, 3].filter(function (s) { return s !== o && s !== x; });
    const sh = { hcp: [minH, 37], len: um.length === 1 ? bLen(um[0], 4) : um.length === 2 ? [0, 0, 3, 3] : [4, 4, 0, 0] };
    R.push({ call: DBL, hcp: [minH, 37], when: function (f) { return bidNegDblOk(f, o, x, xl); }, show: sh, text: um.length ? 'Negative double: 4+ cards in the unbid major' + (um.length === 2 ? 's' : '') + ', ' + minH + '+ points' : 'Negative double: both minors, ' + minH + '+ points', tag: 'negdbl', forcing: 1 });
  }
  for (let s = 3; s >= 0; s--) {
    if (s === o || s === x) continue;
    const c = bidCheapest(st, s), L = bidLevel(c);
    if (L === 1) R.push({ call: c, len: bLen(s, s === 3 && x === 2 ? 5 : 4), hcp: [6, 37], text: 'Natural: ' + (s === 3 && x === 2 ? '5+ ' : '4+ ') + bidWord(s) + ', 6+ points. Forcing.', tag: 'respFree', forcing: 1 });
    else if (L === 2) R.push({ call: c, len: bLen(s, 5), hcp: [10, 37], text: 'Natural: 5+ ' + bidWord(s) + ', 10+ points. Forcing.', tag: 'respFree', forcing: 1 });
  }
  const st1 = function (f) { return f.stop[x]; };
  R.push({ call: mkBid(1, 4), hcp: [7, 10], when: st1, text: '7–10 points with a stopper in their suit' });
  R.push({ call: mkBid(2, 4), hcp: [11, 12], when: st1, text: '11–12 points with a stopper (invitational)', inv: 1 });
  R.push({ call: mkBid(3, 4), hcp: [13, 16], when: st1, text: 'To play', stop: 1 });
  R.push({ call: PASS, hcp: [0, 12], text: 'Pass' });
  return R;
}
// Partner opened one of a suit and right-hand opponent made a takeout double.
function bidRespAfterDouble(st, me) {
  const o = bidStrain(st.last[me ^ 2].call);
  const need = o >= 2 ? 3 : o === 1 ? 4 : 5;
  const R = [];
  R.push({ call: mkBid(2, 4), len: bLen(o, need + 1), sp: [10, 40, o], show: { hcp: [8, 37], len: bLen(o, need + 1) }, text: 'Jordan 2NT: limit raise or better with trump support', tag: 'cueRaise', forcing: 1, art: 1, agree: o });
  R.push({ call: RDBL, hcp: [10, 37], text: 'Redouble: 10+ points', tag: 'redbl' });
  R.push({ call: mkBid(3, o), len: bLen(o, need + 1), hcp: [0, 7], text: 'Preemptive raise: weak hand, long trumps', stop: 1, agree: o });
  R.push({ call: mkBid(2, o), len: bLen(o, need), sp: [5, 9, o], show: { hcp: [4, 9], len: bLen(o, need) }, text: 'Raise: 6–9 points with support', tag: 'raise1', agree: o });
  for (let s = o + 1; s <= 3; s++) R.push({ call: mkBid(1, s), len: bLen(s, 4), hcp: [6, 9], text: 'Natural: 4+ ' + bidWord(s) + ', 6–9 points', tag: 'respFree', forcing: 1 });
  R.push({ call: mkBid(1, 4), hcp: [6, 9], text: '6–9 points, no fit' });
  for (let s = o - 1; s >= 0; s--) R.push({ call: mkBid(2, s), len: bLen(s, 6), hcp: [4, 9], text: 'To play: long ' + bidWord(s) + ', weak hand', stop: 1 });
  R.push({ call: PASS, hcp: [0, 9], text: 'Pass' });
  return R;
}
// Partner opened (or overcalled) 1NT and right-hand opponent came in.
function bidRespNTInterference(st, me, rm) {
  const R = [];
  if (rm.call === DBL) {
    for (let s = 3; s >= 0; s--) R.push({ call: mkBid(2, s), len: bLen(s, 5), hcp: [0, 7], when: function (f) { return bidLongestOf(f, [0, 1, 2, 3]) === s; }, text: 'To play: 5+ ' + bidWord(s) + ', weak hand', stop: 1 });
    R.push({ call: PASS, hcp: [0, 37], text: 'Pass' });
    return R;
  }
  if (!isBid(rm.call) || bidStrain(rm.call) === NT || bidLevel(rm.call) > 2) return null;
  const x = bidStrain(rm.call);
  const st1 = function (f) { return f.stop[x]; };
  R.push({ call: mkBid(3, 4), hcp: [10, 15], when: st1, text: 'To play', stop: 1 });
  for (let s = 3; s >= 0; s--) {
    if (s === x) continue;
    const c = bidCheapest(st, s);
    if (bidLevel(c) === 2) {
      R.push({ call: mkBid(3, s), len: bLen(s, 5), hcp: [10, 37], text: 'Natural: 5+ ' + bidWord(s) + '. Forcing to game.', forcing: 2 });
      R.push({ call: c, len: bLen(s, 5), hcp: [0, 9], text: 'To play: 5+ ' + bidWord(s), stop: 1 });
    } else {
      R.push({ call: c, len: bLen(s, 5), hcp: [10, 37], text: 'Natural: 5+ ' + bidWord(s) + '. Forcing to game.', forcing: 2 });
    }
  }
  R.push({ call: DBL, hcp: [8, 37], when: function (f) { return f.len[x] >= 3; }, show: { hcp: [8, 37] }, text: 'Penalty double', tag: 'penalty' });
  R.push({ call: mkBid(2, 4), hcp: [8, 9], when: st1, text: 'Invitational, with a stopper', inv: 1 });
  R.push({ call: PASS, hcp: [0, 37], text: 'Pass' });
  return R;
}
