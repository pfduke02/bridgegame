// ===== core.js — cards, dealing, auction rules, play rules, scoring =====
// Conventions shared by every engine file:
//   suits   0=clubs 1=diamonds 2=hearts 3=spades      strain 4 = notrump
//   ranks   0..12 (deuce..ace)                        card = suit*13 + rank
//   seats   0=North 1=East 2=South 3=West (clockwise) side = seat & 1 (0 = NS, 1 = EW)
//   calls   0=Pass 1=Double 2=Redouble, bids 3..37 = 3 + (level-1)*5 + strain

const NT = 4;
const SUIT_SYM = ['♣', '♦', '♥', '♠'];
const STRAIN_TEXT = ['♣', '♦', '♥', '♠', 'NT'];
const RANK_CH = '23456789TJQKA';
const SEAT_CH = 'NESW';
const SEAT_NAME = ['North', 'East', 'South', 'West'];
const PASS = 0;
const DBL = 1;
const RDBL = 2;

function cardSuit(c) { return (c / 13) | 0; }
function cardRank(c) { return c % 13; }
function mkCard(s, r) { return s * 13 + r; }
function rankText(r) { return r === 8 ? '10' : RANK_CH[r]; }
function cardText(c) { return SUIT_SYM[cardSuit(c)] + rankText(cardRank(c)); }

function mkBid(level, strain) { return 3 + (level - 1) * 5 + strain; }
function isBid(c) { return c >= 3; }
function bidLevel(c) { return (((c - 3) / 5) | 0) + 1; }
function bidStrain(c) { return (c - 3) % 5; }
// Compact ASCII name: P, X, XX, 1C .. 7N
function callName(c) {
  if (c === PASS) return 'P';
  if (c === DBL) return 'X';
  if (c === RDBL) return 'XX';
  return bidLevel(c) + 'CDHSN'[bidStrain(c)];
}
function parseCall(s) {
  s = String(s).trim().toUpperCase();
  if (s === 'P' || s === 'PASS') return PASS;
  if (s === 'X' || s === 'DBL') return DBL;
  if (s === 'XX' || s === 'RDBL') return RDBL;
  const level = s.charCodeAt(0) - 48;
  const strain = 'CDHSN'.indexOf(s[1]);
  if (level < 1 || level > 7 || strain < 0) throw new Error('bad call: ' + s);
  return mkBid(level, strain);
}
// Display text: Pass, Dbl, Rdbl, 1♣ .. 7NT
function callText(c) {
  if (c === PASS) return 'Pass';
  if (c === DBL) return 'Dbl';
  if (c === RDBL) return 'Rdbl';
  return bidLevel(c) + STRAIN_TEXT[bidStrain(c)];
}

