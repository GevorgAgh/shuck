import { Router } from 'express';
import { getDb, now } from '../db.js';
import { validate, required, str, email, phone } from '../lib/validate.js';
import { conflict, unauthorized } from '../lib/errors.js';
import {
  hashPassword, checkPassword, createSession, destroySession, requireAuth, publicUser,
} from '../lib/auth.js';

const r = Router();

r.post('/auth/register', async (req, res) => {
  const v = validate(req.body, {
    email: [required('Email'), email()],
    password: [required('Password'), (p) => (typeof p === 'string' && p.length >= 8 && p.length <= 200 ? undefined : 'Password must be at least 8 characters.')],
    name: [required('Name'), str('Name', 2, 80)],
    phone: [required('Phone'), phone()],
  });
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) {
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists.', { fields: { email: 'This email is already registered.' } });
  }
  const hash = await hashPassword(req.body.password); // hashing happens outside any transaction
  let info;
  try {
    info = db
      .prepare('INSERT INTO users (email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(v.email, hash, v.name, v.phone, now());
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('EMAIL_TAKEN', 'An account with this email already exists.', { fields: { email: 'This email is already registered.' } });
    throw e;
  }
  createSession(res, info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

r.post('/auth/login', async (req, res) => {
  const v = validate(req.body, { email: [required('Email')], password: [required('Password')] });
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(v.email));
  if (!user || !(await checkPassword(String(req.body.password), user.password_hash))) {
    throw unauthorized('Wrong email or password.');
  }
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

r.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/** The signed-in user's header data (also embedded in the HTML page on first load). */
export function meData(user) {
  const db = getDb();
  const cart = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM cart_items WHERE user_id = ?')
    .get(user.id);
  // The address of the last order pre-fills the next checkout.
  const last = db
    .prepare(
      'SELECT recipient, phone, region, city, street, apartment FROM orders WHERE buyer_id = ? ORDER BY id DESC LIMIT 1'
    )
    .get(user.id);
  return { user: publicUser(user), cart_count: cart.n, last_address: last || null };
}

r.get('/me', requireAuth, (req, res) => {
  res.json(meData(req.user));
});

r.patch('/me', requireAuth, (req, res) => {
  const v = validate(req.body, {
    name: [required('Name'), str('Name', 2, 80)],
    phone: [required('Phone'), phone()],
  });
  const db = getDb();
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(v.name, v.phone, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default r;
