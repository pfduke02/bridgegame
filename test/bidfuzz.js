// Fuzz: South (the human seat) makes arbitrary legal calls; the bots must stay legal and finish the auction.
// node test/bidfuzz.js [deals] [seed]
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'callName', 'bidChooseCall', 'bidExplainAuction', 'legalCalls', 'aiRun']);
const N = +(process.argv[2] || 3000), seed = +(process.argv[3] || 1);
const rnd = E.mulberry32(seed);
let errors = 0, maxLen = 0, explained = 0;
for (let t = 0; t < N; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  let guard = 0;
  try {
    while (g.phase === 'auction') {
      let call;
      if (g.turn === 2) {
        const legal = E.legalCalls(g.auction);
        const r = rnd();
        // mostly low calls, sometimes anything at all
        call = r < 0.35 ? 0 : r < 0.9 ? legal[Math.min(legal.length - 1, 1 + Math.floor(rnd() * 7))] : legal[Math.floor(rnd() * legal.length)];
      } else {
        const res = E.aiRun({ type: 'call', view: g.view(g.turn) });
        if (res.error) throw new Error('bot error: ' + res.error);
        call = res.call;
      }
      if (!g.isLegalCall(call)) throw new Error('illegal call ' + E.callName(call));
      g.makeCall(call);
      if (++guard > 120) throw new Error('auction did not end');
    }
    const texts = E.bidExplainAuction(g.dealer, g.vul, g.calls);
    if (texts.length !== g.calls.length || texts.some(function (x) { return typeof x !== 'string' || !x.length; })) throw new Error('bad explanations');
    explained += texts.length;
  } catch (e) {
    errors++;
    if (errors <= 5) console.log('ERROR ' + e.message + '\n  dealer ' + 'NESW'[g.dealer] + ': ' + g.calls.map(E.callName).join(' '));
  }
  maxLen = Math.max(maxLen, g.calls.length);
}
console.log('fuzzed auctions ' + N + ', errors ' + errors + ', longest ' + maxLen + ' calls, calls explained ' + explained);
process.exit(errors ? 1 : 0);
