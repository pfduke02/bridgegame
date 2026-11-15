// ===== bid-open.js — opening bids, first responses, notrump conventions, strong 2C, preempts =====
// Standard American style: 5-card majors, 15-17 1NT, 20-21 2NT, strong artificial 2C, weak twos.

function bS(s) { return SUIT_SYM[s]; }

// Suit to open at the one level, or -1 if the hand should not open one of a suit.
function bidOpenSuit(f, pos) {
  const h = f.hcp;
  if (h > 21) return -1;
  let ok = h >= 12 || (h >= 10 && h + f.sorted[0] + f.sorted[1] >= 20);          // rule of 20
  if (!ok && pos === 2 && h >= 10) {                                               // third seat: light with a good suit
    for (let s = 0; s < 4; s++) if (f.len[s] >= 5 && f.top3[s] >= 2) ok = true;
  }
  if (pos === 3 && h < 13) ok = h >= 10 && h + f.len[3] >= 15;                     // fourth seat: rule of 15
  if (!ok) return -1;
  let best = -1;
  for (let s = 3; s >= 0; s--) if (f.len[s] >= 5 && (best < 0 || f.len[s] > f.len[best])) best = s;
  if (best >= 0) return best;                                                      // longest suit, higher of equals
  if (f.len[1] > f.len[0]) return 1;
  if (f.len[0] > f.len[1]) return 0;
  return f.len[1] >= 4 ? 1 : 0;                                                    // 4-4 minors 1D, 3-3 minors 1C
}

function bidOpenRules(st) {
  const pos = st.n;                       // passes so far
  const R = [];
  R.push({ call: mkBid(2, 0), hcp: [22, 37], text: 'Strong and artificial: 22+ points, any shape. Forcing.', tag: 'open2c', forcing: 1, art: 1 });
  R.push({ call: mkBid(2, 4), hcp: [20, 21], bal: 1, text: '20–21 points, balanced', tag: 'open2n' });
  R.push({ call: mkBid(1, 4), hcp: [15, 17], bal: 1, text: '15–17 points, balanced', tag: 'open1n' });
  for (let s = 3; s >= 0; s--) {
    R.push({
      call: mkBid(1, s), when: function (f) { return bidOpenSuit(f, pos) === s; },
      show: { hcp: [pos >= 2 ? 10 : 11, 21], len: bLen(s, s >= 2 ? 5 : 3) }, tag: 'open1',
      text: s >= 2 ? 'Opening bid: 5+ ' + BID_SUIT_WORD[s] + ', about 12–21 points' : 'Opening bid: 3+ ' + BID_SUIT_WORD[s] + ', about 12–21 points'
    });
  }
  if (pos < 3) {
    for (let s = 3; s >= 1; s--) {
      R.push({
        call: mkBid(2, s), hcp: [5, 10],
        when: function (f) {
          if (f.len[s] !== 6 || !bidSuitOk(f, s) || f.sorted[3] === 0) return false;
          for (let m = 2; m <= 3; m++) if (m !== s && f.len[m] >= 4) return false;   // no side 4-card major
          return true;
        },
        show: { hcp: [5, 10], len: bLen(s, 6), max: bMax(s, 6) }, tag: 'weak2',
        text: 'Weak two: 6 ' + BID_SUIT_WORD[s] + ', 5–10 points'
      });
    }
    for (let s = 3; s >= 0; s--) {
      R.push({
        call: mkBid(4, s), hcp: [4, 10], when: function (f) { return f.len[s] >= 8; },
        show: { hcp: [4, 10], len: bLen(s, 8) }, tag: 'preempt', text: 'Preempt: 8+ ' + BID_SUIT_WORD[s] + ', weak hand'
      });
      R.push({
        call: mkBid(3, s), hcp: [4, 10], when: function (f) { return f.len[s] === 7 && f.top5[s] >= 2; },
        show: { hcp: [4, 10], len: bLen(s, 7) }, tag: 'preempt', text: 'Preempt: 7 ' + BID_SUIT_WORD[s] + ', weak hand'
      });
    }
  }
  R.push({ call: PASS, hcp: [0, 21], show: { hcp: [0, 12] }, text: 'Pass: not enough to open' });
  return R;
}

