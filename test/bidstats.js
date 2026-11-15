// Bidding sanity statistics: node test/bidstats.js [deals] [seed]
const load = require('./load.js');
const E = load(['Game', 'newDeal', 'mulberry32', 'callName', 'bidChooseCall', 'handFeatures']);
const N = +(process.argv[2] || 5000), seed = +(process.argv[3] || 1);
const rnd = E.mulberry32(seed);
const isGame = function (c) { return c.level >= 5 || (c.level === 4 && c.strain >= 2) || (c.level >= 3 && c.strain === 4); };
let deals = 0, err = 0, maxLen = 0;
const b = { gameWith: {}, partWith: {}, slamWith: {} };
let games = 0, gamesLight = 0, parts = 0, missed = 0, slams = 0, slamsLight = 0, sideWithMore = 0, passedOut = 0, poStrong = 0;
for (let t = 0; t < N; t++) {
  const g = new E.Game(E.newDeal(1 + (t % 16), rnd));
  let guard = 0;
  try {
    while (g.phase === 'auction') { g.makeCall(E.bidChooseCall(g.view(g.turn)).call); if (++guard > 80) throw new Error('long'); }
  } catch (e) { err++; console.log('ERR', e.message, g.calls.map(E.callName).join(' ')); continue; }
  deals++; maxLen = Math.max(maxLen, g.calls.length);
  const hcp = g.hands.map(function (h) { return E.handFeatures(h).hcp; });
  const ns = hcp[0] + hcp[2], ew = hcp[1] + hcp[3];
  if (!g.contract) { passedOut++; if (Math.max(ns, ew) >= 24) poStrong++; continue; }
  const c = g.contract, side = c.declarer & 1, pts = side === 0 ? ns : ew;
  if (pts >= 20) sideWithMore++;
  if (c.level >= 6) { slams++; if (pts < 30) slamsLight++; b.slamWith[pts] = (b.slamWith[pts] || 0) + 1; }
  else if (isGame(c)) { games++; if (pts < 23) gamesLight++; }
  else { parts++; if (pts >= 26) missed++; }
}
console.log('deals ' + deals + ', errors ' + err + ', longest auction ' + maxLen + ' calls, passed out ' + passedOut + ' (' + poStrong + ' with a side holding 24+)');
console.log('declaring side has the majority of points: ' + (100 * sideWithMore / (deals - passedOut)).toFixed(1) + '%');
console.log('games ' + games + ' (' + gamesLight + ' on fewer than 23 combined HCP), part scores ' + parts + ' (' + missed + ' with 26+ combined HCP), slams ' + slams + ' (' + slamsLight + ' on fewer than 30 HCP)');
console.log('slam HCP histogram ' + JSON.stringify(b.slamWith));
