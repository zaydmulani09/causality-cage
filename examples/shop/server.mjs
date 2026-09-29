// @ts-check
// Teashop server: static build + mock API. Env: PORT, BUG (none|B0..B8|demo), SCENARIO (bad|good).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 5173);
const BUG = process.env.BUG ?? 'none';
const SCENARIO = process.env.SCENARIO ?? 'bad';
const DIST = fileURLToPath(new URL('./dist/', import.meta.url));
const bad = SCENARIO === 'bad';
const is = (/** @type {string[]} */ ...bugs) => bugs.includes(BUG);

// B5/B8: many irrelevant fields that differ between scenarios. Elsewhere they are constant.
const vary = is('B5', 'B8');
const noise = (/** @type {string} */ field) => (vary ? `${SCENARIO}-${field}` : `${field}-0`);
const num = (/** @type {number} */ n) => (vary && bad ? n + 7 : n);
const META_FIELDS = ['trace_id', 'generated_at', 'etag', 'shard', 'build', 'node', 'cache_key', 'request_id',
  'session_hint', 'ab_bucket', 'region_hint', 'cdn_pop', 'deploy_id', 'schema_rev'];

function cart() {
  /** @type {Record<string, unknown>} */
  const meta = Object.fromEntries(META_FIELDS.map((f) => [f, noise(f)]));
  meta.render_ms = num(12);
  meta.db_ms = num(3);
  const body = {
    id: 'cart-1001',
    customer: { id: 'cus-42', name: 'Ada Lovelace', tax_id: is('B1', 'B7', 'B0', 'demo') && bad ? null : 'GB123456789' },
    items: [
      { sku: 'TEA-01', name: 'Earl Grey tea', qty: 2, price_ref: 'p1' },
      { sku: 'MUG-02', name: 'Enamel mug', qty: 1, price_ref: 'p2' },
    ],
    currency: is('B5') && bad ? 'JPY' : 'USD',
    discount: is('B2') ? { code: bad ? 'SPRING10' : null, pct: 10 } : null,
    meta,
  };
  // Key order differs between scenarios in B5; JSON semantics ignore it.
  return vary && bad ? Object.fromEntries(Object.entries(body).reverse()) : body;
}

function products() {
  const names = ['Earl Grey tea', 'Enamel mug', 'Sencha', 'Rooibos', 'Oolong', 'Tea strainer', 'Kettle', 'Honey'];
  return {
    products: names.map((name, i) => {
      const p = { sku: `SKU-${i}`, name, updated_at: noise(`updated_${i}`), stock_hint: num(i * 3) };
      return vary && bad ? { stock_hint: p.stock_hint, updated_at: p.updated_at, name, sku: p.sku } : p;
    }),
  };
}

function prices() {
  const meta = Object.fromEntries(['trace_id', 'generated_at', 'source', 'version', 'fx_date', 'feed', 'checksum'].map((f) => [f, noise(f)]));
  return { p1: 12.5, p2: 17, meta: { ...meta, ttl: num(60) } };
}

/** @type {Record<string, () => { body: unknown; delay?: number; headers?: Record<string, string> }>} */
const api = {
  'GET /api/products': () => ({ body: products() }),
  'GET /api/cart': () => ({ body: cart(), headers: { 'x-region': is('B6') && bad ? 'eu' : 'us' } }),
  'GET /api/prices': () => ({ body: prices(), delay: is('B3') && bad ? 1200 : is('demo') && bad ? 1500 : 0 }),
  'GET /api/inventory': () => ({ body: { 'TEA-01': 40, 'MUG-02': 12 } }),
  'GET /api/profile': () => ({ body: { name: 'Ada Lovelace' }, delay: is('B4') && !bad ? 100 : 0 }),
  'GET /api/profile-cache': () => ({ body: { name: 'Ada (cached)' }, delay: is('B4') && bad ? 100 : 0 }),
  'POST /api/order': () => ({ body: { orderId: 'ord-7' } }),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const route = api[`${req.method} ${path}`];
  if (route) {
    for await (const _ of req); // drain body
    const { body, delay = 0, headers = {} } = route();
    if (delay) await new Promise((r) => setTimeout(r, delay));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
    return;
  }
  if (path === '/runtime-config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(`window.__BUG__=${JSON.stringify(BUG)};window.__SERVER__={inventoryLock:${is('B8') && bad}};`);
    return;
  }
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(normalize(DIST))) return void res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[/** @type {keyof TYPES} */ (extname(file))] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`shop on http://127.0.0.1:${PORT} BUG=${BUG} SCENARIO=${SCENARIO}`));
