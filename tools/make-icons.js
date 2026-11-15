// Draws the app icon and renders it at the sizes phones ask for:  node tools/make-icons.js
// Writes docs/icon.svg, docs/icon-180.png (iPhone home screen), docs/icon-192.png and docs/icon-512.png.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SUIT = [   // the same suit shapes the game uses (viewBox 0 0 100 100)
  '<circle cx="50" cy="28" r="20"/><circle cx="28" cy="58" r="20"/><circle cx="72" cy="58" r="20"/><circle cx="50" cy="52" r="11"/><path d="M50 50C50 70 46 86 37 96L63 96C54 86 50 70 50 50Z"/>',
  '<path d="M50 4C59 22 72 38 88 50C72 62 59 78 50 96C41 78 28 62 12 50C28 38 41 22 50 4Z"/>',
  '<path d="M50 94C24 72 8 56 8 35C8 20 19 9 32 9C40 9 46 13 50 20C54 13 60 9 68 9C81 9 92 20 92 35C92 56 76 72 50 94Z"/>',
  '<path d="M50 6C38 24 10 40 10 62C10 76 21 85 33 85C40 85 45 82 48 77C47 86 44 92 37 96L63 96C56 92 53 86 52 77C55 82 60 85 67 85C79 85 90 76 90 62C90 40 62 24 50 6Z"/>'
];
const INK = ['#1b1f22', '#c4202f', '#c4202f', '#1b1f22'];
// Four cards fanned from a pivot below them, one per suit, on the table's green baize.
const cards = [0, 1, 2, 3].map(function (s) {
  const angle = (s - 1.5) * 21;
  // each card shows its suit in the corner that stays visible in the fan; the front card also in the middle
  return '<g transform="rotate(' + angle + ' 256 452)">' +
    '<rect x="186" y="136" width="140" height="196" rx="16" fill="#fcf9f0" stroke="#b9b097" stroke-width="3"/>' +
    '<g transform="translate(196 148) scale(0.46)" fill="' + INK[s] + '">' + SUIT[s] + '</g>' +
    (s === 3 ? '<g transform="translate(222 206) scale(0.72)" fill="' + INK[s] + '">' + SUIT[s] + '</g>' : '') + '</g>';
}).join('');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<defs><radialGradient id="felt" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#22705a"/><stop offset="0.62" stop-color="#11433a"/><stop offset="1" stop-color="#08251e"/></radialGradient>' +
  '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.35"/></filter></defs>' +
  '<rect width="512" height="512" fill="url(#felt)"/><g filter="url(#sh)" transform="translate(0 22)">' + cards + '</g></svg>';

(async function () {
  const out = path.join(__dirname, '..', 'docs');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.svg'), svg);
  const browser = await chromium.launch();
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent('<html><body style="margin:0;background:#08251e">' + svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') + '</body></html>');
    await page.screenshot({ path: path.join(out, 'icon-' + size + '.png'), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log('wrote docs/icon.svg and docs/icon-{180,192,512}.png');
})();
