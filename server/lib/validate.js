import { badRequest } from './errors.js';

export const REGIONS = [
  'Yerevan', 'Aragatsotn', 'Ararat', 'Armavir', 'Gegharkunik', 'Kotayk',
  'Lori', 'Shirak', 'Syunik', 'Tavush', 'Vayots Dzor',
];

/**
 * Tiny field validator. rules: { field: [checkFn, ...] } where checkFn(value) returns
 * an error message or undefined. Throws 400 with per-field messages.
 */
export function validate(body, rules) {
  const fields = {};
  const out = {};
  for (const [name, checks] of Object.entries(rules)) {
    let value = body?.[name];
    if (typeof value === 'string') value = value.trim();
    for (const check of checks) {
      const msg = check(value);
      if (msg) { fields[name] = msg; break; }
    }
    out[name] = value;
  }
  if (Object.keys(fields).length) throw badRequest('Please fix the highlighted fields.', fields);
  return out;
}

export const required = (label) => (v) =>
  v === undefined || v === null || v === '' ? `${label} is required.` : undefined;
export const optional = (check) => (v) => (v === undefined || v === null || v === '' ? undefined : check(v));
export const str = (label, min, max) => (v) => {
  if (typeof v !== 'string') return `${label} must be text.`;
  if (v.length < min) return min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`;
  if (v.length > max) return `${label} must be at most ${max} characters.`;
};
export const int = (label, min, max) => (v) => {
  const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n)) return `${label} must be a whole number.`;
  if (n < min) return `${label} must be at least ${min.toLocaleString('en-US')}.`;
  if (n > max) return `${label} must be at most ${max.toLocaleString('en-US')}.`;
};
export const email = () => (v) =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200 ? undefined : 'Enter a valid email address.';
export const phone = () => (v) =>
  typeof v === 'string' && /^\+?[0-9][0-9 ()-]{6,18}[0-9]$/.test(v) ? undefined : 'Enter a valid phone number, e.g. +374 91 123456.';
export const oneOf = (label, list) => (v) => (list.includes(v) ? undefined : `Choose a valid ${label.toLowerCase()}.`);

export const toInt = (v) => (typeof v === 'string' ? Number(v) : v);

/** Parse a positive integer id from a route param, 404-style if invalid. */
export function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