// Two-over-one response: longest lower-ranking suit (2H needs five), or -1.
function bidPick2o1(f, o) {
  let best = -1;
  for (let s = 0; s < o; s++) {
    const need = s === 2 ? 5 : 4;
    if (f.len[s] >= need && (best < 0 || f.len[s] > f.len[best])) best = s;
  }
  if (best < 0 && f.hcp >= 12 && o >= 2) best = f.len[1] > f.len[0] ? 1 : 0;      // game values, no real suit: best minor
  return best;
}
// One-level response to a minor opening: 1D / 1H / 1S, or -1.
function bidPickResp1(f, o) {
  const h = f.len[2], s = f.len[3], d = f.len[1];
  if (o === 0 && d >= 5 && d > h && d > s && f.hcp >= 10) return 1;                // long diamonds first with real values
  if (h >= 4 || s >= 4) { if (s > h) return 3; if (h > s) return 2; return h >= 5 ? 3 : 2; }
  if (o === 0 && d >= 4) return 1;
  return -1;
}

// Responses to one of a suit, right-hand opponent passing.
function bidRespTo1(st, me) {
  const o = bidStrain(st.last[me ^ 2].call);
  const passed = st.callCount[me] > 0;
  const R = [];
  if (o >= 2) {
    if (!passed) R.push({ call: mkBid(2, 4), len: bLen(o, 4), sp: [13, 40, o], show: { hcp: [11, 37], len: bLen(o, 4) }, text: 'Jacoby 2NT: game-forcing raise with 4+ trumps', tag: 'jacoby2n', forcing: 2, art: 1, agree: o });
    R.push({ call: mkBid(3, o), len: bLen(o, 3), sp: [10, passed ? 15 : 12, o], show: { hcp: [8, 12], len: bLen(o, 3) }, text: 'Limit raise: 10–12 points with trump support (invitational)', tag: 'limit', inv: 1, agree: o });
    R.push({ call: mkBid(4, o), len: bLen(o, 5), hcp: [0, 9], when: function (f) { return f.sorted[3] <= 1; }, text: 'Raise to game on shape: 5+ trumps, weak hand', stop: 1, agree: o });
    R.push({ call: mkBid(2, o), len: bLen(o, 3), sp: [6, 9, o], show: { hcp: [4, 9], len: bLen(o, 3) }, text: 'Single raise: 6–9 points, 3+ trumps', tag: 'raise1', agree: o });
    if (o === 2) R.push({ call: mkBid(1, 3), len: bLen(3, 4), hcp: [6, 37], text: '4+ spades, 6+ points. Forcing.', tag: 'resp1', forcing: 1 });
    for (let s = o - 1; s >= 0; s--) {
      R.push({
        call: mkBid(2, s), hcp: [10, 37], when: function (f) { return bidPick2o1(f, o) === s; },
        show: { hcp: [10, 37], len: bLen(s, s === 2 ? 5 : 3) }, tag: 'resp2o1', forcing: 1,
        text: (s === 2 ? '5+ ' : '4+ ') + BID_SUIT_WORD[s] + ', 10+ points. Forcing.'
      });
    }
    R.push({ call: mkBid(1, 4), hcp: [6, 10], text: '6–10 points, no fit, nothing to bid at the one level', tag: 'resp1n' });
    R.push({ call: PASS, hcp: [0, 5], text: 'Pass: fewer than 6 points' });
    return R;
  }
  for (let s = 2; s <= 3; s++) {
    R.push({ call: mkBid(1, s), hcp: [6, 37], when: function (f) { return bidPickResp1(f, o) === s; }, show: { hcp: [6, 37], len: bLen(s, 4) }, text: '4+ ' + BID_SUIT_WORD[s] + ', 6+ points. Forcing.', tag: 'resp1', forcing: 1 });
  }
  if (o === 0) R.push({ call: mkBid(1, 1), hcp: [6, 37], when: function (f) { return bidPickResp1(f, o) === 1; }, show: { hcp: [6, 37], len: bLen(1, 4) }, text: '4+ diamonds, 6+ points. Forcing.', tag: 'resp1', forcing: 1 });
  const noMajor = bMax(2, 3, 3, 3);
  R.push({ call: mkBid(3, 4), hcp: [13, 15], bal: 1, show: { hcp: [13, 15], bal: 1, max: noMajor }, text: '13–15 points, balanced, no 4-card major', stop: 1 });
  R.push({ call: mkBid(2, 4), hcp: [11, 12], bal: 1, show: { hcp: [11, 12], bal: 1, max: noMajor }, text: '11–12 points, balanced, no 4-card major (invitational)', inv: 1 });
  const need = o === 1 ? 4 : 5;
  R.push({ call: mkBid(3, o), len: bLen(o, need), sp: [10, 12, o], show: { hcp: [9, 12], len: bLen(o, need), max: noMajor }, text: 'Limit raise: 10–12 points with ' + need + '+ card support (invitational)', tag: 'limit', inv: 1, agree: o });
  if (o === 1) R.push({ call: mkBid(2, 0), hcp: [10, 37], len: bLen(0, 4), show: { hcp: [10, 37], len: bLen(0, 4), max: noMajor }, text: '4+ clubs, 10+ points. Forcing.', tag: 'resp2o1', forcing: 1 });
  R.push({ call: mkBid(2, o), len: bLen(o, need), sp: [6, 9, o], show: { hcp: [5, 9], len: bLen(o, need), max: noMajor }, text: 'Single raise: 6–9 points with ' + need + '+ card support', tag: 'raise1', agree: o });
  R.push({ call: mkBid(1, 4), hcp: [6, 10], show: { hcp: [6, 10], max: noMajor }, text: '6–10 points, no 4-card major', tag: 'resp1n' });
  R.push({ call: mkBid(3, 4), hcp: [13, 17], show: { hcp: [13, 17], max: noMajor }, text: 'Game values, no 4-card major', stop: 1 });
  R.push({ call: mkBid(2, 4), hcp: [11, 12], show: { hcp: [11, 12], max: noMajor }, text: '11–12 points, no 4-card major (invitational)', inv: 1 });
  R.push({ call: PASS, hcp: [0, 5], text: 'Pass: fewer than 6 points' });
  return R;
}

