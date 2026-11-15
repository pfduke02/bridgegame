// ===== ui.js — the table: rendering, input and the turn loop =====
//
// How a deal moves forward:
//   every call or card (human or bot) ends in afterAction(kind), which saves, optionally holds
//   the picture for a moment (the finished auction, or a completed trick in S.hold), then calls
//   advance(). advance() renders and either waits for the human or asks a bot (askBot).
//   Undo / replay / new deal go through cancelBots(), which bumps S.gen; every timer and bot
//   answer checks the generation (and the exact position) before it touches the game.
(function () {
  'use strict';

  const E = BridgeEngine;
  const HUMAN = 2;                              // South
  const PASS = 0, DBL = 1, RDBL = 2;            // call codes, fixed by the engine's conventions
  const STORE_KEY = 'pocket-bridge-v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PACE = {
    relaxed: { bot: 1100, hold: 1700 },
    normal: { bot: 650, hold: 1100 },
    fast: { bot: 260, hold: 600 }
  };
  let watchdogMs = 25000;                       // a bot that has not answered by then gets a safe default
  const VUL_TEXT = ['None vul', 'N-S vul', 'E-W vul', 'Both vul'];
  const SUIT_NAME = ['clubs', 'diamonds', 'hearts', 'spades'];
  const STRAIN_NAME = ['clubs', 'diamonds', 'hearts', 'spades', 'notrump'];
  const RANK_NAME = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
  const AU_ORDER = [3, 0, 1, 2];                // auction columns: West North East South
  const SUIT_CHARS = { '♣': 0, '♦': 1, '♥': 2, '♠': 3 };
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const $ = function (id) { return document.getElementById(id); };

  const S = {
    game: null,
    boardNo: 1,
    history: [],          // one entry per finished board
    recorded: false,      // is the current deal's result already in history
    settings: { speed: 'normal', fourColour: false, level: 2 },
    gen: 0,               // bumped by undo / replay / new deal: invalidates timers and bot answers
    inflight: 0,          // AI requests not yet settled
    botKey: '',           // position a bot request is out for
    thinking: -1,         // seat on turn that a bot is deciding for
    slow: false,          // that bot has been at it long enough to say so
    hold: null,           // completed trick shown before it is swept away
    showAuction: false,   // finished auction kept on screen for a moment
    lift: null,           // {node, card}: card lifted under the finger
    drag: null,           // {node, id, touch}: active pointer on a hand
    hint: null,           // {key, pending} | {key, call, text} | {key, card}
    selLevel: null,       // level chosen in the bidding box
    texts: {},            // call index -> meaning
    meaning: null,        // {idx}: call whose meaning is on show
    shown: '',            // trick card last drawn (so only a new card animates in)
    sheet: null,
    dim: { W: 358, H: 700, cw: 58, ncw: 48 }
  };

  // ---------- small DOM helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function pip(suit, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'pip s' + suit + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#suit-' + suit);
    svg.appendChild(use);
    return svg;
  }
  function fill(node, parts) {
    node.textContent = '';
    parts.forEach(function (p) { node.appendChild(typeof p === 'string' ? document.createTextNode(p) : p); });
  }
  // Text from the engine may carry suit characters; draw them as pips.
  function rich(str) {
    const frag = document.createDocumentFragment();
    let buf = '';
    for (const ch of String(str)) {
      const cp = ch.codePointAt(0);
      if (cp === 0xFE0E || cp === 0xFE0F) continue;     // variation selectors
      const s = SUIT_CHARS[ch];
      if (s === undefined) { buf += ch; continue; }
      if (buf) { frag.appendChild(document.createTextNode(buf)); buf = ''; }
      frag.appendChild(pip(s, 'tx'));
    }
    if (buf) frag.appendChild(document.createTextNode(buf));
    return frag;
  }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0'; }
  function hcp(cards) { let p = 0; for (const c of cards) p += Math.max(0, E.cardRank(c) - 8); return p; }

  function cardEl(card, extra) {
    const s = E.cardSuit(card), r = E.cardRank(card);
    const d = el('div', 'card s' + s + (extra ? ' ' + extra : ''));
    d.dataset.card = String(card);
    const idx = el('span', 'idx');
    idx.appendChild(el('b', r === 8 ? 'ten' : '', E.rankText(r)));
    idx.appendChild(pip(s));
    d.appendChild(idx);
    d.appendChild(pip(s, 'big'));
    d.setAttribute('aria-label', RANK_NAME[r] + ' of ' + SUIT_NAME[s]);
    return d;
  }
  function cardToken(card, cls) {
    const s = E.cardSuit(card);
    const t = el('span', 'bidcard small' + (cls ? ' ' + cls : ''));
    t.appendChild(pip(s));
    t.appendChild(el('b', '', E.rankText(E.cardRank(card))));
    t.setAttribute('aria-label', RANK_NAME[E.cardRank(card)] + ' of ' + SUIT_NAME[s]);
    return t;
  }
  function callChip(call, tag) {
    const b = el(tag || 'span', 'bidcard');
    if (tag === 'button') b.type = 'button';
    if (call === PASS) { b.classList.add('pass'); b.textContent = 'Pass'; }
    else if (call === DBL) { b.classList.add('dbl'); b.textContent = 'X'; b.setAttribute('aria-label', 'Double'); }
    else if (call === RDBL) { b.classList.add('rdbl'); b.textContent = 'XX'; b.setAttribute('aria-label', 'Redouble'); }
    else {
      const st = E.bidStrain(call), lv = E.bidLevel(call);
      b.appendChild(el('b', '', String(lv)));
      if (st === 4) b.appendChild(el('span', 'nt', 'NT')); else b.appendChild(pip(st));
      b.setAttribute('aria-label', lv + ' ' + STRAIN_NAME[st]);
    }
    return b;
  }
  function contractParts(c) {
    const parts = [callChip(E.mkBid(c.level, c.strain))];
    if (c.doubled) parts.push(el('span', 'xmark' + (c.doubled === 2 ? ' rd' : ''), c.doubled === 2 ? 'XX' : 'X'));
    return parts;
  }

  // ---------- who decides ----------
  function pace() { return PACE[S.settings.speed] || PACE.normal; }
  function later(ms, fn) {
    const gen = S.gen;
    setTimeout(function () { if (gen === S.gen) fn(); }, ms);
  }
  function posKey() { const g = S.game; return S.gen + ':' + g.calls.length + ':' + g.plays.length; }
  // Does the human decide for this seat? South always; North too whenever N/S are declaring.
  function isHumanSeat(seat) {
    const g = S.game;
    if (seat === HUMAN) return true;
    return seat === 0 && g.phase === 'play' && (g.declarer & 1) === 0;
  }
  function decider() {
    const g = S.game;
    return g.phase === 'auction' ? g.turn : g.phase === 'play' ? g.actor() : -1;
  }
  function humanToAct() {
    const g = S.game;
    if (!g || g.phase === 'over' || S.hold || S.showAuction) return false;
    return isHumanSeat(decider());
  }
  function lowestCard(cards) {
    let best = cards[0];
    for (const c of cards) if (E.cardRank(c) < E.cardRank(best)) best = c;
    return best;
  }

  // ---------- the turn loop ----------
  function advance() {
    const g = S.game;
    S.thinking = -1; S.slow = false;
    if (g.phase === 'over') { render(); endDeal(); return; }
    const d = decider();
    if (isHumanSeat(d)) {
      if (g.phase === 'auction' && S.selLevel === null) S.selLevel = defaultLevel();
      render();
      return;
    }
    S.thinking = g.turn;
    render();
    askBot(d);
  }

  function track(p) {
    S.inflight++;
    const done = function () { S.inflight--; };
    p.then(done, done);
    return p;
  }

  function askBot(seat) {
    const g = S.game, key = posKey(), t0 = Date.now(), isCall = g.phase === 'auction';
    if (S.botKey === key) return;               // already asked for this exact position
    S.botKey = key;
    let settled = false;
    const finish = function (r) {
      if (settled || key !== posKey()) return;
      settled = true;
      later(Math.max(0, pace().bot - (Date.now() - t0)), function () {
        if (key !== posKey()) return;
        applyBot(isCall, r);
      });
    };
    let p;
    try {
      p = track(isCall ? AIClient.chooseCall(g.view(seat)) : AIClient.choosePlay(g.view(seat), S.settings.level));
    } catch (e) { finish(null); return; }
    p.then(finish, function (err) { if (!(err && err.cancelled)) finish(null); });
    later(pace().bot + 600, function () {
      if (settled || key !== posKey()) return;
      S.slow = true;                             // still working: say so in the status line
      renderDock();
    });
    later(watchdogMs, function () {
      if (settled || key !== posKey()) return;
      try { AIClient.reset(); } catch (e) { /* ignore */ }
      finish(null);
    });
  }

  // A bot answer that is missing or illegal becomes Pass / the lowest legal card, so the game never stalls.
  function applyBot(isCall, r) {
    const g = S.game;
    if (isCall) {
      if (g.phase !== 'auction') return;
      const ok = !!r && Number.isInteger(r.call) && g.isLegalCall(r.call);
      if (ok && r.text) S.texts[g.calls.length] = String(r.text);
      g.makeCall(ok ? r.call : PASS);
      S.meaning = { idx: g.calls.length - 1 };
      afterAction('call');
    } else {
      if (g.phase !== 'play') return;
      const legal = g.legalCards();
      g.playCard(r && legal.indexOf(r.card) >= 0 ? r.card : lowestCard(legal));
      afterAction('card');
    }
  }

  function afterAction(kind) {
    const g = S.game;
    S.hint = null; S.lift = null; S.thinking = -1; S.slow = false;
    save();
    if (kind === 'call' && g.phase !== 'auction') {
      // the auction just ended: leave it on screen for a beat before the play (or the result)
      S.showAuction = true; S.selLevel = null;
      render();
      later(pace().hold, function () { S.showAuction = false; advance(); });
      return;
    }
    if (kind === 'card' && g.plays.length % 4 === 0) {
      const t = g.tricks[g.tricks.length - 1];
      S.hold = t;
      render();
      later(pace().hold, function () {
        sweep(t.winner, function () { S.hold = null; advance(); });
      });
      return;
    }
    if (kind === 'call') S.selLevel = null;
    advance();
  }

  function sweep(winner, done) {
    if (reduceMotion) { done(); return; }
    $('trick').classList.add('sweep', 'to-' + winner);
    later(240, done);
  }

  function dropHintRequest() {
    if (S.hint && S.hint.pending && S.inflight > 0) { try { AIClient.reset(); } catch (e) { /* ignore */ } }
    S.hint = null;
  }

  function humanCall(call) {
    const g = S.game;
    if (g.phase !== 'auction' || g.turn !== HUMAN || !g.isLegalCall(call)) return;
    dropHintRequest();
    g.makeCall(call);
    S.meaning = { idx: g.calls.length - 1 };
    afterAction('call');
  }

  function humanPlay(card) {
    const g = S.game;
    if (g.phase !== 'play' || !humanToAct()) return;
    if (g.legalCards().indexOf(card) < 0) return;
    dropHintRequest();
    g.playCard(card);
    afterAction('card');
  }

  function cancelBots() {
    S.gen++;
    if (S.inflight > 0) { try { AIClient.reset(); } catch (e) { /* ignore */ } }
    S.botKey = ''; S.thinking = -1; S.slow = false; S.hold = null; S.showAuction = false;
    S.hint = null; S.drag = null; S.lift = null;
    $('preview').hidden = true;
  }

  // How many log entries to pop so the human's most recent action is taken back (0 = nothing to undo).
  function undoCount() {
    const g = S.game;
    if (!g || g.phase === 'over') return 0;
    if (g.plays.length) {
      const ps = E.publicPlayState(g.dealer, g.calls, g.plays);
      const nsDeclares = (g.declarer & 1) === 0;
      for (let i = g.plays.length - 1; i >= 0; i--) {
        const seat = ps.playedBy[g.plays[i]];
        if (seat === HUMAN || (seat === 0 && nsDeclares)) return g.plays.length - i;
      }
    }
    for (let i = g.calls.length - 1; i >= 0; i--) {
      if (((g.dealer + i) & 3) === HUMAN) return g.plays.length + (g.calls.length - i);
    }
    return 0;
  }
  function doUndo() {
    const n = undoCount();
    if (!n) return;
    cancelBots();
    S.game.undo(n);
    const keep = {};
    for (let i = 0; i < S.game.calls.length; i++) if (S.texts[i]) keep[i] = S.texts[i];
    S.texts = keep; S.meaning = null; S.selLevel = null; S.shown = '';
    save();
    advance();
  }

  function doHint() {
    const g = S.game;
    if (!humanToAct()) return;
    const key = posKey(), seat = decider(), inAuction = g.phase === 'auction';
    if (S.hint && S.hint.key === key) return;
    S.hint = { key: key, pending: true };
    renderDock();
    let p;
    try {
      p = track(inAuction ? AIClient.chooseCall(g.view(HUMAN)) : AIClient.choosePlay(g.view(seat), S.settings.level));
    } catch (e) { S.hint = null; renderDock(); return; }
    p.then(function (r) {
      if (!S.hint || S.hint.key !== key || posKey() !== key) return;
      if (inAuction && r && Number.isInteger(r.call) && g.isLegalCall(r.call)) S.hint = { key: key, call: r.call, text: r.text || '' };
      else if (!inAuction && r && g.legalCards().indexOf(r.card) >= 0) S.hint = { key: key, card: r.card };
      else S.hint = null;
      render();
    }, function () {
      if (S.hint && S.hint.key === key) { S.hint = null; render(); }
    });
  }

  // ---------- deals, results, persistence ----------
  function startDeal(deal) {
    cancelBots();
    S.game = new E.Game(deal);
    S.recorded = false; S.texts = {}; S.meaning = null; S.selLevel = null; S.shown = '';
    closeSheet();
    save();
    advance();
  }
  function nextDeal() { S.boardNo++; startDeal(E.newDeal(S.boardNo)); }
  function replayDeal() {
    const g = S.game;
    startDeal({ board: g.board, dealer: g.dealer, vul: g.vul, hands: g.hands });
  }
  function newMatch() { resetCompare(); S.boardNo = 1; S.history = []; startDeal(E.newDeal(1)); }

  function recordResult() {
    const g = S.game, r = g.result, c = g.contract;
    const entry = r.passedOut
      ? { board: g.board, passedOut: true, ns: 0 }
      : { board: g.board, level: c.level, strain: c.strain, doubled: c.doubled, declarer: g.declarer, made: r.made, tricks: r.declTricks, ns: r.nsScore };
    const i = S.history.findIndex(function (h) { return h.board === g.board; });
    if (i >= 0) {
      const old = S.history[i];
      if (old.bots) { entry.bots = old.bots; entry.botCalls = old.botCalls; }     // same cards: the bots' table stands
      S.history[i] = entry;
    } else S.history.push(entry);
  }
  function endDeal() {
    if (!S.recorded) { recordResult(); S.recorded = true; }
    save();
    queueCompare();
    openSheet('result');
  }

  // ---------- duplicate comparison: four bots replay every finished deal with the same cards ----------
  const CMP = { queue: [], busy: null, progress: null, gen: 0 };
  function histEntry(board) {
    for (const h of S.history) if (h.board === board) return h;
    return null;
  }
  function queueCompare() {
    const g = S.game, h = histEntry(g.board);
    if (!h || g.phase !== 'over' || typeof AIClient.analyse !== 'function') return;
    const waiting = function (kind) {
      return (CMP.busy && CMP.busy.board === g.board && CMP.busy.kind === kind) ||
        CMP.queue.some(function (q) { return q.board === g.board && q.kind === kind; });
    };
    const hands = g.hands.map(function (x) { return x.slice(); });
    if (!h.bots && !waiting('replay')) { delete h.botsFailed; CMP.queue.push({ kind: 'replay', board: g.board, dealer: g.dealer, vul: g.vul, hands: hands }); }
    if (!h.passedOut && h.dd === undefined && !waiting('par')) CMP.queue.push({ kind: 'par', board: g.board, hands: hands });
    pumpCompare();
  }
  function pumpCompare() {
    if (CMP.busy || !CMP.queue.length) return;
    const job = CMP.queue.shift(), gen = CMP.gen, h0 = histEntry(job.board);
    if (!h0) { pumpCompare(); return; }
    CMP.busy = job; CMP.progress = null;
    const showing = function () { return S.sheet === 'result' && S.game.board === job.board; };
    let p;
    if (job.kind === 'replay') {
      p = AIClient.analyse(
        { type: 'replay', deal: { board: job.board, dealer: job.dealer, vul: job.vul, hands: job.hands }, level: Math.max(2, S.settings.level) },
        function (pr) { if (gen === CMP.gen) { CMP.progress = pr; if (showing()) renderCompare(); } }
      ).then(function (r) {
        const h = histEntry(job.board);
        if (gen !== CMP.gen || !h || !r) return;
        h.bots = r.passedOut || !r.contract ? { passedOut: true, ns: 0 }
          : { level: r.contract.level, strain: r.contract.strain, doubled: r.contract.doubled, declarer: r.contract.declarer, made: r.made, tricks: r.declTricks, ns: r.nsScore };
        h.botCalls = r.calls;
      });
    } else {
      p = AIClient.analyse({ type: 'par', hands: job.hands, strain: h0.strain, declarer: h0.declarer, maxNodes: 6000000 }).then(function (r) {
        const h = histEntry(job.board);
        if (gen === CMP.gen && h) h.dd = r && Number.isInteger(r.tricks) ? r.tricks : null;
      });
    }
    p.catch(function (err) {
      const h = histEntry(job.board);
      if (gen === CMP.gen && h && job.kind === 'replay' && !(err && err.cancelled)) h.botsFailed = true;
    }).then(function () {
      if (gen !== CMP.gen) return;
      CMP.busy = null; CMP.progress = null;
      save();
      if (showing()) renderResult();
      pumpCompare();
    });
  }
  function resetCompare() {
    CMP.gen++; CMP.queue = []; CMP.busy = null; CMP.progress = null;
    if (typeof AIClient.cancelAnalysis === 'function') AIClient.cancelAnalysis();
  }

  function snapshot() {
    return { v: 1, game: S.game.toJSON(), boardNo: S.boardNo, history: S.history, settings: S.settings, recorded: S.recorded, texts: S.texts };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch (e) { /* storage unavailable: play on */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.v === 1 ? d : null;
    } catch (e) { return null; }
  }
  function validDeal(d) {
    if (!d || !Array.isArray(d.hands) || d.hands.length !== 4) return false;
    const seen = new Set();
    for (const h of d.hands) {
      if (!Array.isArray(h) || h.length !== 13) return false;
      for (const c of h) { if (!Number.isInteger(c) || c < 0 || c > 51 || seen.has(c)) return false; seen.add(c); }
    }
    return Number.isInteger(d.board) && d.board >= 1 && Number.isInteger(d.dealer) && Number.isInteger(d.vul) &&
      Array.isArray(d.calls) && Array.isArray(d.plays);
  }
  function restore(d) {
    if (!validDeal(d.game)) throw new Error('bad saved deal');
    const g = new E.Game(d.game);                // throws if the logs do not fit the deal
    S.game = g;
    S.boardNo = Number.isInteger(d.boardNo) && d.boardNo >= 1 ? d.boardNo : g.board;
    S.history = Array.isArray(d.history) ? d.history.filter(function (h) {
      if (!h || !Number.isInteger(h.board) || !Number.isFinite(h.ns)) return false;
      return h.passedOut === true || (Number.isInteger(h.level) && Number.isInteger(h.strain) && Number.isInteger(h.declarer) && Number.isInteger(h.made));
    }) : [];
    S.recorded = !!d.recorded;
    S.texts = d.texts && typeof d.texts === 'object' ? d.texts : {};
    const st = d.settings || {};
    if (PACE[st.speed]) S.settings.speed = st.speed;
    if (st.level === 1 || st.level === 2 || st.level === 3) S.settings.level = st.level;
    S.settings.fourColour = !!st.fourColour;
  }

  // ---------- sizing ----------
  function layout() {
    const app = $('app');
    const cs = getComputedStyle(app);
    const W = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = app.clientHeight;
    if (!(W > 0) || !(H > 0)) return;
    let cw = Math.round(Math.min(78, Math.max(36, W * 0.165)));
    const maxCh = H * 0.15;
    if (cw * 1.4 > maxCh) cw = Math.max(32, Math.floor(maxCh / 1.4));
    const ncw = Math.round(cw * 0.82);
    const sideMax = Math.round(Math.min(116, W * 0.33));
    // trick cards must fit between a face-up dummy panel on one side and a seat label on the other
    const tcw = Math.round(Math.min(cw, (W - sideMax - 64 - 12) / 2.7));
    app.style.setProperty('--cw', cw + 'px');
    app.style.setProperty('--ch', Math.round(cw * 1.4) + 'px');
    app.style.setProperty('--ncw', ncw + 'px');
    app.style.setProperty('--nch', Math.round(ncw * 1.4) + 'px');
    app.style.setProperty('--tcw', tcw + 'px');
    app.style.setProperty('--tch', Math.round(tcw * 1.4) + 'px');
    app.style.setProperty('--side-max', sideMax + 'px');
    app.style.setProperty('--bb-h', (H < 620 ? 36 : 42) + 'px');
    S.dim = { W: W, H: H, cw: cw, ncw: ncw };
  }

  // ---------- hands ----------
  function suitOrder(cards, trump) {
    let pool = [3, 2, 1, 0].filter(function (s) { return cards.some(function (c) { return E.cardSuit(c) === s; }); });
    const red = function (s) { return s === 1 || s === 2; };
    const out = [];
    let cur = pool.indexOf(trump) >= 0 ? trump : pool[0];
    while (pool.length) {
      out.push(cur);
      pool = pool.filter(function (s) { return s !== cur; });
      if (!pool.length) break;
      const other = pool.filter(function (s) { return red(s) !== red(cur); });
      cur = other.length ? other[0] : pool[0];
    }
    return out;
  }
  // Trumps first, colours alternating, high cards to the left.
  function sortHand(cards, trump) {
    const order = suitOrder(cards, trump);
    return cards.slice().sort(function (a, b) {
      const d = order.indexOf(E.cardSuit(a)) - order.indexOf(E.cardSuit(b));
      return d !== 0 ? d : E.cardRank(b) - E.cardRank(a);
    });
  }
  function liveFor(seat) {
    const g = S.game;
    return g.phase === 'play' && g.turn === seat && humanToAct();
  }

  function renderFan(node, cards, cw, live) {
    const g = S.game;
    const sorted = sortHand(cards, g.contract ? g.contract.strain : -1);
    const legal = live ? g.legalCards() : [];
    const W = node.clientWidth, n = sorted.length;
    const step = n > 1 ? Math.max(6, Math.min(cw * 0.9, (W - cw) / (n - 1))) : 0;
    const x0 = Math.max(0, (W - (cw + step * (n - 1))) / 2);
    node.textContent = '';
    node.classList.toggle('live', !!live);
    sorted.forEach(function (c, i) {
      const d = cardEl(c);
      d.style.setProperty('--x', (x0 + i * step).toFixed(1) + 'px');
      d.style.zIndex = String(i + 1);
      if (live) {
        if (legal.indexOf(c) >= 0) { d.classList.add('playable'); d.tabIndex = 0; d.setAttribute('role', 'button'); }
        else d.classList.add('dim');
        if (S.hint && S.hint.card === c) d.classList.add('hinted');
      }
      if (S.lift && S.lift.node === node && S.lift.card === c) d.classList.add('lift');
      node.appendChild(d);
    });
  }

  // The card whose visible strip is under x (cards overlap left to right, later ones on top).
  function stripCardAt(node, x) {
    let hit = null;
    for (const c of node.children) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right) hit = c;
    }
    return hit;
  }
  function setLift(node, card) {
    const cur = S.lift && S.lift.node === node ? S.lift.card : null;
    if (cur === card) return;
    S.lift = card === null ? null : { node: node, card: card };
    for (const c of node.children) c.classList.toggle('lift', card !== null && Number(c.dataset.card) === card);
    updatePreview();
  }
  function updatePreview() {
    const p = $('preview');
    if (!S.lift || !S.drag || !S.drag.touch) { p.hidden = true; return; }
    let cardNode = null;
    for (const c of S.lift.node.children) if (Number(c.dataset.card) === S.lift.card) cardNode = c;
    if (!cardNode) { p.hidden = true; return; }
    const suit = E.cardSuit(S.lift.card);
    p.className = 'preview s' + suit;
    fill(p, [el('b', '', E.rankText(E.cardRank(S.lift.card))), pip(suit)]);
    p.hidden = false;
    const a = $('app').getBoundingClientRect(), nr = S.lift.node.getBoundingClientRect(), r = cardNode.getBoundingClientRect();
    const x = Math.min(a.width - 30, Math.max(30, r.left - a.left + Math.min(r.width, 30) / 2));
    let y = nr.top - a.top - 46;
    if (y < 2) y = nr.bottom - a.top + 8;        // North's row sits under the top bar: show the bubble below it
    p.style.left = x.toFixed(1) + 'px';
    p.style.top = y.toFixed(1) + 'px';
  }

  function bindFan(node) {
    node.addEventListener('pointerdown', function (ev) {
      if (!node.classList.contains('live')) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      S.drag = { node: node, id: ev.pointerId, touch: ev.pointerType !== 'mouse' };
      try { node.setPointerCapture(ev.pointerId); } catch (e) { /* capture is a nicety */ }
      const hit = stripCardAt(node, ev.clientX);
      setLift(node, hit && hit.classList.contains('playable') ? Number(hit.dataset.card) : null);
    });
    node.addEventListener('pointermove', function (ev) {
      if (!S.drag || S.drag.id !== ev.pointerId || S.drag.node !== node) return;
      const r = node.getBoundingClientRect();
      const inside = ev.clientX >= r.left - 16 && ev.clientX <= r.right + 16 && ev.clientY >= r.top - 44 && ev.clientY <= r.bottom + 30;
      if (!inside) { setLift(node, null); return; }          // slid off the hand: nothing is played
      const hit = stripCardAt(node, ev.clientX);
      if (hit && hit.classList.contains('playable')) setLift(node, Number(hit.dataset.card));
    });
    const end = function (play) {
      return function (ev) {
        if (!S.drag || S.drag.id !== ev.pointerId || S.drag.node !== node) return;
        try { node.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        const lift = S.lift && S.lift.node === node ? S.lift.card : null;
        setLift(node, null);
        S.drag = null;
        $('preview').hidden = true;
        if (play && lift !== null) humanPlay(lift);
      };
    };
    node.addEventListener('pointerup', end(true));
    node.addEventListener('pointercancel', end(false));
    node.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const t = ev.target && ev.target.closest ? ev.target.closest('.card.playable') : null;
      if (!t || !node.classList.contains('live')) return;
      ev.preventDefault();
      humanPlay(Number(t.dataset.card));
    });
  }

  function backs(n) {
    const b = el('div', 'backs' + (n ? '' : ' none'));
    b.appendChild(el('i')); b.appendChild(el('i')); b.appendChild(el('i'));
    b.appendChild(el('b', '', n ? String(n) : ''));
    b.setAttribute('aria-label', n + ' cards, face down');
    return b;
  }
  function diagram(cards) {
    const box = el('div', 'diagram');
    [3, 2, 1, 0].forEach(function (s) {
      const row = el('div', 'drow');
      row.appendChild(pip(s));
      const ranks = cards.filter(function (c) { return E.cardSuit(c) === s; }).map(E.cardRank).sort(function (a, b) { return b - a; });
      row.appendChild(el('span', 'ranks', ranks.length ? ranks.map(E.rankText).join(' ') : '—'));
      box.appendChild(row);
    });
    return box;
  }

  // ---------- rendering ----------
  // Is the auction (rather than the trick) in the middle of the table?
  function auctionUp() {
    const g = S.game;
    return g.phase === 'auction' || S.showAuction || (g.phase === 'over' && !g.contract);
  }
  function render() {
    if (!S.game) return;
    document.body.classList.toggle('four', !!S.settings.fourColour);
    $('table').classList.toggle('bidding', auctionUp());
    renderTop();
    renderSeats();
    renderCentre();
    renderDock();
    if (S.sheet === 'review') renderReview();
  }

  function renderTop() {
    const g = S.game;
    $('board-no').textContent = 'Board ' + g.board;
    // the dealer only matters while the bidding is on; later the room goes to the contract
    $('board-sub').textContent = (g.contract ? '' : 'Dealer ' + E.SEAT_CH[g.dealer] + ' · ') + VUL_TEXT[g.vul];
    const c = $('contract');
    if (g.contract) {
      fill(c, contractParts(g.contract).concat([el('span', '', 'by ' + E.SEAT_CH[g.declarer])]));
      c.hidden = false;
    } else { c.textContent = ''; c.hidden = true; }
    $('tricks').hidden = !g.contract;
    $('tricks-we').textContent = String(g.taken[0]);
    $('tricks-they').textContent = String(g.taken[1]);
  }

  function renderSeats() {
    const g = S.game;
    for (let seat = 0; seat < 4; seat++) {
      const tag = $('tag-' + seat);
      const nm = el('span', 'nm', E.SEAT_NAME[seat]);
      if (E.seatVul(g.vul, seat)) { const v = el('i', 'vuldot'); v.title = 'Vulnerable'; nm.appendChild(v); }
      const roles = [];
      if (seat === HUMAN) roles.push('you'); else if (seat === 0) roles.push('partner');
      if (g.contract) { if (seat === g.declarer) roles.push('declarer'); else if (seat === g.dummy) roles.push('dummy'); }
      else if (seat === g.dealer) roles.push('dealer');
      const parts = [nm];
      if (roles.length) parts.push(el('span', 'role', roles.join(' · ')));
      const dots = el('span', 'dots'); dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
      parts.push(dots);
      fill(tag, parts);
      tag.classList.toggle('turn', g.turn === seat && !S.hold && !S.showAuction);
      tag.classList.toggle('busy', S.thinking === seat);
    }

    // North: face up as soon as the auction is over whenever N/S declare (the human plays it)
    const hn = $('hand-n');
    const northUp = !!g.contract && (g.declarer & 1) === 0 && g.phase !== 'auction';
    if (northUp) {
      hn.className = 'fan north-fan';
      renderFan(hn, g.rem[0], S.dim.ncw, liveFor(0));
    } else {
      hn.className = 'north-back';
      fill(hn, [backs(g.rem[0].length)]);
    }
    // East / West: hidden unless that hand is dummy and the opening lead has been made
    [1, 3].forEach(function (seat) {
      const node = $(seat === 1 ? 'hand-e' : 'hand-w');
      if (g.contract && seat === g.dummy && g.plays.length > 0 && g.phase !== 'over') fill(node, [diagram(g.rem[seat])]);
      else fill(node, [backs(g.rem[seat].length)]);
    });
    // South
    renderFan($('hand-s'), g.rem[HUMAN], S.dim.cw, liveFor(HUMAN));
  }

  function renderCentre() {
    const g = S.game;
    const up = auctionUp();
    $('auction-wrap').hidden = !up;
    $('trick').hidden = up;
    if (up) { renderAuction($('auction')); renderMeaning($('meaning')); }
    else renderTrick();
  }

  function renderAuction(node) {
    const g = S.game;
    const head = el('div', 'au-head');
    AU_ORDER.forEach(function (seat) {
      head.appendChild(el('span', E.seatVul(g.vul, seat) ? 'vul' : '', E.SEAT_NAME[seat]));
    });
    const body = el('div', 'au-body');
    for (let i = AU_ORDER.indexOf(g.dealer); i > 0; i--) body.appendChild(el('span', 'au-blank'));
    g.calls.forEach(function (call, i) {
      const b = callChip(call, 'button');
      b.dataset.idx = String(i);
      if (S.meaning && S.meaning.idx === i) b.classList.add('sel');
      body.appendChild(b);
    });
    if (g.phase === 'auction') body.appendChild(el('span', 'au-turn' + (g.turn === HUMAN ? ' me' : ''), g.turn === HUMAN ? '?' : '…'));
    fill(node, [head, body]);
    body.scrollTop = body.scrollHeight;
  }

  function renderMeaning(node) {
    const g = S.game;
    if (!S.meaning || S.meaning.idx >= g.calls.length) {
      fill(node, [el('span', 'dimtext', g.calls.length ? 'Tap a call to see what it shows.' : 'The dealer calls first.')]);
      return;
    }
    const i = S.meaning.idx, seat = (g.dealer + i) & 3;
    const text = S.texts[i];
    const body = el('span', text ? '' : 'dimtext');
    body.appendChild(text ? rich(text) : document.createTextNode('Looking it up…'));
    fill(node, [el('span', 'who', seat === HUMAN ? 'You' : E.SEAT_NAME[seat]), callChip(g.calls[i]), body]);
  }

  function showMeaning(idx) {
    const g = S.game;
    if (!(idx >= 0 && idx < g.calls.length)) return;
    S.meaning = { idx: idx };
    render();
    if (S.sheet === 'review') renderReview();
    if (S.texts[idx]) return;
    const gen = S.gen, n = g.calls.length;
    let p;
    try { p = track(AIClient.explainAuction(g.dealer, g.vul, g.calls.slice())); } catch (e) { return; }
    p.then(function (texts) {
      if (gen !== S.gen || !Array.isArray(texts)) return;
      for (let i = 0; i < Math.min(n, texts.length, S.game.calls.length); i++) if (!S.texts[i] && texts[i]) S.texts[i] = String(texts[i]);
      if (!S.texts[idx]) S.texts[idx] = E.callText(g.calls[idx]);
      save();
      render();
    }, function () { /* cancelled or failed: the placeholder text stays */ });
  }

  function renderTrick() {
    const g = S.game, node = $('trick-cards');
    const t = S.hold || g.cur || { leader: 0, cards: [] };
    const key = S.gen + ':' + (S.hold ? g.tricks.length - 1 : g.tricks.length) + ':' + t.cards.length;
    const fresh = key !== S.shown;
    $('trick').classList.remove('sweep', 'to-0', 'to-1', 'to-2', 'to-3');
    node.textContent = '';
    t.cards.forEach(function (c, i) {
      const seat = (t.leader + i) & 3;
      const d = cardEl(c, 'tcard p' + seat);
      d.style.zIndex = String(i + 1);
      if (fresh && i === t.cards.length - 1 && !reduceMotion) d.classList.add('enter');
      if (S.hold && seat === S.hold.winner) d.classList.add('win');
      node.appendChild(d);
    });
    S.shown = key;
  }

  function statusParts() {
    const g = S.game;
    if (S.showAuction) {
      if (!g.contract) return ['Passed out'];
      return ['Contract: '].concat(contractParts(g.contract), [' by ' + E.SEAT_NAME[g.declarer]]);
    }
    if (S.slow && S.thinking >= 0) return [E.SEAT_NAME[S.thinking] + ' is thinking'];
    if (g.phase === 'auction') return [g.turn === HUMAN ? 'Your call' : E.SEAT_NAME[g.turn] + ' to call'];
    if (g.phase === 'over') return [g.result.passedOut ? 'Passed out' : 'Deal over'];
    if (S.hold) {
      const w = S.hold.winner;
      if (w === HUMAN) return ['You win the trick'];
      if (w === 0) return [((g.declarer & 1) === 0 ? 'North wins' : 'Partner wins') + ' the trick'];
      return [E.SEAT_NAME[w] + ' wins the trick'];
    }
    const lead = g.cur.cards.length === 0;
    if (isHumanSeat(g.actor())) {
      if (g.turn === 0) return [(lead ? 'Lead from North' : 'Play from North') + (g.dummy === 0 ? ' (dummy)' : '')];
      if (g.dummy === HUMAN) return [(lead ? 'Lead from' : 'Play from') + ' your hand (dummy)'];
      return [g.plays.length === 0 ? 'Your opening lead' : lead ? 'Your lead' : 'Your turn'];
    }
    return [E.SEAT_NAME[g.turn] + (g.plays.length === 0 ? ' to make the opening lead' : lead ? ' to lead' : ' to play')];
  }

  function renderDock() {
    const g = S.game;
    fill($('status'), statusParts());
    $('btn-undo').disabled = undoCount() === 0;
    $('btn-hint').disabled = !humanToAct();
    $('btn-review').hidden = !g.contract;       // during the bidding the auction is on the table already

    const hint = $('hint');
    if (S.hint && S.hint.key === posKey()) {
      const parts = [el('span', 'who', 'Hint')];
      if (S.hint.pending) parts.push(el('span', 'htext', 'Working it out…'));
      else if (S.hint.call !== undefined) {
        parts.push(callChip(S.hint.call));
        const tx = el('span', 'htext'); tx.appendChild(rich(S.hint.text || '')); parts.push(tx);
      } else if (S.hint.card !== undefined) {
        parts.push(cardToken(S.hint.card));
        parts.push(el('span', 'htext', g.turn === 0 ? 'from North' : 'from your hand'));
      }
      fill(hint, parts);
      hint.hidden = false;
    } else hint.hidden = true;

    renderBidbox();
    $('over-row').hidden = g.phase !== 'over';
  }

  // ---------- bidding box ----------
  function defaultLevel() {
    const g = S.game;
    for (let L = 1; L <= 7; L++) if (g.isLegalCall(E.mkBid(L, 4))) return L;
    return null;
  }
  function buildBidbox() {
    const lv = $('bb-levels'), st = $('bb-strains');
    for (let L = 1; L <= 7; L++) {
      const b = el('button', 'bb lv', String(L));
      b.type = 'button'; b.id = 'bb-l' + L; b.dataset.level = String(L);
      b.setAttribute('aria-label', 'Level ' + L);
      lv.appendChild(b);
    }
    for (let s = 0; s < 5; s++) {
      const b = el('button', 'bb st');
      b.type = 'button'; b.id = 'bb-s' + s; b.dataset.strain = String(s);
      st.appendChild(b);
    }
    lv.addEventListener('click', function (ev) {
      const b = ev.target.closest ? ev.target.closest('button[data-level]') : null;
      if (!b || b.disabled) return;
      S.selLevel = Number(b.dataset.level);
      renderBidbox();
    });
    st.addEventListener('click', function (ev) {
      const b = ev.target.closest ? ev.target.closest('button[data-strain]') : null;
      if (!b || b.disabled || S.selLevel === null) return;
      humanCall(E.mkBid(S.selLevel, Number(b.dataset.strain)));
    });
    $('bb-pass').addEventListener('click', function () { humanCall(PASS); });
    $('bb-dbl').addEventListener('click', function () { humanCall(DBL); });
    $('bb-rdbl').addEventListener('click', function () { humanCall(RDBL); });
  }
  function renderBidbox() {
    const g = S.game, box = $('bidbox');
    const live = g.phase === 'auction' && g.turn === HUMAN;
    box.hidden = !(g.phase === 'auction' || (S.showAuction && !!g.contract));
    box.classList.toggle('live', live);
    if (live && (S.selLevel === null || !g.isLegalCall(E.mkBid(S.selLevel, 4)))) S.selLevel = defaultLevel();
    const hintCall = live && S.hint && S.hint.call !== undefined && S.hint.key === posKey() ? S.hint.call : -1;
    const hintLevel = hintCall >= 3 ? E.bidLevel(hintCall) : -1;
    for (let L = 1; L <= 7; L++) {
      const b = $('bb-l' + L);
      b.disabled = !live || !g.isLegalCall(E.mkBid(L, 4));
      b.classList.toggle('sel', live && S.selLevel === L);
      b.classList.toggle('hinted', hintLevel === L && S.selLevel !== L);
    }
    for (let s = 0; s < 5; s++) {
      const b = $('bb-s' + s);
      const call = S.selLevel !== null ? E.mkBid(S.selLevel, s) : -1;
      b.disabled = !live || call < 0 || !g.isLegalCall(call);
      const parts = [];
      if (live && S.selLevel !== null) parts.push(el('b', '', String(S.selLevel)));
      parts.push(s === 4 ? el('span', 'nt', 'NT') : pip(s));
      fill(b, parts);
      b.setAttribute('aria-label', (S.selLevel !== null ? S.selLevel + ' ' : '') + STRAIN_NAME[s]);
      b.classList.toggle('hinted', hintCall >= 3 && hintCall === call);
    }
    $('bb-pass').disabled = !live;
    $('bb-dbl').disabled = !live || !g.isLegalCall(DBL);
    $('bb-rdbl').disabled = !live || !g.isLegalCall(RDBL);
    $('bb-pass').classList.toggle('hinted', hintCall === PASS);
    $('bb-dbl').classList.toggle('hinted', hintCall === DBL);
    $('bb-rdbl').classList.toggle('hinted', hintCall === RDBL);
  }

  // ---------- sheets ----------
  function openSheet(name) {
    S.sheet = name;
    ['result', 'review', 'menu'].forEach(function (n) { $('sheet-' + n).hidden = n !== name; });
    if (name === 'result') renderResult();
    if (name === 'review') renderReview();
    if (name === 'menu') renderMenu();
    const first = $('sheet-' + name).querySelector('[data-close]');
    if (first && document.activeElement && document.activeElement !== document.body) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function closeSheet() {
    S.sheet = null;
    ['result', 'review', 'menu'].forEach(function (n) { $('sheet-' + n).hidden = true; });
    $('m-confirm').hidden = true;
  }

  function resultCode(made) { return made === 0 ? '=' : made > 0 ? '+' + made : '−' + (-made); }
  function outcomeText(g) {
    const r = g.result;
    if (r.passedOut) return 'All four players passed. No score.';
    const need = g.contract.level + 6;
    let s;
    if (r.made === 0) s = 'Made exactly, ' + r.declTricks + ' tricks.';
    else if (r.made > 0) s = 'Made with ' + r.made + (r.made === 1 ? ' overtrick' : ' overtricks') + ', ' + r.declTricks + ' tricks.';
    else s = 'Down ' + (-r.made) + ': ' + r.declTricks + ' of the ' + need + ' tricks needed.';
    if (r.nsScore > 0) s += ' ' + r.nsScore + ' to your side.';
    else if (r.nsScore < 0) s += ' ' + (-r.nsScore) + ' to East-West.';
    return s;
  }
  // Your table next to the bots' table for the deal on show.
  function compareWhy(h) {
    const b = h.bots;
    if (h.passedOut && b.passedOut) return '';
    if (h.passedOut) return 'Your table passed the deal out; the bots found a contract.';
    if (b.passedOut) return 'The bots passed this deal out.';
    const same = h.level === b.level && h.strain === b.strain && h.doubled === b.doubled && (h.declarer & 1) === (b.declarer & 1);
    if (!same) return 'The two tables reached different contracts.';
    const d = h.tricks - b.tricks, n = Math.abs(d), tw = n === 1 ? ' trick' : ' tricks';
    if (d === 0) return 'Same contract, same number of tricks.';
    if ((h.declarer & 1) === 0) return 'Same contract: as declarer you took ' + n + (d > 0 ? ' more' : ' fewer') + tw + ' than the bot.';
    return d < 0 ? 'Same contract: your defence took ' + n + ' more' + tw + ' than the bots\u2019 defence.'
      : 'Same contract: the bots\u2019 defence took ' + n + ' more' + tw + ' than yours.';
  }
  function renderCompare() {
    const g = S.game, h = histEntry(g.board), body = $('cmp-body');
    if (!body) return;
    if (!h) { fill(body, []); return; }
    const row = function (who, e) {
      const r = el('div', 'cmp-row');
      r.appendChild(el('span', 'cmp-who', who));
      const what = el('span', 'cmp-what');
      if (e.passedOut) what.appendChild(el('span', 'cmp-code', 'Passed out'));
      else {
        what.appendChild(callChip(E.mkBid(e.level, e.strain)));
        what.appendChild(el('span', 'cmp-code', (e.doubled === 2 ? 'XX ' : e.doubled === 1 ? 'X ' : '') + 'by ' + E.SEAT_CH[e.declarer] + ' ' + resultCode(e.made)));
      }
      r.appendChild(what);
      r.appendChild(el('span', 'cmp-tricks', e.passedOut ? '' : e.tricks + (e.tricks === 1 ? ' trick' : ' tricks')));
      r.appendChild(el('span', 'cmp-score', signed(e.ns)));
      return r;
    };
    const parts = [row('You', h)];
    if (h.bots) {
      parts.push(row('Bots', h.bots));
      const diff = h.ns - h.bots.ns, imps = E.impsFor(diff);
      const unit = Math.abs(imps) === 1 ? ' IMP' : ' IMPs';
      const v = el('p', 'cmp-verdict' + (diff > 0 ? ' plus' : diff < 0 ? ' minus' : ''));
      v.id = 'cmp-verdict';
      v.textContent = diff === 0 ? 'Flat board: the same score as the bots.'
        : diff > 0 ? 'You beat the bots by ' + diff + (imps ? ', worth ' + signed(imps) + unit + '.' : ' (too little for an IMP).')
          : 'The bots did ' + (-diff) + ' better' + (imps ? ', worth ' + signed(imps) + unit + ' to you.' : ' (too little for an IMP).');
      parts.push(v);
      const why = compareWhy(h);
      if (why) parts.push(el('p', 'cmp-note', why));
    } else if (CMP.busy && CMP.busy.board === g.board && CMP.busy.kind === 'replay') {
      const pr = CMP.progress, playing = !!pr && pr.phase !== 'auction', t = playing ? Math.min(13, pr.tricks) : 0;
      const w = el('div', 'cmp-wait');
      w.appendChild(el('span', '', playing ? 'Four bots are playing these same cards: trick ' + Math.min(13, t + 1) + ' of 13' : 'Four bots are bidding these same cards'));
      const bar = el('div', 'cmp-bar'), f = el('div', 'cmp-bar-fill');
      f.style.width = Math.round(100 * (0.06 + 0.94 * t / 13)) + '%';
      bar.appendChild(f); w.appendChild(bar);
      parts.push(w);
    } else if (h.botsFailed) parts.push(el('p', 'cmp-note', 'The bots could not replay this deal.'));
    else parts.push(el('p', 'cmp-note', 'Waiting for the bots to replay this deal.'));
    if (!h.passedOut && Number.isInteger(h.dd)) {
      const d = h.tricks - h.dd, n = Math.abs(d), ours = (h.declarer & 1) === 0;
      let t = 'With perfect play by all four hands, declarer takes ' + h.dd + (h.dd === 1 ? ' trick' : ' tricks') + ' in ' + (ours ? 'your' : 'their') + ' contract';
      t += d === 0 ? ': exactly what happened.' : ours ? ': you took ' + n + (d > 0 ? ' more.' : ' fewer.') : d > 0 ? ': they took ' + n + ' more against you.' : ': you held them to ' + n + ' fewer.';
      parts.push(el('p', 'cmp-note', t));
    }
    fill(body, parts);
  }
  function renderResult() {
    const g = S.game, r = g.result;
    if (!r) return;
    $('res-board').textContent = 'Board ' + g.board + ' · ' + VUL_TEXT[g.vul];
    if (r.passedOut) fill($('res-title'), ['Passed out']);
    else fill($('res-title'), contractParts(g.contract).concat([el('span', '', 'by ' + E.SEAT_NAME[g.declarer])]));
    $('res-outcome').textContent = outcomeText(g);
    const sc = $('res-score');
    sc.className = 'res-score' + (r.nsScore > 0 ? ' plus' : r.nsScore < 0 ? ' minus' : '');
    sc.textContent = signed(r.nsScore);

    renderCompare();

    // board by board against the bots: your North-South score, theirs with the same cards, and the IMP difference
    const pad = $('pad');
    const cells = [el('span', 'ph', 'Board'), el('span', 'ph num', 'You'), el('span', 'ph num', 'Bots'), el('span', 'ph num imp', 'IMPs')];
    let total = 0, compared = 0;
    S.history.forEach(function (h) {
      const cur = h.board === g.board ? ' cur' : '';
      const cell = el('span', 'pc' + cur);
      cell.appendChild(el('span', 'bno', String(h.board)));
      if (h.passedOut) cell.appendChild(el('span', 'code', 'Passed out'));
      else {
        cell.appendChild(callChip(E.mkBid(h.level, h.strain)));
        cell.appendChild(el('span', 'code', (h.doubled === 2 ? 'XX ' : h.doubled === 1 ? 'X ' : '') + E.SEAT_CH[h.declarer] + ' ' + resultCode(h.made)));
      }
      const imps = h.bots ? E.impsFor(h.ns - h.bots.ns) : null;
      if (imps !== null) { total += imps; compared++; }
      cells.push(cell, el('span', 'num' + cur, signed(h.ns)), el('span', 'num' + cur, h.bots ? signed(h.bots.ns) : '…'),
        el('span', 'num imp' + cur + (imps > 0 ? ' gain' : imps < 0 ? ' loss' : ''), imps === null ? '…' : signed(imps)));
    });
    cells.push(el('span', 'tot', 'Against the bots'), el('span', 'tot num', ''), el('span', 'tot num', ''),
      el('span', 'tot num imp' + (total > 0 ? ' gain' : total < 0 ? ' loss' : ''), compared ? signed(total) : '…'));
    fill(pad, cells);
    const boards = compared + (compared === 1 ? ' board.' : ' boards.');
    $('pad-net').textContent = !compared ? 'Four bots replay each deal with the same cards. The difference is scored in IMPs, as in duplicate.'
      : total === 0 ? 'Level with the bots after ' + boards
        : total > 0 ? 'You are ' + total + (total === 1 ? ' IMP' : ' IMPs') + ' ahead of the bots after ' + boards
          : 'You are ' + (-total) + (total === -1 ? ' IMP' : ' IMPs') + ' behind the bots after ' + boards;

    // the four original hands
    const deal = $('res-deal'), area = ['n', 'e', 's', 'w'], hands = [];
    for (let seat = 0; seat < 4; seat++) {
      const d = el('div', 'dh');
      d.style.gridArea = area[seat];
      d.appendChild(el('div', 'dname', E.SEAT_NAME[seat] + ' · ' + hcp(g.hands[seat])));
      d.appendChild(diagram(g.hands[seat]));
      hands.push(d);
    }
    const c = el('div', 'dc');
    c.appendChild(el('div', '', 'Dealer ' + E.SEAT_CH[g.dealer]));
    c.appendChild(el('div', '', VUL_TEXT[g.vul]));
    c.appendChild(el('div', '', 'High-card points shown'));
    hands.push(c);
    fill(deal, hands);
  }

  function renderReview() {
    const g = S.game;
    const head = ['Board ' + g.board];
    if (g.contract) head.push(E.SEAT_NAME[g.declarer] + ' declares');
    $('rev-board').textContent = head.join(' · ');
    renderAuction($('rev-auction'));
    renderMeaning($('rev-meaning'));
    const list = $('rev-tricks');
    if (!g.tricks.length) { fill(list, [el('p', 'empty-note', 'No tricks have been played yet.')]); return; }
    const rows = [];
    const hd = el('div', 'tl-row head');
    hd.appendChild(el('span', '', ''));
    AU_ORDER.forEach(function (seat) { hd.appendChild(el('span', '', E.SEAT_CH[seat])); });
    rows.push(hd);
    g.tricks.forEach(function (t, i) {
      const row = el('div', 'tl-row');
      row.appendChild(el('span', 'tl-n', String(i + 1)));
      AU_ORDER.forEach(function (seat) {
        const card = t.cards[(seat - t.leader) & 3], s = E.cardSuit(card);
        const cell = el('span', 'tl-c' + (seat === t.leader ? ' lead' : '') + (seat === t.winner ? ' win' : ''));
        cell.appendChild(pip(s));
        cell.appendChild(el('b', '', E.rankText(E.cardRank(card))));
        cell.setAttribute('aria-label', E.SEAT_NAME[seat] + ': ' + RANK_NAME[E.cardRank(card)] + ' of ' + SUIT_NAME[s] + (seat === t.winner ? ', wins' : ''));
        row.appendChild(cell);
      });
      rows.push(row);
    });
    fill(list, rows);
  }

  function renderMenu() {
    const pressed = function (id, v) {
      $(id).querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); });
    };
    pressed('set-speed', S.settings.speed);
    pressed('set-level', S.settings.level);
    $('set-four').checked = !!S.settings.fourColour;
    $('m-replay').disabled = false;
    const body = $('notes-body');
    const notes = Array.isArray(E.BIDDING_NOTES) ? E.BIDDING_NOTES : [];
    const parts = [];
    notes.forEach(function (sec) {
      if (!sec) return;
      if (sec.title) { const h = el('h4'); h.appendChild(rich(sec.title)); parts.push(h); }
      const ul = el('ul');
      (sec.items || []).forEach(function (it) { const li = el('li'); li.appendChild(rich(it)); ul.appendChild(li); });
      parts.push(ul);
    });
    if (!parts.length) parts.push(el('p', '', 'The bots bid a natural system.'));
    fill(body, parts);
  }

  // ---------- wiring ----------
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    buildBidbox();
    bindFan($('hand-s'));
    bindFan($('hand-n'));
    // a pointer released anywhere else ends a drag without playing
    window.addEventListener('pointerup', function (ev) {
      if (!S.drag || S.drag.id !== ev.pointerId) return;
      const node = S.drag.node;
      S.drag = null;
      setLift(node, null);
      $('preview').hidden = true;
    });

    $('btn-undo').addEventListener('click', doUndo);
    $('btn-hint').addEventListener('click', doHint);
    $('btn-review').addEventListener('click', function () { openSheet('review'); });
    $('btn-menu').addEventListener('click', function () { openSheet('menu'); });
    $('btn-result').addEventListener('click', function () { openSheet('result'); });
    $('btn-next').addEventListener('click', nextDeal);
    $('res-next').addEventListener('click', nextDeal);
    $('res-replay').addEventListener('click', replayDeal);
    $('m-replay').addEventListener('click', replayDeal);
    $('m-new').addEventListener('click', function () { $('m-confirm').hidden = false; $('m-new-yes').focus({ preventScroll: true }); });
    $('m-keep').addEventListener('click', function () { $('m-confirm').hidden = true; });
    $('m-new-yes').addEventListener('click', newMatch);

    const auctionTap = function (ev) {
      const b = ev.target.closest ? ev.target.closest('[data-idx]') : null;
      if (b) showMeaning(Number(b.dataset.idx));
    };
    $('auction').addEventListener('click', auctionTap);
    $('rev-auction').addEventListener('click', auctionTap);

    document.querySelectorAll('.sheet').forEach(function (sh) {
      sh.addEventListener('click', function (ev) {
        if (ev.target === sh || (ev.target.closest && ev.target.closest('[data-close]'))) closeSheet();
      });
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && S.sheet) closeSheet(); });

    $('set-speed').addEventListener('click', function (ev) {
      const b = ev.target.closest ? ev.target.closest('button[data-v]') : null;
      if (!b || !PACE[b.dataset.v]) return;
      S.settings.speed = b.dataset.v; save(); renderMenu();
    });
    $('set-level').addEventListener('click', function (ev) {
      const b = ev.target.closest ? ev.target.closest('button[data-v]') : null;
      if (!b) return;
      S.settings.level = Math.min(3, Math.max(1, Number(b.dataset.v) || 2)); save(); renderMenu();
    });
    $('set-four').addEventListener('change', function () {
      S.settings.fourColour = $('set-four').checked; save(); render();
    });

    const relayout = function () { layout(); render(); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe($('app'));
    else window.addEventListener('resize', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout, function () { /* ignore */ });
  }

  function start(data) {
    const hot = window.claude && window.claude.hot;
    const d = data && data.game ? data : (hot && hot.data && hot.data.game ? hot.data : load());
    let ok = false;
    if (d) { try { restore(d); ok = true; } catch (e) { ok = false; } }
    if (!ok) { S.boardNo = 1; S.history = []; S.recorded = false; S.texts = {}; S.game = new E.Game(E.newDeal(1)); }
    bind();
    layout();
    save();
    advance();
  }

  // read-only handle for tests and debugging
  window.PocketBridge = {
    setWatchdog: function (ms) { watchdogMs = Math.max(200, Number(ms) || 25000); },
    state: function () {
      const g = S.game;
      return {
        phase: g.phase, turn: g.turn, board: g.board, dealer: g.dealer, vul: g.vul,
        declarer: g.declarer, dummy: g.dummy, contract: g.contract, result: g.result,
        calls: g.calls.length, plays: g.plays.length, taken: g.taken.slice(),
        lastBid: g.auction.lastBid, lastBidder: g.auction.lastBidder, doubled: g.auction.doubled,
        humanToAct: humanToAct(), hold: !!S.hold, showAuction: S.showAuction, thinking: S.thinking,
        sheet: S.sheet, hint: S.hint, history: S.history.slice(), settings: Object.assign({}, S.settings),
        usingWorker: AIClient.usingWorker(), comparing: !!CMP.busy, compareQueue: CMP.queue.length
      };
    }
  };

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(function () { return snapshot(); }); } catch (e) { /* ignore */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
