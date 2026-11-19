// Break-it tests from the brief. Run against a running server:
//
//   npm run test:breakit                                   (http://localhost:3000)
//   BASE_URL=https://your-app.fly.dev npm run test:breakit (live)
//   node tests/break-it.js --only "last units"             (one test by name)
//
// Every run creates fresh accounts, so it never touches demo data.
// The "Foreign keys" test opens the SQLite file directly, so it runs where the database is
// (locally, or on the server with `fly ssh console -C "node tests/break-it.js --only foreign"`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api`;
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toLowerCase() : null;
const RUN = crypto.randomBytes(3).toString('hex');
let userCounter = 0;

// ---------- tiny HTTP client with a cookie jar ----------
class Client {
  constructor(label) { this.label = label; this.cookie = ''; }
  async req(method, path, body, { raw } = {}) {
    const headers = { cookie: this.cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: payload });
    } catch (e) {
      return { status: 0, body: { error: { code: 'NETWORK', message: String(e.cause?.code || e.message) } } };
    }
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith('shuka_sid=')) this.cookie = c.split(';')[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { text }; }
    return raw ? res : { status: res.status, body: json };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p); }
}

async function newUser(label) {
  const c = new Client(label);
  const n = ++userCounter;
  const r = await c.post('/auth/register', {
    email: `bt-${RUN}-${label}-${n}@example.com`.toLowerCase(),
    password: 'break-it-pass-1',
    name: `Test ${label}`,
    phone: '+374 91 000' + String(n).padStart(3, '0'),
  });
  if (r.status !== 201) throw new Error(`register ${label} failed: ${JSON.stringify(r.body)}`);
  c.id = r.body.user.id;
  return c;
}

async function newSeller(label) {
  const c = await newUser(label);
  const r = await c.post('/seller/activate', { store_name: `BT ${label} ${RUN} ${c.id}`, phone: '+374 91 555555' });
  if (r.status !== 200) throw new Error(`activate failed: ${JSON.stringify(r.body)}`);
  return c;
}

