import { getDb, now } from '../db.js';
import { conflict, notFound } from './errors.js';

/**
 * The ONLY place that decides which status moves are allowed.
 * Sellers move orders forward (and may cancel before shipping); buyers may only cancel before shipping.
 */
export const ALLOWED_MOVES = {
  seller: {
    placed: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  },
  buyer: {
    placed: ['cancelled'],
    confirmed: ['cancelled'],
    shipped: [],
    delivered: [],
    cancelled: [],
  },
};

export const allowedMoves = (role, status) => ALLOWED_MOVES[role]?.[status] ?? [];

/**
 * Moves one seller order to `to`. `scope` is the SQL that proves the caller owns it.
 * Runs in one BEGIN IMMEDIATE transaction: check move, update status, restore stock on
 * cancel, write a status_history row. A disallowed move returns 409 and writes nothing.
 */
export function changeStatus({ sellerOrderId, to, role, actorId, scopeSql, scopeParams }) {
  const db = getDb();
  return db
    .transaction(() => {
      const so = db
        .prepare(`SELECT so.id, so.status FROM seller_orders so JOIN orders o ON o.id = so.order_id WHERE so.id = ? AND ${scopeSql}`)
        .get(sellerOrderId, ...scopeParams);
      if (!so) throw notFound('Order not found.');

      if (!allowedMoves(role, so.status).includes(to)) {
        throw conflict('STATUS_NOT_ALLOWED', `Cannot move an order from "${so.status}" to "${to}".`, {
          from: so.status,
          allowed: allowedMoves(role, so.status),
        });
      }

      const ts = now();
      const upd = db
        .prepare('UPDATE seller_orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(to, ts, so.id, so.status);
      if (upd.changes !== 1) throw conflict('STATUS_CHANGED', 'The order status changed meanwhile, reload and try again.');

      if (to === 'cancelled') {
        // Give the stock back in the same transaction as the status change.
        db.prepare(
          `UPDATE products
              SET stock = stock + (SELECT SUM(oi.quantity) FROM order_items oi
                                    WHERE oi.seller_order_id = ? AND oi.product_id = products.id),
                  updated_at = ?
            WHERE id IN (SELECT product_id FROM order_items WHERE seller_order_id = ?)`
        ).run(so.id, ts, so.id);
      }

      db.prepare(
        'INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(so.id, so.status, to, actorId, ts);

      return { id: so.id, from: so.status, status: to };
    })
    .immediate();
}

export function historyFor(sellerOrderIds) {
  if (!sellerOrderIds.length) return {};
  const rows = getDb()
    .prepare(
      `SELECT h.seller_order_id, h.from_status, h.to_status, h.created_at, u.name AS changed_by_name,
              CASE WHEN so.seller_id = h.changed_by THEN 'seller' ELSE 'buyer' END AS changed_by_role
         FROM status_history h
         JOIN seller_orders so ON so.id = h.seller_order_id
         JOIN users u ON u.id = h.changed_by
        WHERE h.seller_order_id IN (${sellerOrderIds.map(() => '?').join(',')})
        ORDER BY h.id`
    )
    .all(...sellerOrderIds);
  const map = {};
  for (const r of rows) (map[r.seller_order_id] ||= []).push(r);
  return map;
}
