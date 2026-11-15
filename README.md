# Pocket Bridge

Contract bridge for one player, built for a phone. You sit South with a bot partner (North)
against two bot opponents. The app deals random hands, runs a full auction and the play of the
cards under the rules of the game, and scores each deal by duplicate scoring.

After every deal, four bots bid and play the **same cards** in the background. The result panel
puts your table next to theirs (contract, tricks, score) and scores the difference in IMPs, the
way two tables are compared in duplicate bridge.

The result panel also reviews your own play: every card is checked against perfect play with all
four hands known, so you see which cards cost tricks and what the best card was, and every call
is compared with what the bots' system would have bid. During the play you can claim the
remaining tricks; the bots accept when those tricks are there with best play.

Everything runs in the browser. There is no server and no language model: the bots are a
rule-based bidding system plus a double-dummy search for card play.

## Play it

**Play now: https://bridgegame.fishman-da7.workers.dev/**

To run your own copy, open `docs/index.html` in a browser, or host that one file anywhere static.
On an iPhone, open the hosted page in Safari and use Share > Add to Home Screen. It installs with
its own icon, opens full-screen, and keeps working without a connection (a service worker stores
the game on the phone; each new build arrives the next time it is opened online).

- You play South. When North-South win the auction you play both hands (declarer and dummy).
- Tap a level, then a strain, to bid. Press a card, slide to change, release to play.
- Undo takes back your last call or card. Hint shows what a bot would do.
- Tap any call in the auction to see what it means in the bots' system.

## Hosting

The whole app is the single file `docs/index.html`, so any static host works.

- **Cloudflare Workers:** every push to `main` runs the tests and deploys
  (`.github/workflows/deploy.yml`), once the repository has a `CLOUDFLARE_API_TOKEN` secret
  made with Cloudflare's "Edit Cloudflare Workers" token template. To deploy by hand:

  ```bash
  CLOUDFLARE_API_TOKEN=... deploy/cloudflare.sh
  ```

  The script uploads `docs/` as a small Worker (`deploy/worker.js`), turns on its `workers.dev`
  address and checks that the live site serves the new build. Set `CLOUDFLARE_ACCOUNT_ID` if the
  token can see more than one account.

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

`npm run test:robust` runs the robustness checks in `test/robust/`: the rules, scoring and
dealing against independent references (`rules.js`); bots against chaotic and misleading players
and freak deals (`engine.js`); and the page against damaged saves, refused storage and workers,
random tapping with reloads and resizes, a long session and a range of screen sizes (`ui.js`).

## Layout

```
src/core.js        rules, scoring, game state
src/dds.js         double-dummy solver
src/bid-*.js       bidding system        src/bidding.js   rule dispatcher, system notes
src/play.js        card-play engine      src/ai.js        entry points (also the Web Worker)
src/aiclient.js    page-side worker client
src/ui.js, page.html, style.css          the table interface
src/sw.js          offline support for the installed app
tools/make-icons.js  draws the app icon (docs/icon-*.png)
build.js           bundles everything into one HTML file
deploy/            Cloudflare Worker and deploy script
```
