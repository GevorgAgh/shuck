import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, now } from '../db.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from './errors.js';

export const COOKIE = 'shuka_sid';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, expires.toISOString(), now());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Loads req.user from the session cookie (or leaves it null for guests). */
export function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    req.user =
      getDb()
        .prepare(
          `SELECT u.id, u.email, u.name, u.phone, u.store_name
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = ? AND s.expires_at > ?`
        )
        .get(hashToken(token), now()) || null;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireSeller(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.store_name) return next(forbidden('Become a seller first.'));
  next();
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, store_name: u.store_name, is_seller: !!u.store_name };
}