let categoryId;
async function newProduct(seller, { title = 'Break-it product', price = 1000, stock = 10 } = {}) {
  if (!categoryId) categoryId = (await seller.get('/categories')).body.categories[0].id;
  const r = await seller.post('/seller/products', {
    title: `${title} ${RUN}`, category_id: categoryId, description: 'Created by the break-it test script.', price_amd: price, stock,
  });
  if (r.status !== 201) throw new Error(`create product failed: ${JSON.stringify(r.body)}`);
  const id = r.body.product.id;
  const fd = new FormData();
  fd.append('images', new Blob([await testImage()], { type: 'image/png' }), 'photo.png');
  const up = await seller.req('POST', `/seller/products/${id}/images`, fd);
  if (up.status !== 201) throw new Error(`upload failed: ${JSON.stringify(up.body)}`);
  const pub = await seller.patch(`/seller/products/${id}`, { is_published: true });
  if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.body)}`);
  return id;
}

const testImage = () =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 80, b: 60 } } }).png().toBuffer();

const ADDRESS = { recipient: 'Test Buyer', phone: '+374 91 123456', region: 'Yerevan', city: 'Yerevan', street: 'Tumanyan St 1', apartment: '2' };
const key = () => crypto.randomUUID();
const checkout = (c, request_key = key()) => c.post('/orders', { ...ADDRESS, request_key });

async function buy(buyer, productId, qty = 1) {
  const a = await buyer.put(`/cart/items/${productId}`, { quantity: qty });
  if (a.status !== 200) throw new Error(`add to cart failed: ${JSON.stringify(a.body)}`);
  const o = await checkout(buyer);
  if (o.status !== 201) throw new Error(`checkout failed: ${JSON.stringify(o.body)}`);
  return o.body.order_id;
}
async function sellerOrderIdFor(buyer, orderId) {
  return (await buyer.get(`/orders/${orderId}`)).body.order.sellers[0].id;
}
const stockOf = async (productId) => (await new Client('guest').get(`/products/${productId}`)).body.product.stock;

// ---------- assertions ----------
function expect(cond, msg, details) {
  if (!cond) {
    const e = new Error(msg);
    e.details = details;
    throw e;
  }
  console.log(`    ✓ ${msg}`);
}

// ---------- the tests ----------
const tests = [];
const test = (name, how, fn) => tests.push({ name, how, fn });

test('Last units', 'stock 3, 30 buyers check out 1 unit each at the same time', async () => {
  const seller = await newSeller('lastunits');
  const pid = await newProduct(seller, { title: 'Last units', stock: 3 });
  const buyers = await Promise.all(Array.from({ length: 30 }, (_, i) => newUser(`lu${i}`)));
  for (const b of buyers) {
    const r = await b.put(`/cart/items/${pid}`, { quantity: 1 });
    if (r.status !== 200) throw new Error('add to cart failed ' + JSON.stringify(r.body));
  }
  const results = await Promise.all(buyers.map((b) => checkout(b)));
  const by = (s) => results.filter((r) => r.status === s).length;
  const locked = results.filter((r) => /locked|busy/i.test(JSON.stringify(r.body)));
  console.log(`    statuses: ${JSON.stringify(results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}))}`);
  expect(by(201) === 3, 'exactly 3 orders created', results.map((r) => r.status));
  expect(by(409) === 27, '27 answers of 409');
  expect(results.filter((r) => r.status === 409).every((r) => r.body.error.message.includes('Last units')), '409 messages name the product');
  expect(locked.length === 0 && results.every((r) => r.status < 500), 'no "database is locked" / 5xx errors');
  expect((await stockOf(pid)) === 0, 'stock is 0');
});

test('Double click', 'the same checkout sent twice with the same request key', async () => {
  const seller = await newSeller('double');
  const pid = await newProduct(seller, { stock: 5 });
  const buyer = await newUser('double');
  await buyer.put(`/cart/items/${pid}`, { quantity: 1 });
  const k = key();
  const [a, b] = await Promise.all([checkout(buyer, k), checkout(buyer, k)]);
  console.log(`    statuses: ${a.status}, ${b.status}`);
  expect(a.body.order_id && a.body.order_id === b.body.order_id, 'both answers point to the same order');
  const list = (await buyer.get('/orders')).body.orders;
  expect(list.length === 1, 'the buyer has exactly one order');
  expect((await stockOf(pid)) === 4, 'stock was reduced only once');
  const other = await newUser('double-other');
  await other.put(`/cart/items/${pid}`, { quantity: 1 });
  const stolen = await checkout(other, k);
  expect(stolen.status === 409 && !stolen.body.order_id, "another user reusing the key gets 409, not the first buyer's order");
});

test('Price changed', 'buyer adds an item, seller raises the price, buyer checks out', async () => {
  const seller = await newSeller('price');
  const pid = await newProduct(seller, { price: 5000 });
  const buyer = await newUser('price');
  await buyer.put(`/cart/items/${pid}`, { quantity: 1 });
  await seller.patch(`/seller/products/${pid}`, { price_amd: 6500 });
  const cart = (await buyer.get('/cart')).body;
  expect(cart.groups[0].items[0].warnings.some((w) => w.code === 'PRICE_CHANGED'), 'the cart shows a price-changed warning');
  const r = await checkout(buyer);
  console.log(`    ${r.status} ${r.body.error?.message}`);
  expect(r.status === 409 && r.body.error.code === 'PRICE_CHANGED', 'checkout stops with 409 PRICE_CHANGED');
  expect(r.body.error.changes?.[0]?.new_price === 6500, 'the answer shows the new price (6,500 ֏)');
  expect((await buyer.get('/orders')).body.orders.length === 0, 'no order was created');
  expect((await stockOf(pid)) === 10, 'stock untouched');
  const again = await checkout(buyer);
  expect(again.status === 201, 'after seeing the new price, placing the order again works');
  const o = (await buyer.get(`/orders/${again.body.order_id}`)).body.order;
  expect(o.total_amd === 6500, 'the order uses the new price');
});

test('Old order after edit', 'seller edits title and price of a product already ordered', async () => {
  const seller = await newSeller('oldorder');
  const pid = await newProduct(seller, { title: 'Original title', price: 3000 });
  const buyer = await newUser('oldorder');
  const orderId = await buy(buyer, pid, 2);
  const r = await seller.patch(`/seller/products/${pid}`, { title: 'Renamed product', price_amd: 9999 });
  expect(r.status === 200, 'seller edit succeeded');
  const item = (await buyer.get(`/orders/${orderId}`)).body.order.sellers[0].items[0];
  console.log(`    buyer sees: "${item.title}" at ${item.unit_price_amd} ֏`);
  expect(item.title.startsWith('Original title') && item.unit_price_amd === 3000, 'buyer order keeps the old title and price');
  const soId = await sellerOrderIdFor(buyer, orderId);
  const sItem = (await seller.get(`/seller/orders/${soId}`)).body.order.items[0];
  expect(sItem.title.startsWith('Original title') && sItem.unit_price_amd === 3000, 'seller order keeps the old title and price');
});

test("Someone else's order", 'seller A opens seller B order; buyer A opens buyer B order', async () => {
  const sellerA = await newSeller('sA');
  const sellerB = await newSeller('sB');
  const pid = await newProduct(sellerB);
  const buyerA = await newUser('bA');
  const buyerB = await newUser('bB');
  const orderB = await buy(buyerB, pid);
  const soB = await sellerOrderIdFor(buyerB, orderB);

  const r1 = await sellerA.get(`/seller/orders/${soB}`);
  expect([403, 404].includes(r1.status) && !r1.body.order, `seller A → seller B's order: ${r1.status}, no data`);
  const r2 = await sellerA.post(`/seller/orders/${soB}/status`, { to: 'confirmed' });
  expect([403, 404].includes(r2.status), `seller A cannot change seller B's order: ${r2.status}`);
  const r3 = await buyerA.get(`/orders/${orderB}`);
  expect([403, 404].includes(r3.status) && !r3.body.order, `buyer A → buyer B's order: ${r3.status}, no data`);
  const r4 = await buyerA.post(`/orders/${orderB}/sellers/${soB}/cancel`);
  expect([403, 404].includes(r4.status), `buyer A cannot cancel buyer B's order: ${r4.status}`);
  const r5 = await buyerA.get(`/seller/orders/${soB}`);
  expect(r5.status === 403, `a non-seller calling the seller API gets 403`);
  const r6 = await new Client('guest').get(`/orders/${orderB}`);
  expect(r6.status === 401, `a guest gets 401`);
  const r7 = await sellerA.patch(`/seller/products/${pid}`, { price_amd: 1 });
  expect(r7.status === 404, `seller A cannot edit seller B's product: ${r7.status}`);
  const r8 = await sellerB.put(`/cart/items/${pid}`, { quantity: 1 });
  expect(r8.status === 403, `seller B cannot buy their own product: ${r8.status}`);
  const still = (await buyerB.get(`/orders/${orderB}`)).body.order.sellers[0].status;
  expect(still === 'placed', 'order B is unchanged');
});

