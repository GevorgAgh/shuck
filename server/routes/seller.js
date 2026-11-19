import { Router } from 'express';
import multer from 'multer';
import { getDb, now } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireSeller, publicUser } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { imageUrls, processImage, deleteImageFiles } from '../lib/images.js';
import { changeStatus, historyFor, allowedMoves } from '../lib/orderStatus.js';
import { validate, required, optional, str, int, phone, parseId } from '../lib/validate.js';

const r = Router();
const STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// ---------- Become a seller ----------
r.post('/seller/activate', requireAuth, (req, res) => {
  if (req.user.store_name) throw conflict('ALREADY_SELLER', 'You are already a seller.');
  const v = validate(req.body, {
    store_name: [required('Store name'), str('Store name', 2, 60)],
    phone: [required('Phone'), phone()],
  });
  const db = getDb();
  try {
    db.prepare('UPDATE users SET store_name = ?, phone = ? WHERE id = ? AND store_name IS NULL').run(v.store_name, v.phone, req.user.id);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw conflict('STORE_NAME_TAKEN', 'This store name is taken.', { fields: { store_name: 'This store name is already taken.' } });
    }
    throw e;
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

r.use('/seller', requireSeller);

// ---------- Overview (plain SQL) ----------
r.get('/seller/overview', (req, res) => {
  const db = getDb();
  const sellerId = req.user.id;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM seller_orders WHERE seller_id = ? GROUP BY status')
    .all(sellerId)) counts[row.status] = row.n;

  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const revenue30 = db
    .prepare(
      `SELECT COALESCE(SUM(so.subtotal_amd), 0) AS amd, COUNT(*) AS orders
         FROM seller_orders so
        WHERE so.seller_id = ? AND so.status = 'delivered'
          AND EXISTS (SELECT 1 FROM status_history h
                       WHERE h.seller_order_id = so.id AND h.to_status = 'delivered' AND h.created_at >= ?)`
    )
    .get(sellerId, since);
  const revenueAll = db
    .prepare(`SELECT COALESCE(SUM(subtotal_amd), 0) AS amd FROM seller_orders WHERE seller_id = ? AND status = 'delivered'`)
    .get(sellerId);
  const products = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_published), 0) AS published,
              COALESCE(SUM(CASE WHEN is_published = 1 AND stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock
         FROM products WHERE seller_id = ?`
    )
    .get(sellerId);

  res.json({
    store_name: req.user.store_name,
    to_confirm: counts.placed,
    to_ship: counts.confirmed,
    counts,
    revenue_30d_amd: revenue30.amd,
    delivered_30d: revenue30.orders,
    revenue_all_amd: revenueAll.amd,
    products,
  });
});

// ---------- Products ----------
const productRules = (partial) => {
  const wrap = (label, check) => (partial ? [optional(check)] : [required(label), check]);
  return {
    title: wrap('Title', str('Title', 3, 120)),
    category_id: wrap('Category', int('Category', 1, 1e9)),
    description: wrap('Description', str('Description', 10, 5000)),
    price_amd: wrap('Price', int('Price', 1, 100_000_000)),
    stock: wrap('Stock', int('Stock', 0, 100_000)),
  };
};

function ownProduct(db, id, sellerId) {
  const p = id && db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(id, sellerId);
  if (!p) throw notFound('Product not found.');
  return p;
}

function productForEditor(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const images = db
    .prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position')
    .all(id)
    .map((i) => ({ id: i.id, position: i.position, ...imageUrls(i.file_path) }));
  return { ...p, is_published: !!p.is_published, images };
}

r.get('/seller/products', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.title, p.price_amd, p.stock, p.is_published, p.rating_avg, p.rating_count, p.updated_at,
              c.name AS category_name,
              (SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS main_image,
              (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) AS image_count,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
                 JOIN seller_orders so ON so.id = oi.seller_order_id
                WHERE oi.product_id = p.id AND so.status <> 'cancelled') AS units_sold
         FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.seller_id = ?
        ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(req.user.id);
  res.json({
    products: rows.map(({ main_image, ...p }) => ({ ...p, is_published: !!p.is_published, image: imageUrls(main_image) })),
  });
});

r.get('/seller/products/:id', (req, res) => {
  const db = getDb();
  const p = ownProduct(db, parseId(req.params.id), req.user.id);
  res.json({ product: productForEditor(db, p.id) });
});

function checkCategory(db, categoryId) {
  if (categoryId !== undefined && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(Number(categoryId))) {
    throw badRequest('Please fix the highlighted fields.', { category_id: 'Choose a category from the list.' });
  }
}

// New products start unpublished: images are added next, then the seller publishes.
r.post('/seller/products', (req, res) => {
  const v = validate(req.body, productRules(false));
  const db = getDb();
  checkCategory(db, v.category_id);
  const ts = now();
  const id = db
    .prepare(
      `INSERT INTO products (seller_id, category_id, title, description, price_amd, stock, is_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(req.user.id, Number(v.category_id), v.title, v.description, Number(v.price_amd), Number(v.stock), ts, ts).lastInsertRowid;
  res.status(201).json({ product: productForEditor(db, id) });
});

r.patch('/seller/products/:id', (req, res) => {
  const db = getDb();
  const id = parseId(req.params.id);
  const v = validate(req.body, {
    ...productRules(true),
    is_published: [optional((x) => (typeof x === 'boolean' ? undefined : 'Must be true or false.'))],
    main_image_id: [optional(int('Main image', 1, 1e12))],
  });
  checkCategory(db, v.category_id);

  db.transaction(() => {
    const p = ownProduct(db, id, req.user.id);
    const sets = [];
    const params = [];
    for (const f of ['title', 'description']) if (v[f] !== undefined) { sets.push(`${f} = ?`); params.push(v[f]); }
    for (const f of ['category_id', 'price_amd', 'stock']) if (v[f] !== undefined) { sets.push(`${f} = ?`); params.push(Number(v[f])); }
    if (v.is_published !== undefined) {
      if (v.is_published) {
        const n = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(p.id).n;
        if (n === 0) throw badRequest('Add at least one photo before publishing.', { images: 'Add at least one photo before publishing.' });
      }
      sets.push('is_published = ?');
      params.push(v.is_published ? 1 : 0);
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(now());
      db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND seller_id = ?`).run(...params, p.id, req.user.id);
    }
    if (v.main_image_id !== undefined) setMainImage(db, p.id, Number(v.main_image_id));
  }).immediate();

  res.json({ product: productForEditor(db, id) });
});

/** Renumber positions 0..n-1 in the given order (two steps because of UNIQUE (product_id, position)). */
function renumber(db, productId, orderedIds) {
  db.prepare('UPDATE product_images SET position = -position - 1 WHERE product_id = ?').run(productId);
  const set = db.prepare('UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?');
  orderedIds.forEach((imgId, i) => set.run(i, imgId, productId));
}

function setMainImage(db, productId, imageId) {
  const ids = db.prepare('SELECT id FROM product_images WHERE product_id = ? ORDER BY position').all(productId).map((r) => r.id);
  if (!ids.includes(imageId)) throw badRequest('Please fix the highlighted fields.', { main_image_id: 'That image does not belong to this product.' });
  renumber(db, productId, [imageId, ...ids.filter((x) => x !== imageId)]);
}

// ---------- Images ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: config.maxImagesPerProduct },
});
const MB = Math.round(config.maxUploadBytes / 1024 / 1024);

function uploadImages(req, res, next) {
  upload.array('images', config.maxImagesPerProduct)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(`File is too large. Each photo must be at most ${MB} MB.`,{ images: `Each photo must be at most ${MB} MB.` }));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest(`Upload at most ${config.maxImagesPerProduct} photos, in the "images" field.`));
    next(badRequest('Upload failed: ' + err.message));
  });
}

r.post(
  '/seller/products/:id/images',
  // Ownership is checked before the upload is even read.
  (req, _res, next) => { ownProduct(getDb(), parseId(req.params.id), req.user.id); next(); },
  uploadImages,
  async (req, res) => {
    const db = getDb();
    const id = parseId(req.params.id);
    const files = req.files || [];
    if (!files.length) throw badRequest('Choose at least one photo.', { images: 'Choose at least one photo.' });
    const existing = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(id).n;
    if (existing + files.length > config.maxImagesPerProduct) {
      throw badRequest(`A product can have at most ${config.maxImagesPerProduct} photos (it has ${existing}).`, { images: `At most ${config.maxImagesPerProduct} photos per product.` });
    }

    // Check + resize + write files first — never inside a transaction.
    const paths = [];
    try {
      for (const f of files) paths.push(await processImage(f.buffer, f.originalname));
    } catch (e) {
      await Promise.all(paths.map(deleteImageFiles));
      throw e;
    }

    // Then a short transaction stores only the paths.
    try {
      db.transaction(() => {
        ownProduct(db, id, req.user.id);
        const n = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxpos FROM product_images WHERE product_id = ?').get(id);
        if (n.n + paths.length > config.maxImagesPerProduct) throw badRequest(`A product can have at most ${config.maxImagesPerProduct} photos.`);
        const ins = db.prepare('INSERT INTO product_images (product_id, file_path, position) VALUES (?, ?, ?)');
        paths.forEach((p, i) => ins.run(id, p, n.maxpos + 1 + i));
        db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now(), id);
      }).immediate();
    } catch (e) {
      await Promise.all(paths.map(deleteImageFiles));
      throw e;
    }
    res.status(201).json({ product: productForEditor(db, id) });
  }
);

r.delete('/seller/products/:id/images', async (req, res) => {
  const db = getDb();
  const id = parseId(req.params.id);
  const imageId = parseId(req.query.imageId ?? req.body?.image_id);
  const removed = db
    .transaction(() => {
      const p = ownProduct(db, id, req.user.id);
      const img = imageId && db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(imageId, p.id);
      if (!img) throw notFound('Image not found.');
      const count = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(p.id).n;
      if (p.is_published && count === 1) {
        throw conflict('LAST_IMAGE', 'A published product needs at least one photo. Add another photo or unpublish first.');
      }
      db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
      const rest = db.prepare('SELECT id FROM product_images WHERE product_id = ? ORDER BY position').all(p.id).map((r) => r.id);
      renumber(db, p.id, rest);
      return img.file_path;
    })
    .immediate();
  await deleteImageFiles(removed); // file removal after commit
  res.json({ product: productForEditor(db, id) });
});

// ---------- Orders ----------
r.get('/seller/orders', (req, res) => {
  const db = getDb();
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM seller_orders WHERE seller_id = ? GROUP BY status').all(req.user.id)) {
    counts[row.status] = row.n;
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;
  const rows = db
    .prepare(
      `SELECT so.id, so.order_id, so.status, so.subtotal_amd, so.updated_at, o.created_at,
              o.recipient, o.city, o.region,
              (SELECT SUM(quantity) FROM order_items WHERE seller_order_id = so.id) AS units
         FROM seller_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.seller_id = ? ${status ? 'AND so.status = ?' : ''}
        ORDER BY so.id DESC LIMIT ? OFFSET ?`
    )
    .all(...[req.user.id, ...(status ? [status] : []), pageSize, (page - 1) * pageSize]);
  const total = status ? counts[status] : Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ orders: rows, counts, total, page, totalPages: Math.max(Math.ceil(total / pageSize), 1) });
});

r.get('/seller/orders/:id', (req, res) => {
  const db = getDb();
  const id = parseId(req.params.id);
  // Scoped to the current seller: someone else's order is "not found", no data shown.
  const so = id && db
    .prepare(
      `SELECT so.id, so.order_id, so.status, so.subtotal_amd, so.updated_at,
              o.created_at, o.recipient, o.phone, o.region, o.city, o.street, o.apartment, o.note,
              u.name AS buyer_name
         FROM seller_orders so JOIN orders o ON o.id = so.order_id JOIN users u ON u.id = o.buyer_id
        WHERE so.id = ? AND so.seller_id = ?`
    )
    .get(id, req.user.id);
  if (!so) throw notFound('Order not found.');
  const items = db
    .prepare(
      `SELECT oi.id, oi.product_id, oi.title, oi.unit_price_amd, oi.quantity,
              (SELECT file_path FROM product_images WHERE product_id = oi.product_id ORDER BY position LIMIT 1) AS main_image
         FROM order_items oi WHERE oi.seller_order_id = ? ORDER BY oi.id`
    )
    .all(so.id)
    .map(({ main_image, ...i }) => ({ ...i, image: imageUrls(main_image) }));
  res.json({
    order: {
      ...so,
      cash_to_collect_amd: so.status === 'cancelled' ? 0 : so.subtotal_amd,
      items,
      allowed_moves: allowedMoves('seller', so.status),
      history: historyFor([so.id])[so.id] || [],
    },
  });
});

// The only way to change a status.
r.post('/seller/orders/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) throw notFound('Order not found.');
  const to = req.body?.to;
  if (!STATUSES.includes(to)) throw badRequest(`"to" must be one of: ${STATUSES.join(', ')}.`, { to: 'Unknown status.' });
  const result = changeStatus({
    sellerOrderId: id,
    to,
    role: 'seller',
    actorId: req.user.id,
    scopeSql: 'so.seller_id = ?',
    scopeParams: [req.user.id],
  });
  res.json(result);
});

export default r;
