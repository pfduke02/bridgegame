// ===== ai.js — entry points the page uses, directly or through a Web Worker =====
// Requests:
//   {type:'call', view}                  -> {call, text}        the bot's call and what it means
//   {type:'play', view, level}           -> {card}              view.seat is the seat DECIDING (declarer decides for dummy)
//   {type:'explain', dealer, vul, calls} -> {texts: string[]}   meaning of every call in the auction
//   {type:'replay', deal, level}         -> the same deal bid and played by four bots (the other table in duplicate)
//   {type:'par', hands, strain, declarer, maxNodes} -> {tricks}  tricks declarer takes with perfect play all round (null if too costly)
//   {type:'review', deal, humanSeats}    -> every card checked against perfect play, every human call against the bots' system
//   {type:'claim', hands, trump, leader, trick, seat} -> {tricks}  most tricks seat's side can still take (null if too costly)
// A job is {step(ms) -> done?, result}; step() may be called repeatedly so a main-thread
// fallback can stay responsive.

function aiViewLegalCards(view) {
  const ps = publicPlayState(view.dealer, view.calls, view.plays);
  const src = ps.turn === view.seat ? view.hand : view.dummyHand;
  const hand = src.filter(function (c) { return ps.playedBy[c] < 0; });
  if (ps.cur.length) {
    const led = cardSuit(ps.cur[0]);
    const follow = hand.filter(function (c) { return cardSuit(c) === led; });
    if (follow.length) return follow;
  }
  return hand;
}

// Last-resort choices: always legal, used only if the real engine throws.
function aiSafeCall() { return { call: PASS, text: 'Pass' }; }
function aiSafePlay(view) {
  const legal = aiViewLegalCards(view);
  let best = legal[0];
  for (const c of legal) if (cardRank(c) < cardRank(best)) best = c;
  return { card: best };
}

function aiDoneJob(result) { return { result: result, step: function () { return true; } }; }

function aiStartJob(req) {
  if (req.type === 'call') {
    let r;
    try { r = bidChooseCall(req.view); } catch (e) { r = aiSafeCall(); r.error = String(e && e.stack || e); }
    return aiDoneJob(r);
  }
  if (req.type === 'explain') {
    let texts;
    try { texts = bidExplainAuction(req.dealer, req.vul, req.calls); }
    catch (e) { texts = req.calls.map(function (c) { return callText(c); }); }
    return aiDoneJob({ texts: texts });
  }
  if (req.type === 'play') {
    let inner = null;
    try { inner = playStartJob(req.view, req.level); } catch (e) { return aiDoneJob(Object.assign(aiSafePlay(req.view), { error: String(e && e.stack || e) })); }
    const job = {
      result: null,
      step: function (ms) {
        try {
          if (!inner.step(ms)) return false;
          job.result = inner.result;
        } catch (e) {
          job.result = Object.assign(aiSafePlay(req.view), { error: String(e && e.stack || e) });
        }
        return true;
      }
    };
    return job;
  }
  if (req.type === 'replay') return aiReplayJob(req);
  if (req.type === 'review') return aiReviewJob(req);
  if (req.type === 'claim') {
    let tricks = null;
    try { tricks = aiSideCanTake(req.hands, req.trump, req.leader, req.trick || [], req.seat, req.maxNodes || 12000000); } catch (e) { tricks = null; }
    return aiDoneJob({ tricks: tricks });
  }
  if (req.type === 'par') {
    let tricks = null;
    try {
      const hold = new Array(16).fill(0);
      for (let s = 0; s < 4; s++) for (const c of req.hands[s]) hold[s * 4 + cardSuit(c)] |= 1 << cardRank(c);
      const v = ddSolve(hold, req.strain, (req.declarer + 1) & 3, req.maxNodes || 0);
      if (v >= 0) tricks = 13 - v;
    } catch (e) { tricks = null; }
    return aiDoneJob({ tricks: tricks });
  }
  throw new Error('unknown request type: ' + req.type);
}

function aiHold(hands) {
  const hold = new Array(16).fill(0);
  for (let s = 0; s < 4; s++) for (const c of hands[s]) hold[s * 4 + cardSuit(c)] |= 1 << cardRank(c);
  return hold;
}
// Most tricks `seat`'s side can take from this position (the trick in progress included) with best play all round.
function aiSideCanTake(hands, trump, leader, trick, seat, maxNodes) {
  const res = ddSolveBoard(aiHold(hands), trump, leader, trick, maxNodes);
  if (!res) return null;
  const mover = (leader + trick.length) & 3, left = hands[mover].length;
  let best = 0;
  for (const t of res.tricks) if (t > best) best = t;
  return ((mover ^ seat) & 1) === 0 ? best : left - best;
}