// ---------- randomness ----------
// Unbiased integer in [0, n) from the platform's cryptographic generator when present.
function coreRandInt(n) {
  const g = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto : null;
  if (g) {
    const buf = new Uint32Array(1);
    const lim = Math.floor(4294967296 / n) * n;
    for (;;) { g.getRandomValues(buf); if (buf[0] < lim) return buf[0] % n; }
  }
  return Math.floor(Math.random() * n);
}
// Small fast seedable generator (for tests and for the AI's sampling).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- dealing ----------
// Fisher-Yates shuffle of the 52 cards, 13 to each seat. `rand` (optional) is a () => [0,1) generator.
function dealCards(rand) {
  const deck = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  for (let i = 51; i > 0; i--) {
    const j = rand ? Math.floor(rand() * (i + 1)) : coreRandInt(i + 1);
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  const hands = [[], [], [], []];
  for (let i = 0; i < 52; i++) hands[i & 3].push(deck[i]);
  for (const h of hands) h.sort(function (a, b) { return b - a; });
  return hands;
}

// Standard duplicate board rotation: dealer and vulnerability from the board number.
// vul: 0 = none, 1 = NS, 2 = EW, 3 = both
const VUL_TABLE = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
function boardDealer(board) { return (board - 1) & 3; }
function boardVul(board) { return VUL_TABLE[(board - 1) % 16]; }
function seatVul(vul, seat) { return (seat & 1) === 0 ? (vul & 1) !== 0 : (vul & 2) !== 0; }
function newDeal(board, rand) {
  return { board: board, dealer: boardDealer(board), vul: boardVul(board), hands: dealCards(rand) };
}

// ---------- auction ----------
function auctionInfo(dealer, calls) {
  let lastBid = -1, lastBidder = -1, doubled = 0, passes = 0;
  const firstBy = [[-1, -1, -1, -1, -1], [-1, -1, -1, -1, -1]]; // [side][strain] -> first seat to name it
  for (let i = 0; i < calls.length; i++) {
    const seat = (dealer + i) & 3, c = calls[i];
    if (c === PASS) passes++;
    else {
      passes = 0;
      if (c === DBL) doubled = 1;
      else if (c === RDBL) doubled = 2;
      else {
        lastBid = c; lastBidder = seat; doubled = 0;
        const st = bidStrain(c), side = seat & 1;
        if (firstBy[side][st] < 0) firstBy[side][st] = seat;
      }
    }
  }
  const n = calls.length;
  const finished = lastBid < 0 ? n >= 4 : passes >= 3;
  let contract = null;
  if (finished && lastBid >= 0) {
    const st = bidStrain(lastBid);
    contract = { level: bidLevel(lastBid), strain: st, doubled: doubled, declarer: firstBy[lastBidder & 1][st] };
  }
  return {
    lastBid: lastBid, lastBidder: lastBidder, doubled: doubled, passes: passes,
    finished: finished, passedOut: finished && lastBid < 0, turn: (dealer + n) & 3, contract: contract
  };
}
function isLegalCall(info, call) {
  if (info.finished) return false;
  if (call === PASS) return true;
  if (call === DBL) return info.lastBid >= 0 && info.doubled === 0 && ((info.lastBidder ^ info.turn) & 1) === 1;
  if (call === RDBL) return info.lastBid >= 0 && info.doubled === 1 && ((info.lastBidder ^ info.turn) & 1) === 0;
  return Number.isInteger(call) && call > info.lastBid && call >= 3 && call <= 37;
}
function legalCalls(info) {
  const out = [];
  for (let c = 0; c <= 37; c++) if (isLegalCall(info, c)) out.push(c);
  return out;
}

// ---------- play ----------
// cards: the four cards of a trick in the order played, starting with `leader`.
function trickWinner(leader, cards, trump) {
  let best = 0;
  for (let i = 1; i < 4; i++) {
    const c = cards[i], b = cards[best];
    const cs = cardSuit(c), bs = cardSuit(b);
    if (cs === bs) { if (c > b) best = i; }
    else if (cs === trump) best = i;
  }
  return (leader + best) & 3;
}

// Everything that is public once the auction is over: tricks, whose turn, who played what.
function publicPlayState(dealer, calls, plays) {
  const a = auctionInfo(dealer, calls);
  if (!a.finished || !a.contract) return null;
  const c = a.contract, trump = c.strain;
  let leader = (c.declarer + 1) & 3, cur = [];
  const tricks = [], taken = [0, 0];
  const playedBy = new Array(52).fill(-1);
  for (let i = 0; i < plays.length; i++) {
    playedBy[plays[i]] = (leader + cur.length) & 3;
    cur.push(plays[i]);
    if (cur.length === 4) {
      const w = trickWinner(leader, cur, trump);
      tricks.push({ leader: leader, cards: cur, winner: w });
      taken[w & 1]++;
      leader = w; cur = [];
    }
  }
  return {
    contract: c, declarer: c.declarer, dummy: (c.declarer + 2) & 3, trump: trump,
    tricks: tricks, leader: leader, cur: cur, turn: (leader + cur.length) & 3,
    taken: taken, playedBy: playedBy, over: tricks.length === 13
  };
}

// ---------- scoring (duplicate) ----------
// Returns the score for declarer's side: positive when the contract makes, negative when it fails.
// doubled: 0 / 1 / 2 (redoubled). vul: is declarer's side vulnerable. tricks: tricks declarer took (0..13).
function scoreContract(level, strain, doubled, vul, tricks) {
  const need = level + 6;
  if (tricks >= need) {
    const over = tricks - need;
    const per = strain <= 1 ? 20 : 30;
    let trickScore = per * level + (strain === NT ? 10 : 0);
    trickScore <<= doubled;
    let s = trickScore;
    s += trickScore >= 100 ? (vul ? 500 : 300) : 50;       // game or part-score bonus
    if (level === 6) s += vul ? 750 : 500;                  // small slam
    else if (level === 7) s += vul ? 1500 : 1000;           // grand slam
    if (doubled) s += 50 * doubled;                         // "insult" for making a (re)doubled contract
    if (doubled === 0) s += over * per;
    else s += over * (vul ? 200 : 100) * doubled;
    return s;
  }
  const down = need - tricks;
  if (doubled === 0) return -down * (vul ? 100 : 50);
  let p;
  if (vul) p = 200 + (down - 1) * 300;
  else p = down === 1 ? 100 : down === 2 ? 300 : 500 + (down - 3) * 300;
  return -p * doubled;
}

// International Match Points for a score difference (the scale used to compare two tables in duplicate).
const IMP_STEPS = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
function impsFor(diff) {
  const a = Math.abs(diff);
  let n = 0;
  while (n < IMP_STEPS.length && a >= IMP_STEPS[n]) n++;
  return diff < 0 ? -n : n;
}

// ---------- game state ----------
// A deal in progress, driven by two logs (calls, plays); all other fields are derived by sync().
function Game(deal) {
  this.board = deal.board;
  this.dealer = deal.dealer;
  this.vul = deal.vul;
  this.hands = deal.hands.map(function (h) { return h.slice().sort(function (a, b) { return b - a; }); });
  this.calls = (deal.calls || []).slice();
  this.plays = (deal.plays || []).slice();
  this.sync();
}
Game.prototype.sync = function () {
  const a = this.auction = auctionInfo(this.dealer, this.calls);
  this.contract = a.contract;
  this.declarer = a.contract ? a.contract.declarer : -1;
  this.dummy = a.contract ? (a.contract.declarer + 2) & 3 : -1;
  this.rem = this.hands.map(function (h) { return h.slice(); });
  this.tricks = []; this.cur = null; this.taken = [0, 0]; this.result = null;
  if (!a.finished) { this.phase = 'auction'; this.turn = a.turn; return; }
  if (a.passedOut) {
    this.phase = 'over'; this.turn = -1;
    this.result = { passedOut: true, declTricks: 0, made: 0, score: 0, nsScore: 0 };
    return;
  }
  const ps = publicPlayState(this.dealer, this.calls, this.plays);
  for (let i = 0; i < this.plays.length; i++) {
    const seat = ps.playedBy[this.plays[i]];
    const k = this.rem[seat].indexOf(this.plays[i]);
    if (k < 0) throw new Error('play log is inconsistent with the deal');
    this.rem[seat].splice(k, 1);
  }
  this.tricks = ps.tricks;
  this.taken = ps.taken;
  if (ps.over) {
    const c = this.contract, declTricks = ps.taken[this.declarer & 1];
    const sc = scoreContract(c.level, c.strain, c.doubled, seatVul(this.vul, this.declarer), declTricks);
    this.phase = 'over'; this.turn = -1;
    this.result = {
      passedOut: false, declTricks: declTricks, made: declTricks - (c.level + 6),
      score: sc, nsScore: (this.declarer & 1) === 0 ? sc : -sc
    };
    return;
  }
  this.phase = 'play';
  this.cur = { leader: ps.leader, cards: ps.cur };
  this.turn = ps.turn;
};
Game.prototype.isLegalCall = function (call) { return this.phase === 'auction' && isLegalCall(this.auction, call); };
Game.prototype.makeCall = function (call) {
  if (!this.isLegalCall(call)) throw new Error('illegal call ' + callName(call));
  this.calls.push(call);
  this.sync();
};
// Cards the seat on turn (default) may play: must follow the suit led when able.
Game.prototype.legalCards = function (seat) {
  if (this.phase !== 'play') return [];
  if (seat === undefined) seat = this.turn;
  const hand = this.rem[seat];
  if (seat === this.turn && this.cur.cards.length > 0) {
    const led = cardSuit(this.cur.cards[0]);
    const follow = hand.filter(function (c) { return cardSuit(c) === led; });
    if (follow.length) return follow;
  }
  return hand.slice();
};
Game.prototype.playCard = function (card) {
  if (this.phase !== 'play') throw new Error('not in the play phase');
  if (this.legalCards(this.turn).indexOf(card) < 0) throw new Error('illegal card ' + cardText(card));
  this.plays.push(card);
  this.sync();
};
// The seat that decides for `seat` during the play (declarer plays dummy's cards).
Game.prototype.actor = function (seat) {
  if (seat === undefined) seat = this.turn;
  return seat === this.dummy ? this.declarer : seat;
};
// Take back the last n actions (cards first, then calls).
Game.prototype.undo = function (n) {
  for (let i = 0; i < (n || 1); i++) {
    if (this.plays.length) this.plays.pop();
    else if (this.calls.length) this.calls.pop();
  }
  this.sync();
};
// What the player in `seat` is entitled to see. This is the only thing handed to the AI.
Game.prototype.view = function (seat) {
  const dummyShown = this.contract !== null && this.plays.length > 0;
  return {
    seat: seat, hand: this.hands[seat].slice(),
    dealer: this.dealer, vul: this.vul,
    calls: this.calls.slice(), plays: this.plays.slice(),
    dummyHand: dummyShown ? this.hands[this.dummy].slice() : null
  };
};
Game.prototype.toJSON = function () {
  return { board: this.board, dealer: this.dealer, vul: this.vul, hands: this.hands, calls: this.calls, plays: this.plays };
};
