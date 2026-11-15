// Builds the single-file app:  node build.js
//   dist/artifact.html  page fragment for publishing (no doctype/html/head/body; the host adds them)
//   dist/bridge.html    the same app as a complete standalone document (host it anywhere, add to home screen)
//   docs/index.html     copy of the standalone app, committed so a static host can serve it
//   docs/manifest.webmanifest, docs/sw.js   home-screen install and offline play for the hosted app
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const TITLE = 'Pocket Bridge';
const read = function (f) { return fs.readFileSync(path.join(SRC, f), 'utf8'); };
const ICONS = ['icon-180.png', 'icon-192.png', 'icon-512.png'];     // drawn by tools/make-icons.js
const MANIFEST = {
  name: TITLE, short_name: 'Bridge',
  description: 'Contract bridge for one player: bid and play with a bot partner against two bot opponents.',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#08251e', theme_color: '#0f3d31',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
  ]
};

// Names the engine exposes to the page as BridgeEngine.<name> (only those that exist are exported).
const EXPORTS = [
  'NT', 'PASS', 'DBL', 'RDBL', 'SUIT_SYM', 'STRAIN_TEXT', 'RANK_CH', 'SEAT_CH', 'SEAT_NAME',
  'cardSuit', 'cardRank', 'mkCard', 'rankText', 'cardText',
  'mkBid', 'isBid', 'bidLevel', 'bidStrain', 'callName', 'parseCall', 'callText',
  'coreRandInt', 'mulberry32', 'dealCards', 'boardDealer', 'boardVul', 'seatVul', 'newDeal',
  'auctionInfo', 'isLegalCall', 'legalCalls', 'trickWinner', 'publicPlayState', 'scoreContract', 'impsFor', 'Game',
  'ddSolveBoard', 'ddSolve', 'ddReset', 'ddTable',
  'bidChooseCall', 'bidExplainAuction', 'BIDDING_NOTES', 'handFeatures',
  'playStartJob', 'aiStartJob', 'aiRun', 'aiWorkerMain', 'aiViewLegalCards'
];

function buildEngine() {
  const files = require('./engine-files.js').filter(function (f) { return fs.existsSync(path.join(SRC, f)); });
  const body = files.map(function (f) { return '// ---- ' + f + ' ----\n' + read(f); }).join('\n;\n');
  const names = EXPORTS.filter(function (n) {
    return new RegExp('(^|\\n)(function|const|let|var)\\s+' + n + '\\b').test(body);
  });
  return [
    'const BridgeEngine = (function () {',
    "'use strict';",
    body,
    'return {' + names.map(function (n) { return n + ': ' + n; }).join(', ') + '};',
    '})();',
    // When this same script text is loaded as a Web Worker, start answering AI requests.
    "if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) BridgeEngine.aiWorkerMain(self);",
    ''
  ].join('\n');
}

function build() {
  const engine = buildEngine();
  const css = read('style.css');
  const page = read('page.html');
  const app = read('aiclient.js') + '\n;\n' + read('ui.js');
  for (const [name, text] of [['engine', engine], ['app', app]]) {
    if (/<\/script/i.test(text)) throw new Error(name + ' script contains a closing script tag sequence');
  }
  const fonts = fs.existsSync(path.join(SRC, 'fonts.html')) ? read('fonts.html').trim() + '\n' : '';
  const core = [
    fonts + '<style>\n' + css + '\n</style>',
    page,
    '<script id="engine-src">\n' + engine + '</script>',
    '<script>\n' + app + '\n</script>',
    ''
  ].join('\n');

  const artifact = '<title>' + TITLE + '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + core;

  const standalone = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="Bridge">',
    '<meta name="theme-color" content="#0f3d31">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icon-180.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">',
    '<title>' + TITLE + '</title>',
    // the same small reset the publishing host applies
    '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);box-sizing:border-box}' +
      'body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>',
    '</head>',
    '<body>',
    core,
    // offline support once installed (not used by the published artifact, whose frame forbids service workers)
    "<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {" +
      " window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }</script>",
    '</body>',
    '</html>',
    ''
  ].join('\n');

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), artifact);
  fs.writeFileSync(path.join(ROOT, 'dist', 'bridge.html'), standalone);
  // the playable app, ready for static hosting (GitHub Pages can serve the docs/ folder)
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), standalone);
  fs.writeFileSync(path.join(ROOT, 'docs', 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');
  // The service worker's version changes whenever the app does, so phones pick up each new build.
  const version = require('crypto').createHash('sha256').update(standalone).update(JSON.stringify(MANIFEST))
    .update(ICONS.map(function (f) { return fs.existsSync(path.join(ROOT, 'docs', f)) ? fs.readFileSync(path.join(ROOT, 'docs', f)) : ''; }).join('|'))
    .digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(ROOT, 'docs', 'sw.js'), read('sw.js').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', 'manifest.webmanifest'].concat(ICONS))));
  console.log('built dist/artifact.html (' + (artifact.length / 1024).toFixed(0) + ' KB), dist/bridge.html and docs/index.html');
}

if (require.main === module) build();
module.exports = { buildEngine: buildEngine, build: build };