// ---------- notrump structure: Stayman, Jacoby transfers, minor relay ----------
// How responder treats a notrump bid: 'TH'/'TS' transfer, 'ST' Stayman, 'MIN' weak long minor, '' natural.
function bidNTShape(f, inv) {
  const h = f.len[2], s = f.len[3];
  if (h >= 5 || s >= 5) {
    if (h >= 5 && s >= 5) return s >= h ? 'TS' : 'TH';
    const other = h >= 5 ? s : h;
    if (other === 4 && f.hcp >= inv) return 'ST';
    return h >= 5 ? 'TH' : 'TS';
  }
  if ((h === 4 || s === 4) && f.hcp >= inv) return 'ST';
  if (f.hcp < inv && (f.len[0] >= 6 || f.len[1] >= 6)) return 'MIN';
  return '';
}
// lo..hi = opener's range, lv = level of the notrump bid being answered (1 or 2).
function bidRespToNT(st, me, lo, hi, lv) {
  const inv = BID_GAME - hi, gf = BID_GAME - lo, qi = BID_SLAM - hi, sl = BID_SLAM - lo, gr = BID_GRAND - lo;
  const L = lv + 1, R = [];
  const shp = function (k) { return function (f) { return bidNTShape(f, inv) === k; }; };
  R.push({ call: mkBid(L, 1), when: shp('TH'), show: { len: bLen(2, 5) }, text: 'Transfer: 5+ hearts. Partner bids ' + L + bS(2) + '.', tag: 'transfer', forcing: 1, art: 1, suit: 2 });
  R.push({ call: mkBid(L, 2), when: shp('TS'), show: { len: bLen(3, 5) }, text: 'Transfer: 5+ spades. Partner bids ' + L + bS(3) + '.', tag: 'transfer', forcing: 1, art: 1, suit: 3 });
  R.push({ call: mkBid(L, 0), when: shp('ST'), show: { hcp: [inv, 37] }, text: 'Stayman: asks for a 4-card major', tag: 'stayman', forcing: 1, art: 1 });
  if (lv === 1) {
    R.push({ call: mkBid(2, 3), when: shp('MIN'), show: { hcp: [0, inv - 1] }, text: 'Relay to 3' + bS(0) + ': weak hand with a long minor', tag: 'minorRelay', forcing: 1, art: 1 });
    R.push({ call: mkBid(2, 4), hcp: [inv, gf - 1], text: 'Invitational: ' + inv + '–' + (gf - 1) + ' points', inv: 1 });
  }
  R.push({ call: mkBid(3, 4), hcp: [gf, qi - 1], text: 'To play', stop: 1 });
  R.push({ call: mkBid(4, 4), hcp: [qi, sl - 1], text: 'Quantitative: bid 6NT with a maximum', inv: 1, tag: 'quant' });
  R.push({ call: mkBid(6, 4), hcp: [sl, gr - 1], text: 'To play', stop: 1 });
  R.push({ call: mkBid(7, 4), hcp: [gr, 37], text: 'To play', stop: 1 });
  R.push({ call: PASS, hcp: [0, (lv === 1 ? inv : gf) - 1], text: 'Pass: no game interest' });
  return R;
}
function bidStaymanReply(st, me) {
  const L = bidLevel(st.last[me ^ 2].call);
  return [
    { call: mkBid(L, 2), len: bLen(2, 4), text: '4+ hearts', tag: 'stayReply' },
    { call: mkBid(L, 3), len: bLen(3, 4), show: { len: bLen(3, 4), max: bMax(2, 3) }, text: '4+ spades, fewer than 4 hearts', tag: 'stayReply' },
    { call: mkBid(L, 1), show: { max: bMax(2, 3, 3, 3) }, text: 'No 4-card major', tag: 'stayReply', art: 1 }
  ];
}
function bidTransferReply(st, me) {
  const pc = st.last[me ^ 2].call, L = bidLevel(pc), M = bidStrain(pc) + 1;
  const top = st.info[me].hcpMax, R = [];
  if (L === 2) R.push({ call: mkBid(3, M), len: bLen(M, 4), when: function (f) { return f.hcp >= top; }, show: { len: bLen(M, 4), hcp: [top, 37] }, text: 'Super-accept: 4+ trumps and a maximum', tag: 'xferDone', agree: M });
  R.push({ call: mkBid(L, M), text: 'Completes the transfer', tag: 'xferDone', art: 1 });
  return R;
}
function bidRelayReply() { return [{ call: mkBid(3, 0), text: 'Forced reply to the relay', tag: 'relayDone', art: 1 }]; }
function bidAfterRelay() {
  return [
    { call: mkBid(3, 1), when: function (f) { return f.len[1] > f.len[0]; }, show: { len: bLen(1, 6) }, text: 'To play in diamonds', stop: 1 },
    { call: PASS, text: 'To play in clubs', show: { len: bLen(0, 6) } }
  ];
}

