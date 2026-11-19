import { Router } from 'express';
import { getDb } from '../db.js';
import { notFound } from '../lib/errors.js';
import { imageUrls } from '../lib/images.js';
import { parseId } from '../lib/validate.js';

const r = Router();
const PAGE_SIZE = 24;

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price_amd ASC, p.id DESC',
  price_desc: 'p.price_amd DESC, p.id DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC, p.id DESC',
};

const MAIN_IMAGE = '(SELECT file_path FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1)';

export function productCard(row) {
  return {
    id: row.id,
    title: row.title,
    price_amd: row.price_amd,
    stock: row.stock,
    rating_avg: row.rating_avg,
    rating_count: row.rating_count,
    image: imageUrls(row.main_image),
    store_name: row.store_name,
  };
}

// The data functions below are shared by the JSON API and by the HTML page,
// which embeds the first screen's data so it renders without waiting for API calls.

export function categoriesData() {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.slug,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_published = 1) AS product_count
         FROM categories c ORDER BY c.name`
    )
    .all();
  return { categories: rows };
}

export function productsData(query) {
  const db = getDb();
  const where = ['p.is_published = 1'];
  const params = [];

  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  if (q) {
    // Every word must appear in the title or the description.
    for (const word of q.split(/\s+/).slice(0, 8)) {
      const like = `%${word.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
  }

  let category = null;
  if (typeof query.category === 'string' && query.category) {
    category = db.prepare('SELECT id, name, slug FROM categories WHERE slug = ?').get(query.category) || null;
    where.push('p.category_id = ?');
    params.push(category ? category.id : -1);
  }

  const minPrice = parseInt(query.minPrice, 10);
  const maxPrice = parseInt(query.maxPrice, 10);
  if (Number.isFinite(minPrice) && minPrice > 0) { where.push('p.price_amd >= ?'); params.push(minPrice); }
  if (Number.isFinite(maxPrice) && maxPrice > 0) { where.push('p.price_amd <= ?'); params.push(maxPrice); }

  const sort = SORTS[query.sort] ? query.sort : 'newest';
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || PAGE_SIZE, 1), 48);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.price_amd, p.stock, p.rating_avg, p.rating_count, u.store_name, ${MAIN_IMAGE} AS main_image
         FROM products p JOIN users u ON u.id = p.seller_id
        WHERE ${whereSql}
        ORDER BY ${SORTS[sort]}
        LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map(productCard),
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    sort,
    category,
  };
}

/** One product, or null when it does not exist or is unpublished (and not the viewer's own). */
export function productData(id, user) {
  const db = getDb();
  const p = id && db
    .prepare(
      `SELECT p.*, u.store_name, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN users u ON u.id = p.seller_id JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?`
    )
    .get(id);
  if (!p || (!p.is_published && p.seller_id !== user?.id)) return null;
  const images = db
    .prepare('SELECT id, file_path, position FROM product_images WHERE product_id = ? ORDER BY position')
    .all(p.id)
    .map((i) => ({ id: i.id, position: i.position, ...imageUrls(i.file_path) }));
  return {
    product: {
      id: p.id,
      title: p.title,
      description: p.description,
      price_amd: p.price_amd,
      stock: p.stock,
      is_published: !!p.is_published,
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
      seller_id: p.seller_id,
      store_name: p.store_name,
      category: { id: p.category_id, name: p.category_name, slug: p.category_slug },
      images,
      is_own: user?.id === p.seller_id,
    },
  };
}

export function reviewsData(id) {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.rating, r.body, r.created_at, u.name AS buyer_name
         FROM reviews r JOIN users u ON u.id = r.buyer_id
        WHERE r.product_id = ?
        ORDER BY r.created_at DESC, r.id DESC LIMIT 100`
    )
    .all(id);
  return { reviews: rows };
}

r.get('/categories', (_req, res) => res.json(categoriesData()));

r.get('/products', (req, res) => res.json(productsData(req.query)));

r.get('/products/:id', (req, res) => {
  const data = productData(parseId(req.params.id), req.user);
  if (!data) throw notFound('Product not found.');
  res.json(data);
});

r.get('/products/:id/reviews', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) throw notFound('Product not found.');
  res.json(reviewsData(id));
});

export default r;
