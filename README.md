# Pocket Bridge

Contract bridge for one player, built for a phone. You sit South with a bot partner (North)
against two bot opponents. The app deals random hands, runs a full auction and the play of the
cards under the rules of the game, and scores each deal by duplicate scoring.

After every deal, four bots bid and play the **same cards** in the background. The result panel
puts your table next to theirs (contract, tricks, score) and scores the difference in IMPs, the
way two tables are compared in duplicate bridge.

Everything runs in the browser. There is no server and no language model: the bots are a
rule-based bidding system plus a double-dummy search for card play.

## Play it

Open `docs/index.html` in a browser, or host that one file anywhere static.
On an iPhone, open the hosted page in Safari and use Share > Add to Home Screen for a full-screen app.

- You play South. When North-South win the auction you play both hands (declarer and dummy).
- Tap a level, then a strain, to bid. Press a card, slide to change, release to play.
- Undo takes back your last call or card. Hint shows what a bot would do.
- Tap any call in the auction to see what it means in the bots' system.

## Hosting

The whole app is the single file `docs/index.html`, so any static host works.

- **Cloudflare Workers:** `deploy/cloudflare.sh` uploads the file as a small Worker
  (`deploy/worker.js`) and turns on its `workers.dev` address. It needs
  `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with the Workers Scripts: Edit permission.

  ```bash
  CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... deploy/cloudflare.sh
  ```

- **GitHub Pages:** in the repository settings choose Pages, deploy from the `main` branch,
  folder `/docs`.

## How the bots work

- **Bidding** (`src/bid-*.js`, `src/bidding.js`): Standard American (five-card majors, 15-17 1NT,
  Stayman, Jacoby transfers, strong 2C, weak twos, Jacoby 2NT, Blackwood, takeout and negative
  doubles). Each rule is a call plus the hand it promises. The same rules are used to choose a
  call and to read partner's and opponents' calls, so every bot knows what a bid shows.
- **Card play** (`src/play.js`): a bot never sees hidden cards. It deals the unseen cards at
  random many times, consistent with the bidding and with suits players have shown out of,
  solves each layout with the double-dummy solver (`src/dds.js`), and plays the card with the
  best average score. Opening leads follow standard lead conventions, checked by the same analysis.
- **Rules and scoring** (`src/core.js`): dealing, legal calls, contract and declarer, following
  suit, trick winners, duplicate scoring, IMP scale.

## Build and test

Needs Node 18+. No dependencies for the engine; the interface tests use Playwright.

```bash
node build.js            # writes dist/ and docs/index.html
npm test                 # rules, scoring, bidding fuzz, card-play invariants, solver vs brute force
npm run test:ui          # full deals driven through the real page in headless Chromium
```

`test/bidlab.js`, `test/bidstats.js` and `test/playlab.js` print sample auctions, bidding
statistics, and bot-versus-bot deals compared with double-dummy results.

## Layout

```
src/core.js        rules, scoring, game state
src/dds.js         double-dummy solver
src/bid-*.js       bidding system        src/bidding.js   rule dispatcher, system notes
src/play.js        card-play engine      src/ai.js        entry points (also the Web Worker)
src/aiclient.js    page-side worker client
src/ui.js, page.html, style.css          the table interface
build.js           bundles everything into one HTML file
deploy/            Cloudflare Worker and deploy script
```
