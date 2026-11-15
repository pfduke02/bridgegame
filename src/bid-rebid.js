// ===== bid-rebid.js — opener's rebids after an uncontested response, Blackwood, quantitative 4NT =====

function bidWord(s) { return BID_SUIT_WORD[s]; }

// After a one-over-one response (1x - 1y).
function bidRebid1o1(st, me) {
  const o = st.suits[me][0], r = st.suits[me ^ 2][0];
  const R = [];
  if (r >= 2) {
    R.push({ call: mkBid(4, r), len: bLen(r, 4), fp: [19, 40, r], show: { hcp: [17, 21], len: bLen(r, 4) }, text: 'Raise to game: 19+ points, 4 trumps', agree: r });
    R.push({ call: mkBid(3, r), len: bLen(r, 4), fp: [16, 18, r], show: { hcp: [14, 18], len: bLen(r, 4) }, text: 'Jump raise: 16–18 points, 4 trumps (invitational)', inv: 1, agree: r });
    R.push({ call: mkBid(2, r), len: bLen(r, 4), fp: [0, 15, r], show: { hcp: [11, 15], len: bLen(r, 4) }, text: 'Raise: minimum opening, 4 trumps', agree: r });
  }
  for (let s = 3; s >= 0; s--) {            // jump shift
    if (s === o || s === r) continue;
    const jump = s < o ? mkBid(3, s) : s > r ? mkBid(2, s) : -1;
    if (jump < 0) continue;
    R.push({ call: jump, hcp: [19, 21], len: bLen(s, 4), when: function (f) { return !f.balanced; }, text: 'Jump shift: 19+ points, 4+ ' + bidWord(s) + '. Forcing to game.', forcing: 2 });
  }
  R.push({ call: mkBid(2, 4), hcp: [18, 19], bal: 1, text: '18–19 points, balanced' });
  for (let s = 2; s <= 3; s++) {
    if (s > r && s !== o) R.push({ call: mkBid(1, s), len: bLen(s, 4), hcp: [0, 18], show: { hcp: [11, 18], len: bLen(s, 4) }, text: '4+ ' + bidWord(s) + ', natural' });
  }
  R.push({ call: mkBid(1, 4), hcp: [0, 14], bal: 1, show: { hcp: [11, 14], bal: 1 }, text: '12–14 points, balanced' });
  R.push({ call: mkBid(3, o), len: bLen(o, 6), hcp: [16, 21], when: function (f) { return bidSuitOk(f, o); }, show: { hcp: [16, 18], len: bLen(o, 6) }, text: 'Jump rebid: 16–18 points, good 6+ suit (invitational)', inv: 1 });
  for (let s = 3; s >= 0; s--) {            // reverse
    if (s > o && s < r) R.push({ call: mkBid(2, s), hcp: [16, 21], len: bLen(s, 4), when: function (f) { return f.len[o] > f.len[s]; }, show: { hcp: [16, 21], len: bLen(s, 4, o, 5) }, text: 'Reverse: 16+ points, 4+ ' + bidWord(s) + ' with longer ' + bidWord(o) + '. Forcing.', tag: 'reverse', forcing: 1 });
  }
  for (let s = o - 1; s >= 0; s--) {
    if (s !== r) R.push({ call: mkBid(2, s), hcp: [0, 18], len: bLen(s, 4), show: { hcp: [11, 18], len: bLen(s, 4) }, text: 'Second suit: 4+ ' + bidWord(s) });
  }
  R.push({ call: mkBid(2, o), len: bLen(o, 6), hcp: [0, 15], show: { hcp: [11, 15], len: bLen(o, 6) }, text: 'Minimum opening, 6+ ' + bidWord(o) });
  R.push({ call: mkBid(1, 4), hcp: [0, 15], when: function (f) { return f.semiBal || f.len[o] < 5; }, show: { hcp: [11, 15] }, text: 'Minimum opening, no better bid' });
  R.push({ call: mkBid(2, o), len: bLen(o, 5), hcp: [0, 18], show: { hcp: [11, 18], len: bLen(o, 5) }, text: 'Rebid: 5+ ' + bidWord(o) + ', no better bid' });
  R.push({ call: mkBid(1, 4), hcp: [0, 18], show: { hcp: [11, 18] }, text: 'No better bid' });
  return R;
}

