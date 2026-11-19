import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { amd, peek, STATUS_LABEL } from './api.js';
import { useAuth } from './auth.jsx';

export function Stars({ value = 0, count, size = 'sm' }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={`stars stars-${size}`} title={count ? `${value.toFixed(1)} out of 5` : 'No reviews yet'}>
      <span className="stars-track" aria-hidden="true">
        ★★★★★
        <span className="stars-fill" style={{ width: `${pct}%` }}>★★★★★</span>
      </span>
      {count !== undefined && <span className="stars-count">{count ? `${value.toFixed(1)} (${count})` : 'No reviews'}</span>}
    </span>
  );
}

export function ProductCard({ p, priority = false }) {
  return (
    <Link to={`/p/${p.id}`} className="card product-card">
      <div className="product-card-img">
        {p.image ? (
          <img src={p.image.thumb} alt={p.title} width="400" height="400" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" />
        ) : <div className="noimg">No photo</div>}
      </div>
      <div className="product-card-body">
        <div className="product-card-title">{p.title}</div>
        <Stars value={p.rating_avg} count={p.rating_count} />
        <div className="price">{amd(p.price_amd)}</div>
        {p.stock === 0 ? <div className="stock-out small">Out of stock</div> : p.stock <= 3 ? <div className="stock-low small">Only {p.stock} left</div> : null}
      </div>
    </Link>
  );
}

export function StockLabel({ stock }) {
  if (stock === 0) return <span className="stock-out">Out of stock</span>;
  if (stock <= 5) return <span className="stock-low">Only {stock} left</span>;
  return <span className="stock-in">In stock</span>;
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Field({ label, error, children, hint }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="spinner" role="status"><span className="spinner-dot" />{label}</div>;
}

export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i);
  return (
    <nav className="pagination" aria-label="Pages">
      <button className="btn btn-light" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      {pages[0] > 1 && <span className="muted">…</span>}
      {pages.map((n) => (
        <button key={n} className={`btn ${n === page ? 'btn-dark' : 'btn-light'}`} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>
      ))}
      {pages.at(-1) < totalPages && <span className="muted">…</span>}
      <button className="btn btn-light" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next ›</button>
    </nav>
  );
}

export function QtyInput({ value, max, onChange, disabled }) {
  return (
    <div className="qty">
      <button type="button" className="qty-btn" aria-label="Decrease" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <input
        type="number" inputMode="numeric" min={1} max={max} value={value} disabled={disabled} aria-label="Quantity"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(1, Math.min(max, n)));
        }}
      />
      <button type="button" className="qty-btn" aria-label="Increase" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

/** Pages that need a signed-in user (or a seller) redirect to log in. */
export function RequireAuth({ seller = false, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (seller && !user.is_seller) return <Navigate to="/sell" replace />;
  return children;
}

export function useTitle(title) {
  useEffect(() => { document.title = title ? `${title} · Shuka` : 'Shuka — Armenian marketplace'; }, [title]);
}

export function useOutsideClick(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/**
 * Runs fn() when deps change. With initialKey, data the server embedded in the page for that
 * API path is used for the first render, so the page appears at once with no loading jump.
 */
export function useAsync(fn, deps, initialKey) {
  const [state, setState] = useState(() => {
    const data = initialKey ? peek(initialKey) : undefined;
    return data !== undefined ? { loading: false, data, error: null, fromBoot: true } : { loading: true, data: null, error: null };
  });
  const skipFirst = useRef(!!state.fromBoot);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => alive && setState({ loading: false, data: null, error })
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}