// ---------- strong 2C ----------
function bidLongest(f) { let b = 3; for (let s = 2; s >= 0; s--) if (f.len[s] > f.len[b]) b = s; return b; }
function bidRespTo2C() {
  const R = [];
  for (let s = 3; s >= 0; s--) {
    R.push({ call: mkBid(s >= 2 ? 2 : 3, s), hcp: [8, 37], len: bLen(s, 5), when: function (f) { return f.top3[s] >= 2; }, text: 'Positive: 8+ points, good 5+ ' + BID_SUIT_WORD[s] + '. Game forcing.', tag: 'positive', forcing: 2 });
  }
  R.push({ call: mkBid(2, 4), hcp: [8, 37], bal: 1, text: 'Positive: 8+ points, balanced. Game forcing.', tag: 'positive', forcing: 2 });
  R.push({ call: mkBid(2, 1), text: 'Waiting bid (artificial): says nothing about diamonds', tag: 'waiting', forcing: 1, art: 1 });
  return R;
}
function bidRebidAfter2C() {
  const R = [];
  R.push({ call: mkBid(2, 4), hcp: [22, 24], bal: 1, text: '22–24 points, balanced', tag: 'rebid2n' });
  R.push({ call: mkBid(3, 4), hcp: [25, 27], bal: 1, text: '25–27 points, balanced' });
  for (let s = 3; s >= 0; s--) {
    R.push({ call: mkBid(s >= 2 ? 2 : 3, s), when: function (f) { return !f.balanced && bidLongest(f) === s; }, show: { hcp: [22, 37], len: bLen(s, 5) }, text: 'Natural: 5+ ' + BID_SUIT_WORD[s] + '. Forcing to game.', forcing: 2 });
  }
  return R;
}

