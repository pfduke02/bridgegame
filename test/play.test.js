// Card-play engine invariants: node test/play.test.js
// The sampler must only ever place unseen cards, respect hand sizes and shown-out suits,
// and the engine must always return a legal card without looking at hidden hands.
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'bidChooseCall', 'playMakeCtx', 'playSample', 'playStartJob', 'aiRun', 'cardSuit', 'cardRank', 'cardText', 'legalCalls']);
let failed = 0, checks = 0;
function ok(cond, label) { checks++; if (!cond) { failed++; if (failed <= 10) console.log('FAIL ' + label); } }
const rnd = E.mulberry32(99);
let positions = 0, samples = 0;
for (let t = 0; t < 60; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  while (g.phase === 'auction') g.makeCall(E.bidChooseCall(g.view(g.turn)).call);
  if (!g.contract) continue;
  while (g.phase === 'play') {
    const actor = g.actor(), view = g.view(actor);
    if (rnd() < 0.35) {
      const ctx = E.playMakeCtx(view);
      positions++;
      // the hand to play is one the decider may see, and the legal cards agree with the rules
      ok(JSON.stringify(ctx.legal.slice().sort()) === JSON.stringify(g.legalCards().slice().sort()), 'legal cards match');
      const hiddenTotal = ctx.hidden.reduce(function (a, h) { return a + ctx.size[h]; }, 0);
      ok(hiddenTotal === ctx.unknown.length, 'unseen cards = hidden hand sizes');
      for (const h of ctx.hidden) ok(h !== actor && !(view.dummyHand && h === g.dummy), 'visible hands are not sampled');
      for (let k = 0; k < 4; k++) {
        const hands = E.playSample(ctx, rnd);
        samples++;
        const seen = new Set();
        for (let i = 0; i < ctx.hidden.length; i++) {
          const h = ctx.hidden[i];
          ok(hands[i].length === g.rem[h].length, 'sampled hand size');
          for (const c of hands[i]) {
            ok(ctx.unknown.indexOf(c) >= 0, 'only unseen cards are dealt');
            ok(!seen.has(c), 'no card dealt twice'); seen.add(c);
            ok(!ctx.voidIn[h][E.cardSuit(c)], 'no card in a suit the hand has shown out of');
          }
        }
        ok(seen.size === ctx.unknown.length, 'every unseen card is placed');
      }
      // true layout is always among the possible ones: actual hidden hands respect the void flags
      for (const h of ctx.hidden) for (const c of g.rem[h]) ok(!ctx.voidIn[h][E.cardSuit(c)], 'void inference is sound');
    }
    // play on with a quick decision; must be legal
    view.seed = t * 1000 + g.plays.length;
    view.rulesOnly = g.rem[g.turn].length > 7;          // search only the cheap late positions here; playlab covers the rest
    const r = E.aiRun({ type: 'play', view: view, level: 1 });
    ok(!r.error, 'no engine error' + (r.error ? ': ' + r.error : ''));
    ok(g.legalCards().indexOf(r.card) >= 0, 'engine plays a legal card');
    g.playCard(g.legalCards().indexOf(r.card) >= 0 ? r.card : g.legalCards()[0]);
  }
}
// the view handed to a bot never contains a hidden hand
{
  const g = new E.Game(E.newDeal(5, rnd));
  while (g.phase === 'auction') g.makeCall(E.bidChooseCall(g.view(g.turn)).call);
  if (g.contract) {
    const v0 = g.view(g.actor());
    ok(v0.dummyHand === null, 'dummy is hidden before the opening lead');
    ok(Object.keys(v0).sort().join() === 'calls,dealer,dummyHand,hand,plays,seat,vul', 'view carries only public data and own hand');
    g.playCard(g.legalCards()[0]);
    const v1 = g.view(g.actor());
    ok(Array.isArray(v1.dummyHand) && v1.dummyHand.length === 13, 'dummy is shown after the opening lead');
  }
}
// four bots replay a deal (the comparison table): a complete, legal, correctly scored record
{
  const E2 = load(['Game', 'newDeal', 'mulberry32', 'aiStartJob', 'scoreContract', 'seatVul']);
  const r2 = E2.mulberry32(314);
  for (let t = 0; t < 3; t++) {
    const deal = E2.newDeal(1 + t, r2);
    const job = E2.aiStartJob({ type: 'replay', deal: deal, level: 1, seed: 11 + t });
    let steps = 0, sawProgress = false;
    while (!job.step(50)) { steps++; if (job.progress && job.progress.phase === 'play') sawProgress = true; if (steps > 20000) break; }
    const r = job.result;
    ok(!!r, 'replay finishes');
    if (!r) continue;
    const g = new E2.Game({ board: deal.board, dealer: deal.dealer, vul: deal.vul, hands: deal.hands, calls: r.calls, plays: r.plays });   // throws if any call or card was illegal
    ok(g.phase === 'over', 'replayed record is a complete deal');
    ok(g.result.nsScore === r.nsScore && g.result.declTricks === r.declTricks, 'replay result matches its own record');
    if (r.contract) {
      ok(r.plays.length === 52, 'all 52 cards played');
      ok(sawProgress, 'progress is reported during the play');
      const sc = E2.scoreContract(r.contract.level, r.contract.strain, r.contract.doubled, E2.seatVul(deal.vul, r.contract.declarer), r.declTricks);
      ok(((r.contract.declarer & 1) === 0 ? sc : -sc) === r.nsScore, 'replay score follows the scoring rules');
    } else ok(r.passedOut && r.nsScore === 0, 'passed-out replay scores nothing');
  }
}
console.log('positions ' + positions + ', samples ' + samples + ', ' + checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
