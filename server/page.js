// Serves the React app's HTML with the first screen's data already inside it:
//  - the CSS is inlined (no render-blocking stylesheet request),
//  - categories, the signed-in user and the current page's products are embedded as JSON,
//    so the page renders at once without layout shifts,
//  - the main product photo is preloaded.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { categoriesData, productsData, productData, reviewsData } from './routes/catalog.js';
import { meData } from './routes/auth.js';
import { parseId } from './lib/validate.js';

const indexFile = () => path.join(config.clientDist, 'index.html');
let cache = { mtime: 0, html: '' };

function template() {
  const mtime = fs.statSync(indexFile()).mtimeMs;
  if (cache.mtime === mtime) return cache.html;
  let html = fs.readFileSync(indexFile(), 'utf8');
  html = html.replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/g, (_m, href) =>
    `<style>${fs.readFileSync(path.join(config.clientDist, href), 'utf8')}</style>`
  );
  cache = { mtime, html };
  return html;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
// JSON that is safe inside <script>: no '</script>' break-out, no raw line separators.
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

export function renderPage(req, res) {
  const url = new URL(req.originalUrl, 'http://local');
  const api = { '/categories': categoriesData() };
  const preload = [];
  let title = 'Shuka — Armenian marketplace';
  let description = 'Shuka is a marketplace for Armenia: buy from local sellers in one cart, pay cash on delivery in Yerevan and all 10 marzer.';
  let status = 200;

  if (url.pathname === '/') {
    api['/products?sort=newest&pageSize=18'] = productsData({ sort: 'newest', pageSize: '18' });
    api['/products?sort=rating&pageSize=6'] = productsData({ sort: 'rating', pageSize: '6' });
  } else if (url.pathname === '/search') {
    const data = productsData(Object.fromEntries(url.searchParams));
    api[`/products?${url.searchParams.toString()}`] = data;
    data.items.slice(0, 2).forEach((p) => p.image && preload.push(p.image.thumb));
    if (data.category) title = `${data.category.name} · Shuka`;
  } else {
    const m = /^\/p\/(\d+)$/.exec(url.pathname);
    if (m) {
      const data = productData(parseId(m[1]), req.user);
      if (data) {
        api[`/products/${m[1]}`] = data;
        api[`/products/${m[1]}/reviews`] = reviewsData(data.product.id);
        if (data.product.images[0]) preload.push(data.product.images[0].large);
        title = `${data.product.title} · Shuka`;
        description = data.product.description.slice(0, 155);
      } else {
        status = 404;
      }
    }
  }

  const boot = { me: req.user ? meData(req.user) : null, api };
  const head =
    preload.map((href) => `<link rel="preload" as="image" href="${esc(href)}" fetchpriority="high">`).join('') +
    `<script>window.__BOOT__=${json(boot)}</script>`;

  const html = template()
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`)
    .replace('</head>', `${head}</head>`);

  // Personal data may be embedded, so the HTML is never cached by shared caches.
  res.status(status).set('Cache-Control', 'private, no-store').type('html').send(html);
}