// Review of a finished deal with all four hands known:
//   cost[i]  tricks the i-th card played cost its side against the best card in that position (-1: not analysed)
//   best[i]  the best cards, for cards played by the human's seats that cost a trick
//   start    tricks declarer takes with best play from the opening lead
//   claim    for an accepted claim: {tricks claimed, could: tricks the side could still have taken}
//   bids     the human's calls where the bots' system would have called differently
function aiReviewJob(req) {
  const d = req.deal, human = req.humanSeats || [2];
  const g = new Game({ board: d.board, dealer: d.dealer, vul: d.vul, hands: d.hands, calls: d.calls });
  const plays = d.plays || [], out = { v: 1, cost: [], best: {}, start: null, claim: null, bids: [] };
  const job = { result: null, progress: { phase: 'review', done: 0, total: plays.length }, step: null };
  // bidding: what the bots' system calls with the human's cards at each of the human's turns
  for (let i = 0; i < d.calls.length; i++) {
    const seat = (d.dealer + i) & 3;
    if (human.indexOf(seat) < 0) continue;
    let r = null;
    try { r = bidChooseCall({ seat: seat, hand: d.hands[seat], dealer: d.dealer, vul: d.vul, calls: d.calls.slice(0, i) }); } catch (e) { r = null; }
    if (r && r.call !== d.calls[i]) out.bids.push({ i: i, bot: r.call, botText: r.text });
  }
  let i = 0;
  job.step = function (ms) {
    const end = Date.now() + (ms || 20);
    if (g.phase !== 'play') { job.result = out; return true; }
    while (i <= plays.length) {
      if (i === plays.length) {
        if (d.claim && g.phase === 'play') {
          const could = aiSideCanTake(g.rem, g.contract.strain, g.cur.leader, g.cur.cards, d.claim.seat, req.maxNodes || 15000000);
          out.claim = { tricks: d.claim.tricks, could: could };
        }
        i++;
        break;
      }
      const res = ddSolveBoard(aiHold(g.rem), g.contract.strain, g.cur.leader, g.cur.cards, req.maxNodes || 15000000);
      const card = plays[i], seat = g.turn;
      if (res) {
        let top = 0;
        for (const t of res.tricks) if (t > top) top = t;
        const k = res.cards.indexOf(card), cost = k >= 0 ? top - res.tricks[k] : -1;
        out.cost.push(cost);
        if (cost > 0 && human.indexOf(seat) >= 0) out.best[i] = res.cards.filter(function (c, j) { return res.tricks[j] === top; });
        if (i === 0) out.start = ((seat ^ g.declarer) & 1) === 0 ? top : 13 - top;
      } else out.cost.push(-1);
      g.playCard(card);
      i++;
      job.progress = { phase: 'review', done: i, total: plays.length };
      if (Date.now() >= end) return false;
    }
    if (i > plays.length) { job.result = out; return true; }
    return false;
  };
  return job;
}

// Four bots bid and play a whole deal, each seeing only its own cards (and dummy once it is down).
function aiReplayJob(req) {
  const d = req.deal, level = req.level || 2;
  const g = new Game({ board: d.board, dealer: d.dealer, vul: d.vul, hands: d.hands });
  const job = { result: null, progress: { phase: 'auction', tricks: 0 }, step: null };   // (a replay never claims)
  let inner = null;
  job.step = function (ms) {
    const end = Date.now() + (ms || 20);
    for (;;) {
      if (g.phase === 'auction') {
        let r;
        try { r = bidChooseCall(g.view(g.turn)); } catch (e) { r = aiSafeCall(); }
        g.makeCall(g.isLegalCall(r.call) ? r.call : PASS);
        if (g.phase !== 'auction') job.progress = { phase: g.phase, tricks: 0 };
      } else if (g.phase === 'play') {
        if (!inner) {
          const view = g.view(g.actor());
          if (req.seed !== undefined) view.seed = (req.seed + g.plays.length * 7919) >>> 0;
          try { inner = playStartJob(view, level); } catch (e) { inner = aiDoneJob(aiSafePlay(view)); }
        }
        let done;
        try { done = inner.step(Math.max(5, end - Date.now())); }
        catch (e) { inner = aiDoneJob(aiSafePlay(g.view(g.actor()))); done = true; }
        if (done) {
          const legal = g.legalCards();
          g.playCard(legal.indexOf(inner.result.card) >= 0 ? inner.result.card : legal[0]);
          inner = null;
          job.progress = { phase: g.phase, tricks: g.tricks.length };
        }
      }
      if (g.phase === 'over') {
        const r = g.result, c = g.contract;
        job.result = {
          board: g.board, calls: g.calls.slice(), plays: g.plays.slice(), passedOut: r.passedOut,
          contract: c ? { level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer } : null,
          declTricks: r.declTricks, made: r.made, score: r.score, nsScore: r.nsScore
        };
        job.progress = { phase: 'over', tricks: 13 };
        return true;
      }
      if (Date.now() >= end) return false;
    }
  };
  return job;
}

function aiRun(req) {
  const job = aiStartJob(req);
  while (!job.step(1000)) { /* keep going */ }
  return job.result;
}

// Inside a Web Worker: answer {id, req} messages with {id, result}.
function aiWorkerMain(scope) {
  scope.onmessage = function (ev) {
    const m = ev.data;
    let result;
    try {
      const job = aiStartJob(m.req);
      let last = '';
      while (!job.step(150)) {
        if (job.progress) {                                  // long jobs report how far they have got
          const p = JSON.stringify(job.progress);
          if (p !== last) { last = p; scope.postMessage({ id: m.id, progress: job.progress }); }
        }
      }
      result = job.result;
    } catch (e) { result = { error: String(e && e.stack || e), failed: true }; }
    scope.postMessage({ id: m.id, result: result });
  };
}
