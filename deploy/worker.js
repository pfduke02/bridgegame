// Cloudflare Worker that serves the game. The files come from docs/ and are uploaded next to this
// script as modules by deploy/cloudflare.sh: text files as text, icons as binary data.
import html from './index.txt';
import sw from './sw.txt';
import manifest from './manifest.txt';
import icon180 from './icon-180.bin';
import icon192 from './icon-192.bin';
import icon512 from './icon-512.bin';

const PAGE = ['text/html; charset=utf-8', 'no-cache'];
const FILES = {
  '/': [html].concat(PAGE),
  '/index.html': [html].concat(PAGE),
  '/sw.js': [sw, 'text/javascript; charset=utf-8', 'no-cache'],
  '/manifest.webmanifest': [manifest, 'application/manifest+json; charset=utf-8', 'public, max-age=3600'],
  '/icon-180.png': [icon180, 'image/png', 'public, max-age=86400'],
  '/apple-touch-icon.png': [icon180, 'image/png', 'public, max-age=86400'],
  '/icon-192.png': [icon192, 'image/png', 'public, max-age=86400'],
  '/icon-512.png': [icon512, 'image/png', 'public, max-age=86400'],
  '/favicon.ico': [icon192, 'image/png', 'public, max-age=86400']
};

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const f = FILES[new URL(request.url).pathname];
    if (!f) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const headers = { 'content-type': f[1], 'cache-control': f[2], 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    return new Response(request.method === 'HEAD' ? null : f[0], { headers: headers });
  }
};
