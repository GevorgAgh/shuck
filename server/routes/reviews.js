import { Router } from 'express';
import { getDb, now } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { validate, required, int, str, parseId } from '../lib/validate.js';

const r = Router();

r.post('/products/:id/reviews', requireAuth, (req, res) => {
  const productId = parseId(req.params.id);
  const v = validate(req.body, {
    rating: [required('Rating'), int('Rating', 1, 5)],
    body: [required('Review text'), str('Review text', 3, 2000)],
  });
  const db = getDb();
  if (!productId || !db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw notFound('Product not found.');

  const review = db
    .transaction(() => {
      const delivered = db
        .prepare(
          `SELECT 1 FROM order_items oi
             JOIN seller_orders so ON so.id = oi.seller_order_id
             JOIN orders o ON o.id = so.order_id
            WHERE oi.product_id = ? AND o.buyer_id = ? AND so.status = 'delivered' LIMIT 1`
        )
        .get(productId, req.user.id);
      if (!delivered) throw forbidden('You can review a product only after it has been delivered to you.');
      if (db.prepare('SELECT 1 FROM reviews WHERE product_id = ? AND buyer_id = ?').get(productId, req.user.id)) {
        throw conflict('ALREADY_REVIEWED', 'You have already reviewed this product.');
      }
      const id = db
        .prepare('INSERT INTO reviews (product_id, buyer_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(productId, req.user.id, Number(v.rating), v.body, now()).lastInsertRowid;
      db.prepare(
        `UPDATE products
            SET rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ?),
                rating_avg   = (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE product_id = ?)
          WHERE id = ?`
      ).run(productId, productId, productId);
      return db.prepare('SELECT id, rating, body, created_at FROM reviews WHERE id = ?').get(id);
    })
    .immediate();
  const p = db.prepare('SELECT rating_avg, rating_count FROM products WHERE id = ?').get(productId);
  res.status(201).json({ review, product: p });
});

export default r;
