import { Router } from 'express';
import { getDb, now } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { imageUrls } from '../lib/images.js';
import { changeStatus, historyFor, allowedMoves } from '../lib/orderStatus.js';
import { validate, required, optional, str, phone, oneOf, REGIONS, parseId } from '../lib/validate.js';

const r = Router();
r.use('/orders', requireAuth);

class PriceChanged extends Error {
  constructor(changes) { super('price changed'); this.changes = changes; }
}

function existingOrderForKey(db, key, buyerId) {
  const o = db.prepare('SELECT id, buyer_id FROM orders WHERE request_key = ?').get(key);
  if (!o) return null;
  // A key that belongs to someone else never reveals their order.
  if (o.buyer_id !== buyerId) throw conflict('REQUEST_KEY_USED', 'This request key was already used.');
  return o.id;
}

/**
 * Checkout. One BEGIN IMMEDIATE transaction, written in plain SQL:
 *  - the cart is read inside the transaction,
 *  - a changed price stops the checkout (409 PRICE_CHANGED),
 *  - stock is decremented with a conditional UPDATE and the changed-row count is checked,
 *  - any failure rolls back the whole order.
 * A repeated request_key returns the existing order instead of creating a second one.
 */
r.post('/orders', (req, res) => {
  const v = validate(req.body, {
    request_key: [required('Request key'), str('Request key', 8, 100)],
    recipient: [required('Recipient name'), str('Recipient name', 2, 100)],
    phone: [required('Phone'), phone()],
    region: [required('Region'), oneOf('Region', REGIONS)],
    city: [required('City or village'), str('City or village', 2, 100)],
    street: [required('Street and building'), str('Street and building', 2, 200)],
    apartment: [optional(str('Apartment', 1, 50))],
    note: [optional(str('Note', 0, 500))],
  });
  const db = getDb();
  const userId = req.user.id;

  const repeat = existingOrderForKey(db, v.request_key, userId);
  if (repeat) return res.status(200).json({ order_id: repeat, repeated: true });

  const checkout = db.transaction(() => {
    const lines = db
      .prepare(
        `SELECT ci.product_id, ci.quantity, ci.price_when_added,
                p.title, p.price_amd, p.stock, p.is_published, p.seller_id
           FROM cart_items ci JOIN products p ON p.id = ci.product_id
          WHERE ci.user_id = ?
          ORDER BY p.seller_id, p.id`
      )
      .all(userId);
    if (!lines.length) throw badRequest('Your cart is empty.');

    for (const l of lines) {
      if (!l.is_published) throw conflict('UNAVAILABLE', `"${l.title}" is no longer sold. Remove it from your cart.`, { product_id: l.product_id });
      if (l.seller_id === userId) throw conflict('OWN_PRODUCT', `You cannot buy your own product "${l.title}".`, { product_id: l.product_id });
    }
    const changes = lines
      .filter((l) => l.price_amd !== l.price_when_added)
      .map((l) => ({ product_id: l.product_id, title: l.title, old_price: l.price_when_added, new_price: l.price_amd }));
    if (changes.length) throw new PriceChanged(changes);

    const ts = now();
    const total = lines.reduce((s, l) => s + l.price_amd * l.quantity, 0);
    const orderId = db
      .prepare(
        `INSERT INTO orders (buyer_id, recipient, phone, region, city, street, apartment, note, total_amd, request_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, v.recipient, v.phone, v.region, v.city, v.street, v.apartment || '', v.note || '', total, v.request_key, ts)
      .lastInsertRowid;

    const decStock = db.prepare(
      'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ? AND is_published = 1'
    );
    const insSellerOrder = db.prepare(
      `INSERT INTO seller_orders (order_id, seller_id, status, subtotal_amd, updated_at) VALUES (?, ?, 'placed', ?, ?)`
    );
    const insItem = db.prepare(
      'INSERT INTO order_items (seller_order_id, product_id, title, unit_price_amd, quantity) VALUES (?, ?, ?, ?, ?)'
    );
    const insHistory = db.prepare(
      `INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, NULL, 'placed', ?, ?)`
    );

    // Split the one buyer order into one seller order per seller.
    const bySeller = new Map();
    for (const l of lines) (bySeller.get(l.seller_id) || bySeller.set(l.seller_id, []).get(l.seller_id)).push(l);

    for (const [sellerId, items] of bySeller) {
      const subtotal = items.reduce((s, l) => s + l.price_amd * l.quantity, 0);
      const soId = insSellerOrder.run(orderId, sellerId, subtotal, ts).lastInsertRowid;
      for (const l of items) {
        const result = decStock.run(l.quantity, ts, l.product_id, l.quantity);
        if (result.changes !== 1) {
          throw conflict('OUT_OF_STOCK', `Not enough stock for "${l.title}". Someone just bought the last units.`, { product_id: l.product_id });
        }
        insItem.run(soId, l.product_id, l.title, l.price_amd, l.quantity);
      }
      insHistory.run(soId, userId, ts);
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
    return orderId;
  });

  try {
    const orderId = checkout.immediate();
    res.status(201).json({ order_id: orderId });
  } catch (e) {
    if (e instanceof PriceChanged) {
      // After the rollback, accept the new prices in the cart so the buyer sees them and can confirm.
      const upd = db.prepare('UPDATE cart_items SET price_when_added = ? WHERE user_id = ? AND product_id = ?');
      db.transaction(() => e.changes.forEach((c) => upd.run(c.new_price, userId, c.product_id))).immediate();
      const list = e.changes.map((c) => `"${c.title}" now costs ${c.new_price.toLocaleString('en-US')} ֏ (was ${c.old_price.toLocaleString('en-US')} ֏)`).join('; ');
      throw conflict('PRICE_CHANGED', `Prices changed since you added these items: ${list}. Check the new total and place the order again.`, { changes: e.changes });
    }
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' && /request_key/.test(e.message)) {
      const id = existingOrderForKey(db, v.request_key, userId);
      return res.status(200).json({ order_id: id, repeated: true });
    }
    if (e instanceof HttpError) throw e;
    throw e;
  }
});

r.get('/orders', (req, res) => {
  const db = getDb();
  const orders = db
    .prepare('SELECT id, total_amd, created_at FROM orders WHERE buyer_id = ? ORDER BY id DESC LIMIT 200')
    .all(req.user.id);
  const parts = orders.length
    ? db
        .prepare(
          `SELECT so.id, so.order_id, so.status, so.subtotal_amd, u.store_name,
                  (SELECT COUNT(*) FROM order_items WHERE seller_order_id = so.id) AS item_count
             FROM seller_orders so JOIN users u ON u.id = so.seller_id
            WHERE so.order_id IN (${orders.map(() => '?').join(',')})
            ORDER BY so.id`
        )
        .all(...orders.map((o) => o.id))
    : [];
  res.json({
    orders: orders.map((o) => ({ ...o, sellers: parts.filter((p) => p.order_id === o.id) })),
  });
});

r.get('/orders/:id', (req, res) => {
  const id = parseId(req.params.id);
  const db = getDb();
  // Scoped to the current user: another buyer's order is simply "not found".
  const order = id && db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(id, req.user.id);
  if (!order) throw notFound('Order not found.');

  const parts = db
    .prepare(
      `SELECT so.id, so.seller_id, so.status, so.subtotal_amd, so.updated_at, u.store_name, u.phone AS seller_phone
         FROM seller_orders so JOIN users u ON u.id = so.seller_id
        WHERE so.order_id = ? ORDER BY so.id`
    )
    .all(order.id);
  const items = db
    .prepare(
      `SELECT oi.id, oi.seller_order_id, oi.product_id, oi.title, oi.unit_price_amd, oi.quantity,
              (SELECT file_path FROM product_images WHERE product_id = oi.product_id ORDER BY position LIMIT 1) AS main_image,
              EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = oi.product_id AND r.buyer_id = ?) AS reviewed
         FROM order_items oi JOIN seller_orders so ON so.id = oi.seller_order_id
        WHERE so.order_id = ? ORDER BY oi.id`
    )
    .all(req.user.id, order.id);
  const history = historyFor(parts.map((p) => p.id));

  const { buyer_id, request_key, ...address } = order;
  res.json({
    order: {
      ...address,
      sellers: parts.map((p) => ({
        ...p,
        can_cancel: allowedMoves('buyer', p.status).includes('cancelled'),
        history: history[p.id] || [],
        items: items
          .filter((i) => i.seller_order_id === p.id)
          .map(({ main_image, reviewed, ...i }) => ({
            ...i,
            image: imageUrls(main_image),
            reviewed: !!reviewed,
            can_review: p.status === 'delivered' && !reviewed,
          })),
      })),
    },
  });
});

r.post('/orders/:id/sellers/:sellerOrderId/cancel', (req, res) => {
  const orderId = parseId(req.params.id);
  const soId = parseId(req.params.sellerOrderId);
  if (!orderId || !soId) throw notFound('Order not found.');
  const result = changeStatus({
    sellerOrderId: soId,
    to: 'cancelled',
    role: 'buyer',
    actorId: req.user.id,
    scopeSql: 'so.order_id = ? AND o.buyer_id = ?',
    scopeParams: [orderId, req.user.id],
  });
  res.json(result);
});

export default r;
