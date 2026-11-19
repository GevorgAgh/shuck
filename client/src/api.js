export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || 'Request failed');
    this.status = status;
    this.code = error?.code;
    this.fields = error?.fields || {};
    this.data = error || {};
  }
}

// Data the server embedded in the HTML for the first screen (absent in the Vite dev server).
const boot = (typeof window !== 'undefined' && window.__BOOT__) || null;
export const hasBoot = !!boot;
export const bootMe = boot ? boot.me : undefined;

/** Returns embedded data for an API path once (then it is gone, so later visits fetch fresh data). */
export function peek(path) {
  if (!boot || !(path in boot.api)) return undefined;
  const data = boot.api[path];
  delete boot.api[path];
  return data;
}

async function request(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Network error — check your connection and try again.' });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error);
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, formData),
};

export const amd = (n) => `${Number(n || 0).toLocaleString('en-US')} ֏`;
export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const REGIONS = [
  'Yerevan', 'Aragatsotn', 'Ararat', 'Armavir', 'Gegharkunik', 'Kotayk',
  'Lori', 'Shirak', 'Syunik', 'Tavush', 'Vayots Dzor',
];

export const STATUS_LABEL = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
