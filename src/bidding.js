// ===== bidding.js — rule dispatcher and the public bidding API =====
//   bidChooseCall(view) -> {call, text}
//   bidExplainAuction(dealer, vul, calls) -> string[]
//   BIDDING_NOTES: [{title, items: string[]}] for the help sheet

// The specific rules (in priority order) for the seat on turn, or null when only natural bidding applies.
function bidRules(st) {
  const me = st.turn, pa = me ^ 2, rho = (me + 3) & 3, lho = (me + 1) & 3;
  const pm = st.last[pa], rm = st.last[rho];
  const rhoPassed = !rm || rm.call === PASS;
  if (st.lastBid < 0) return bidOpenRules(st);
  const quiet = st.acts[lho] === 0 && st.acts[rho] === 0;           // the opponents have not come in
  if (pm && pm.call !== PASS) {
    switch (pm.tag) {
      case 'open1':
        if (rhoPassed) return bidRespTo1(st, me);
        if (rm.call === DBL) return bidRespAfterDouble(st, me);
        if (isBid(rm.call) && rm.suit >= 0) return bidRespAfterOvercall(st, me, rm);
        return null;
      case 'open1n': return rhoPassed ? bidRespToNT(st, me, 15, 17, 1) : bidRespNTInterference(st, me, rm);
      case 'ntOvercall':
        if (!rhoPassed) return bidRespNTInterference(st, me, rm);
        return bidRespToNT(st, me, st.info[pa].hcpMin, st.info[pa].hcpMax, bidLevel(pm.call));
      case 'open2n': return rhoPassed ? bidRespToNT(st, me, 20, 21, 2) : null;
      case 'rebid2n': return rhoPassed ? bidRespToNT(st, me, 22, 24, 2) : null;
      case 'open2c': return rhoPassed ? bidRespTo2C() : null;
      case 'waiting': return rhoPassed ? bidRebidAfter2C() : null;
      case 'weak2': return rhoPassed ? bidRespToWeak2(st, me) : null;
      case 'feature': return rhoPassed ? bidFeatureReply(st, me) : null;
      case 'preempt': return rhoPassed ? bidRespToPreempt(st, me) : null;
      case 'stayman': return rhoPassed ? bidStaymanReply(st, me) : null;
      case 'transfer': return rhoPassed ? bidTransferReply(st, me) : null;
      case 'minorRelay': return rhoPassed ? bidRelayReply() : null;
      case 'relayDone': return rhoPassed ? bidAfterRelay() : null;
      case 'jacoby2n': return rhoPassed ? bidJacobyReply(st, me) : null;
      case 'resp1': return rhoPassed && quiet ? bidRebid1o1(st, me) : null;
      case 'resp1n': return rhoPassed && quiet ? bidRebidAfter1N(st, me) : null;
      case 'resp2o1': return rhoPassed && quiet ? bidRebidAfter2o1(st, me) : null;
      case 'overcall': return bidAdvanceOvercall(st, me);
      case 'cueRaise': return rhoPassed ? bidAfterCueRaise(st, me) : null;
      case 'takeout': return bidAdvanceDouble(st, me, rhoPassed);
      case 'blackwood': return rhoPassed ? bidBlackwoodReply() : null;
      case 'bwReply': return rhoPassed ? bidAfterBlackwood(st, me) : null;
      case 'quant': return rhoPassed ? bidAfterQuant(st, me) : null;
      default: break;
    }
  }
  if (((st.opener ^ me) & 1) === 1 && st.acts[me] === 0 && st.acts[pa] === 0) return bidOvercallRules(st, me);
  return null;
}

function bidChooseCall(view) {
  const st = bidState(view.dealer, view.vul, view.calls);
  const f = handFeatures(view.hand);
  const call = bidChoose(st, f);
  return { call: call, text: bidInterpret(st, call).text };
}
function bidExplainAuction(dealer, vul, calls) {
  const st = bidNewState(dealer, vul);
  const out = [];
  for (let i = 0; i < calls.length; i++) out.push(bidAdvance(st, calls[i]).text);
  return out;
}

const BIDDING_NOTES = [
  { title: 'The system', items: [
    'Your partner and both opponents play Standard American: five-card majors and a strong notrump.',
    'Points are high-card points (A=4, K=3, Q=2, J=1) plus a little for long suits, or for short suits once a trump fit is found.',
    'About 25 combined points are bid to game, 33 to a small slam, 37 to a grand slam.',
    'Tap any call in the auction to see what it shows.'
  ] },
  { title: 'Opening bids', items: [
    '1♥ / 1♠: 5+ cards, about 12–21 points.',
    '1♣ / 1♦: 3+ cards, about 12–21 points (longer minor; 1♦ with 4–4, 1♣ with 3–3).',
    '1NT: 15–17 balanced (may hold a five-card major). 2NT: 20–21 balanced.',
    '2♣: strong and artificial, 22+ points. 2♦ is the waiting reply.',
    '2♦ / 2♥ / 2♠: weak two, a good six-card suit and 5–10 points.',
    'Three- and four-level openings: preempts on a seven- or eight-card suit.'
  ] },
  { title: 'Responding to one of a suit', items: [
    'Pass with fewer than 6 points.',
    'A new suit at the one level shows 4+ cards and 6+ points and is forcing.',
    'A new suit at the two level shows 10+ points and is forcing.',
    'Raises: single raise 6–9, jump raise 10–12 (limit), 2NT over a major is Jacoby (game-forcing raise with 4+ trumps).',
    '1NT: 6–10 with nothing better. Over a minor, 2NT is 11–12 and 3NT is 13–15 balanced.'
  ] },
  { title: 'Over partner’s notrump', items: [
    '2♣ Stayman asks for a four-card major (8+ points opposite 1NT).',
    '2♦ and 2♥ are Jacoby transfers to hearts and spades (5+ cards, any strength).',
    '2♠ asks opener to bid 3♣: a weak hand with a long minor.',
    '2NT invites game, 3NT is to play, 4NT invites slam.',
    'The same ideas apply one level higher over 2NT.'
  ] },
  { title: 'When they open', items: [
    'Overcall: a five-card or longer suit, 8–16 points at the one level, 11–16 at the two level.',
    '1NT overcall: 15–18 balanced with a stopper in their suit.',
    'Takeout double: opening values, short in their suit, support for the others (or any very strong hand).',
    'Jump overcalls are weak. A cue bid of their suit after partner overcalls shows a limit raise or better.',
    'After we open and they overcall, a double is negative: it shows the unbid major(s), not a wish to defend.'
  ] },
  { title: 'Slams', items: [
    '4NT is Blackwood once a suit is agreed: 5♣ = 0 or 4 aces, 5♦ = 1, 5♥ = 2, 5♠ = 3.',
    '4NT directly over a natural notrump bid is quantitative: partner passes with a minimum and bids 6NT with a maximum.'
  ] }
];