// After a 1NT response (1x - 1NT).
function bidRebidAfter1N(st, me) {
  const o = st.suits[me][0];
  const R = [];
  const unbal = function (f) { return !f.balanced; };
  R.push({ call: mkBid(3, 4), hcp: [19, 21], when: function (f) { return f.semiBal; }, text: 'To play', stop: 1 });
  for (let s = o - 1; s >= 0; s--) R.push({ call: mkBid(3, s), hcp: [19, 21], len: bLen(s, 4), when: unbal, text: 'Jump shift: 19+ points, 4+ ' + bidWord(s) + '. Forcing to game.', forcing: 2 });
  for (let s = 3; s > o; s--) R.push({ call: mkBid(2, s), hcp: [17, 21], len: bLen(s, 4), when: function (f) { return f.len[o] > f.len[s]; }, show: { hcp: [17, 21], len: bLen(s, 4, o, 5) }, text: 'Reverse: 17+ points, 4+ ' + bidWord(s) + '. Forcing.', tag: 'reverse', forcing: 1 });
  R.push({ call: mkBid(2, 4), hcp: [17, 18], when: function (f) { return f.semiBal; }, text: '17–18 points (invitational)', inv: 1 });
  R.push({ call: mkBid(3, o), len: bLen(o, 6), hcp: [16, 18], text: 'Jump rebid: 16–18 points, 6+ ' + bidWord(o) + ' (invitational)', inv: 1 });
  for (let s = o - 1; s >= 0; s--) R.push({ call: mkBid(2, s), len: bLen(s, 4), hcp: [0, 18], when: unbal, show: { hcp: [11, 18], len: bLen(s, 4) }, text: 'Second suit: 4+ ' + bidWord(s) });
  R.push({ call: mkBid(2, o), len: bLen(o, 6), hcp: [0, 15], show: { hcp: [11, 15], len: bLen(o, 6) }, text: 'Minimum opening, 6+ ' + bidWord(o) });
  R.push({ call: PASS, hcp: [0, 16], show: { hcp: [11, 16] }, text: 'Pass: minimum, content with 1NT' });
  R.push({ call: mkBid(2, 4), hcp: [17, 18], text: '17–18 points (invitational)', inv: 1 });
  R.push({ call: mkBid(3, 4), hcp: [19, 21], text: 'To play', stop: 1 });
  return R;
}

