// Cloudflare Worker that serves the game: the whole app is one HTML file (docs/index.html),
// uploaded next to this script as a text module by deploy/cloudflare.sh.
import html from './index.html';

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    if (path === '/' || path === '/index.html') {
      return new Response(request.method === 'HEAD' ? null : html, { headers: HEADERS });
    }
    if (path === '/favicon.ico') return new Response(null, { status: 204 });
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