// ---------- weak twos and preempts ----------
function bidRespToWeak2(st, me) {
  const o = bidStrain(st.last[me ^ 2].call), R = [];
  if (o >= 2) R.push({ call: mkBid(4, o), when: function (f) { return (f.len[o] >= 3 && bidSupportPts(f, o) >= 16) || f.len[o] >= 5; }, show: { len: bLen(o, 3) }, text: 'To play', stop: 1, agree: o });
  R.push({ call: mkBid(2, 4), hcp: [15, 37], len: bLen(o, 2), text: 'Asks opener: minimum or maximum?', tag: 'feature', forcing: 1, art: 1, agree: o });
  R.push({ call: mkBid(3, o), len: bLen(o, 3), hcp: [6, 14], text: 'Preemptive raise (not an invitation)', stop: 1, agree: o });
  R.push({ call: PASS, hcp: [0, 16], text: 'Pass' });
  return R;
}
function bidFeatureReply(st, me) {
  const o = st.suits[me][0];
  return [
    { call: o >= 2 ? mkBid(4, o) : mkBid(3, 4), hcp: [8, 10], text: 'Maximum weak two', show: { hcp: [8, 10] } },
    { call: mkBid(3, o), text: 'Minimum weak two', show: { hcp: [5, 7] } }
  ];
}
function bidRespToPreempt(st, me) {
  const pc = st.last[me ^ 2].call, o = bidStrain(pc), R = [];
  if (bidLevel(pc) === 3 && o >= 2) R.push({ call: mkBid(4, o), when: function (f) { return (f.len[o] >= 3 && bidSupportPts(f, o) >= 13) || (f.len[o] >= 1 && f.hcp >= 16); }, text: 'To play', stop: 1, agree: o });
  if (bidLevel(pc) === 3 && o < 2) R.push({ call: mkBid(3, 4), hcp: [16, 37], when: function (f) { for (let s = 0; s < 4; s++) if (s !== o && !f.stop[s]) return false; return f.len[o] >= 2; }, text: 'To play', stop: 1 });
  R.push({ call: PASS, hcp: [0, 19], text: 'Pass' });
  return R;
}

// ---------- Jacoby 2NT replies ----------
function bidJacobyReply(st, me) {
  const o = st.suits[me][0], R = [];
  for (let x = 0; x < 4; x++) {
    if (x === o) continue;
    R.push({ call: mkBid(3, x), when: function (f) { return f.len[x] <= 1; }, show: { max: bMax(x, 1) }, text: 'Shortness: singleton or void in ' + BID_SUIT_WORD[x], tag: 'jacReply', art: 1, forcing: 2 });
  }
  R.push({ call: mkBid(4, o), hcp: [0, 14], show: { hcp: [11, 14] }, text: 'Minimum opening, no shortness', tag: 'jacReply' });
  R.push({ call: mkBid(3, 4), hcp: [15, 17], text: '15–17 points, no shortness', tag: 'jacReply', art: 1, forcing: 2 });
  R.push({ call: mkBid(3, o), hcp: [18, 37], text: '18+ points, no shortness: slam interest', tag: 'jacReply', forcing: 2 });
  return R;
}