test('Move not allowed', 'seller moves Placed → Delivered; buyer cancels a shipped order', async () => {
  const seller = await newSeller('moves');
  const pid = await newProduct(seller, { stock: 5 });
  const buyer = await newUser('moves');
  const orderId = await buy(buyer, pid);
  const soId = await sellerOrderIdFor(buyer, orderId);

  const jump = await seller.post(`/seller/orders/${soId}/status`, { to: 'delivered' });
  expect(jump.status === 409, `placed → delivered: ${jump.status}`);
  let detail = (await seller.get(`/seller/orders/${soId}`)).body.order;
  expect(detail.status === 'placed' && detail.history.length === 1, 'nothing changed, no history row written');

  for (const to of ['confirmed', 'shipped']) {
    const r = await seller.post(`/seller/orders/${soId}/status`, { to });
    expect(r.status === 200, `seller moves to ${to}`);
  }
  const cancel = await buyer.post(`/orders/${orderId}/sellers/${soId}/cancel`);
  expect(cancel.status === 409, `buyer cancels a shipped order: ${cancel.status}`);
  const sellerCancel = await seller.post(`/seller/orders/${soId}/status`, { to: 'cancelled' });
  expect(sellerCancel.status === 409, `seller cancels a shipped order: ${sellerCancel.status}`);
  const back = await seller.post(`/seller/orders/${soId}/status`, { to: 'placed' });
  expect(back.status === 409, `shipped → placed: ${back.status}`);
  detail = (await seller.get(`/seller/orders/${soId}`)).body.order;
  expect(detail.status === 'shipped' && detail.history.length === 3, 'still shipped, exactly 3 history rows');
  expect((await stockOf(pid)) === 4, 'stock unchanged');
});

test('Cancel returns stock', 'buyer cancels a placed order', async () => {
  const seller = await newSeller('cancel');
  const pid = await newProduct(seller, { stock: 10 });
  const buyer = await newUser('cancel');
  const orderId = await buy(buyer, pid, 3);
  expect((await stockOf(pid)) === 7, 'stock 10 → 7 after ordering 3');
  const soId = await sellerOrderIdFor(buyer, orderId);
  const r = await buyer.post(`/orders/${orderId}/sellers/${soId}/cancel`);
  expect(r.status === 200, 'buyer cancel accepted');
  expect((await stockOf(pid)) === 10, 'stock goes back up to 10');
  const o = (await buyer.get(`/orders/${orderId}`)).body.order.sellers[0];
  expect(o.status === 'cancelled' && o.history.at(-1).to_status === 'cancelled', 'status cancelled, history row added');
  const again = await buyer.post(`/orders/${orderId}/sellers/${soId}/cancel`);
  expect(again.status === 409 && (await stockOf(pid)) === 10, 'cancelling twice → 409 and stock is not returned twice');
});

