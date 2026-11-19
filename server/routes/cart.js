import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { imageUrls } from '../lib/images.js';
import { validate, required, int, parseId } from '../lib/validate.js';

const r = Router();
r.use('/cart', requireAuth);

/** The cart grouped by seller, with a warning on every line that cannot be bought as-is. */
export function loadCart(userId) {
  const rows = getDb()
    .prepare(
      `SELECT ci.product_id, ci.quantity, ci.price_when_added,
              p.title, p.price_amd, p.stock, p.is_published, p.seller_id, u.store_name,
              (SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS main_image
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN users u ON u.id = p.seller_id
        WHERE ci.user_id = ?
        ORDER BY u.store_name, p.title`
    )
    .all(userId);

  const groups = new Map();
  let total = 0;
  let count = 0;
  let problems = 0;
  for (const row of rows) {
    const warnings = [];
    if (!row.is_published) warnings.push({ code: 'UNAVAILABLE', message: 'This product is no longer sold.' });
    else if (row.stock === 0) warnings.push({ code: 'SOLD_OUT', message: 'Sold out since you added it.' });
    else if (row.quantity > row.stock) warnings.push({ code: 'LOW_STOCK', message: `Only ${row.stock} left — lower the quantity.` });
    if (row.price_amd !== row.price_when_added) {
      warnings.push({
        code: 'PRICE_CHANGED',
        message: `Price changed from ${row.price_when_added.toLocaleString('en-US')} ֏ to ${row.price_amd.toLocaleString('en-US')} ֏.`,
        old_price: row.price_when_added,
        new_price: row.price_amd,
      });
    }
    if (row.seller_id === userId) warnings.push({ code: 'OWN_PRODUCT', message: 'You cannot buy your own product.' });
    const blocking = warnings.some((w) => w.code !== 'PRICE_CHANGED');
    if (blocking) problems++;

    const buyable = row.is_published && row.stock > 0;
    const lineTotal = buyable ? row.price_amd * row.quantity : 0; // sold-out / removed lines don't count
    if (!groups.has(row.seller_id)) {
      groups.set(row.seller_id, { seller_id: row.seller_id, store_name: row.store_name, items: [], subtotal_amd: 0 });
    }
    const g = groups.get(row.seller_id);
    g.items.push({
      product_id: row.product_id,
      title: row.title,
      image: imageUrls(row.main_image),
      quantity: row.quantity,
      price_amd: row.price_amd,
      price_when_added: row.price_when_added,
      stock: row.stock,
      line_total_amd: lineTotal,
      warnings,
    });
    g.subtotal_amd += lineTotal;
    total += lineTotal;
    count += row.quantity;
    g.items.at(-1).buyable = !!buyable;
  }
  return { groups: [...groups.values()], total_amd: total, item_count: count, blocking_problems: problems };
}

r.get('/cart', (req, res) => {
  res.json(loadCart(req.user.id));
});

// Set the quantity of one product (adds it when missing).
r.put('/cart/items/:productId', (req, res) => {
  const productId = parseId(req.params.productId);
  const { quantity } = validate(req.body, { quantity: [required('Quantity'), int('Quantity', 1, 999)] });
  const qty = Number(quantity);
  const db = getDb();
  const p = productId && db.prepare('SELECT id, seller_id, title, price_amd, stock, is_published FROM products WHERE id = ?').get(productId);
  if (!p || !p.is_published) throw notFound('Product not found.');
  if (p.seller_id === req.user.id) throw forbidden('You cannot buy your own product.');
  if (qty > p.stock) {
    throw conflict(
      'NOT_ENOUGH_STOCK',
      p.stock === 0 ? `"${p.title}" is out of stock.` : `Only ${p.stock} of "${p.title}" left in stock.`,
      { stock: p.stock }
    );
  }
  // price_when_added is set on first add and kept on quantity changes,
  // so a price change since then is still detected at checkout.
  db.prepare(
    `INSERT INTO cart_items (user_id, product_id, quantity, price_when_added) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = excluded.quantity`
  ).run(req.user.id, p.id, qty, p.price_amd);
  res.json(loadCart(req.user.id));
});

r.delete('/cart/items/:productId', (req, res) => {
  const productId = parseId(req.params.productId);
  getDb().prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
  res.json(loadCart(req.user.id));
});

export default r;