// After a two-over-one response (1x - 2y, y lower than x): responder has 10+.
function bidRebidAfter2o1(st, me) {
  const o = st.suits[me][0], r = st.suits[me ^ 2][0];
  const R = [];
  if (r === 2) {
    R.push({ call: mkBid(4, 2), len: bLen(2, 3), sp: [15, 40, 2], show: { hcp: [14, 21], len: bLen(2, 3) }, text: 'Raise to game: 3+ hearts, extra values', agree: 2 });
    R.push({ call: mkBid(3, 2), len: bLen(2, 3), show: { hcp: [11, 14], len: bLen(2, 3) }, text: 'Raise: 3+ hearts, minimum', agree: 2 });
  }
  R.push({ call: mkBid(3, 4), hcp: [18, 19], bal: 1, text: '18–19 points, balanced' });
  R.push({ call: mkBid(2, 4), hcp: [0, 14], bal: 1, show: { hcp: [11, 14], bal: 1 }, text: '12–14 points, balanced' });
  R.push({ call: mkBid(3, o), len: bLen(o, 6), hcp: [16, 21], when: function (f) { return bidSuitOk(f, o); }, text: 'Jump rebid: 16+ points, good 6+ ' + bidWord(o) + '. Forcing to game.', forcing: 2 });
  for (let s = 3; s >= 0; s--) {
    if (s === o || s === r) continue;
    if (s > r && s < o) R.push({ call: mkBid(2, s), len: bLen(s, 4), hcp: [0, 21], show: { hcp: [11, 21], len: bLen(s, 4) }, text: 'Second suit: 4+ ' + bidWord(s) + '. Forcing.', forcing: 1 });
    else if (s > o) R.push({ call: mkBid(2, s), len: bLen(s, 4), hcp: [16, 21], when: function (f) { return f.len[o] > f.len[s]; }, text: 'Reverse: 16+ points, 4+ ' + bidWord(s) + '. Forcing to game.', forcing: 2 });
    else R.push({ call: mkBid(3, s), len: bLen(s, 4), hcp: [15, 21], text: 'Second suit at the three level: extra values. Forcing to game.', forcing: 2 });
  }
  if (r < 2) R.push({ call: mkBid(3, r), len: bLen(r, 4), hcp: [0, 21], show: { hcp: [11, 21], len: bLen(r, 4) }, text: 'Raise: 4+ card support', agree: r, forcing: 1 });
  R.push({ call: mkBid(2, o), hcp: [0, 21], show: { hcp: [11, 21], len: bLen(o, 5) }, text: 'Rebid: 5+ ' + bidWord(o) + ', no better bid' });
  return R;
}

// ---------- Blackwood ----------
// Trump suit a 4NT ace-ask refers to: the agreed suit, else the side's most recent natural suit.
function bidTrumpGuess(st, side) {
  if (st.agreed[side] >= 0) return st.agreed[side];
  for (let i = st.mean.length - 1; i >= 0; i--) {
    const m = st.mean[i];
    if ((m.seat & 1) === side && m.suit >= 0) return m.suit;
  }
  return NT;
}
function bidBlackwoodReply() {
  const txt = ['0 or 4 aces', '1 ace', '2 aces', '3 aces'];
  const R = [];
  for (let k = 0; k < 4; k++) {
    R.push({ call: mkBid(5, k), when: function (f) { return f.aces % 4 === k; }, text: 'Blackwood reply: ' + txt[k], tag: 'bwReply', art: 1, forcing: 1 });
  }
  return R;
}
function bidAfterBlackwood(st, me) {
  const pa = me ^ 2, t = bidTrumpGuess(st, me & 1);
  const reply = st.last[pa].call, k = bidStrain(reply);
  const pMin = st.info[pa].hcpMin;
  const total = function (f) { return f.aces + (k === 0 ? (f.aces === 0 ? 4 : 0) : k); };
  const R = [];
  R.push({ call: mkBid(7, t), when: function (f) { return total(f) === 4 && f.hcp + pMin >= 35; }, text: 'Grand slam: all four aces held', stop: 1 });
  R.push({ call: mkBid(6, t), when: function (f) { return total(f) >= 3; }, text: 'Small slam: at most one ace missing', stop: 1 });
  if (reply === mkBid(5, t)) R.push({ call: PASS, text: 'Stops: two aces are missing' });
  R.push({ call: mkBid(5, t), text: 'Signs off: two aces are missing', stop: 1 });
  R.push({ call: mkBid(6, t), text: 'Slam (too high to stop)', stop: 1 });
  return R;
}
// Partner raised notrump to 4NT (quantitative).
function bidAfterQuant(st, me) {
  const p = st.info[me ^ 2], mid = (p.hcpMin + p.hcpMax) / 2;
  return [
    { call: mkBid(6, 4), when: function (f) { return f.hcp + mid >= BID_SLAM - 0.5; }, text: 'Accepts the invitation: maximum', stop: 1 },
    { call: PASS, text: 'Declines: minimum' }
  ];
}