test('Foreign keys', 'insert an order item for a product ID that does not exist (directly in SQLite)', async () => {
  const { openDb } = await import('../server/db.js');
  const { config } = await import('../server/config.js');
  if (!fs.existsSync(config.dbFile)) {
    console.log(`    (skipped: no database at ${config.dbFile} — run this on the server)`);
    return;
  }
  const db = openDb();
  expect(db.pragma('foreign_keys', { simple: true }) === 1, 'PRAGMA foreign_keys is ON for the connection');
  expect(db.pragma('journal_mode', { simple: true }) === 'wal', 'journal_mode is WAL');
  const so = db.prepare('SELECT id FROM seller_orders LIMIT 1').get();
  let error;
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO order_items (seller_order_id, product_id, title, unit_price_amd, quantity) VALUES (?, ?, ?, ?, ?)')
        .run(so?.id ?? 1, 987654321, 'Ghost product', 100, 1);
    })();
  } catch (e) {
    error = e;
  }
  console.log(`    SQLite said: ${error?.code} — ${error?.message}`);
  expect(error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY', 'rejected by SQLite (FOREIGN KEY constraint failed)');
  let typeErr;
  try { db.prepare('UPDATE products SET price_amd = ? WHERE id = (SELECT MIN(id) FROM products)').run('cheap'); } catch (e) { typeErr = e; }
  expect(typeErr?.code === 'SQLITE_CONSTRAINT_DATATYPE', 'STRICT table rejects text in an INTEGER money column');
  let delErr;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM products WHERE id IN (SELECT product_id FROM order_items LIMIT 1)').run();
      throw new Error('delete was NOT rejected (rolled back)');
    })();
  } catch (e) { delErr = e; }
  // SQLite reports ON DELETE RESTRICT as SQLITE_CONSTRAINT_TRIGGER with "FOREIGN KEY constraint failed".
  expect(/FOREIGN KEY constraint failed/.test(delErr?.message), 'a product that was ordered cannot be deleted (ON DELETE RESTRICT)');
  db.close();
});

test('Bad upload', 'upload a 30 MB file and a renamed .exe', async () => {
  const seller = await newSeller('upload');
  if (!categoryId) categoryId = (await seller.get('/categories')).body.categories[0].id;
  const pid = (await seller.post('/seller/products', { title: 'Upload test ' + RUN, category_id: categoryId, description: 'Testing bad uploads.', price_amd: 100, stock: 1 })).body.product.id;

  const big = new FormData();
  big.append('images', new Blob([crypto.randomBytes(30 * 1024 * 1024)], { type: 'image/jpeg' }), 'huge-photo.jpg');
  const r1 = await seller.req('POST', `/seller/products/${pid}/images`, big);
  console.log(`    30 MB → ${r1.status} ${r1.body.error?.message}`);
  expect(r1.status === 400 && /too large/i.test(r1.body.error?.message), '30 MB file rejected with a clear message');

  const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), crypto.randomBytes(4096)]);
  const fake = new FormData();
  fake.append('images', new Blob([exe], { type: 'image/jpeg' }), 'holiday.jpg');
  const r2 = await seller.req('POST', `/seller/products/${pid}/images`, fake);
  console.log(`    renamed .exe → ${r2.status} ${r2.body.error?.message}`);
  expect(r2.status === 400 && /not an image|not a supported/i.test(r2.body.error?.message), 'renamed .exe rejected with a clear message');

  const p = (await seller.get(`/seller/products/${pid}`)).body.product;
  expect(p.images.length === 0, 'nothing was stored');
  const pub = await seller.patch(`/seller/products/${pid}`, { is_published: true });
  expect(pub.status === 400, 'a product without photos cannot be published');
});

// ---------- runner ----------
const selected = tests.filter((t) => !ONLY || t.name.toLowerCase().includes(ONLY));
console.log(`Break-it tests against ${BASE} (run ${RUN})\n`);
const health = await fetch(`${BASE}/healthz`).catch(() => null);
if (!health?.ok) {
  console.error(`Server not reachable at ${BASE}. Start it first (npm run dev or npm start).`);
  process.exit(1);
}
let failed = 0;
for (const t of selected) {
  console.log(`▶ ${t.name} — ${t.how}`);
  const t0 = Date.now();
  try {
    await t.fn();
    console.log(`  PASS (${Date.now() - t0} ms)\n`);
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${e.message}${e.details ? ' ' + JSON.stringify(e.details) : ''}\n`);
  }
}
console.log(`${selected.length - failed}/${selected.length} break-it tests passed`);
process.exit(failed ? 1 : 0);
