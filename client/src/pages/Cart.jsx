import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, amd } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, EmptyState, QtyInput, Spinner, useAsync, useTitle } from '../components.jsx';

export default function Cart() {
  useTitle('Cart');
  const nav = useNavigate();
  const { setCartCount } = useAuth();
  const cart = useAsync(() => api.get('/cart'), []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { if (cart.data) setCartCount(cart.data.item_count); }, [cart.data, setCartCount]);

  const change = async (productId, fn) => {
    setBusy(productId);
    setError(null);
    try {
      cart.setData(await fn());
    } catch (e) {
      setError(e.message);
      cart.reload();
    } finally {
      setBusy(null);
    }
  };
  const setQty = (pid, quantity) => change(pid, () => api.put(`/cart/items/${pid}`, { quantity }));
  const remove = (pid) => change(pid, () => api.del(`/cart/items/${pid}`));

  if (cart.loading && !cart.data) return <Spinner />;
  if (cart.error) return <Alert>{cart.error.message}</Alert>;
  const c = cart.data;
  if (!c.groups.length) {
    return <EmptyState title="Your Shuka cart is empty." action={<Link to="/search" className="btn btn-primary">Continue shopping</Link>} />;
  }
  const priceChanges = c.groups.flatMap((g) => g.items).filter((i) => i.warnings.some((w) => w.code === 'PRICE_CHANGED'));

  return (
    <div className="cart-page">
      <div className="cart-main">
        <h1>Shopping cart</h1>
        <Alert>{error}</Alert>
        {priceChanges.length > 0 && (
          <Alert kind="warn">Some prices changed since you added the items. The new prices are shown below; checkout will ask you to confirm them.</Alert>
        )}
        {c.groups.map((g) => (
          <section key={g.seller_id} className="card cart-group">
            <div className="cart-group-head">
              <span>Sold by <b>{g.store_name}</b></span>
              <span>Subtotal: <b>{amd(g.subtotal_amd)}</b></span>
            </div>
            {g.items.map((i) => (
              <div key={i.product_id} className={`cart-line ${busy === i.product_id ? 'loading' : ''}`}>
                <Link to={`/p/${i.product_id}`} className="cart-line-img" tabIndex={-1} aria-hidden="true">
                  {i.image ? <img src={i.image.thumb} alt="" /> : <div className="noimg">—</div>}
                </Link>
                <div className="cart-line-info">
                  <Link to={`/p/${i.product_id}`} className="cart-line-title">{i.title}</Link>
                  <div className="price">{amd(i.price_amd)}</div>
                  {i.warnings.map((w) => (
                    <div key={w.code} className={`line-warning ${w.code === 'PRICE_CHANGED' ? 'warn' : 'err'}`}>⚠ {w.message}</div>
                  ))}
                  <div className="cart-line-actions">
                    {i.stock > 0 ? (
                      <QtyInput value={i.quantity} max={Math.max(i.stock, 1)} onChange={(q) => setQty(i.product_id, q)} disabled={busy === i.product_id} />
                    ) : null}
                    {i.quantity > i.stock && i.stock > 0 && (
                      <button className="linklike" onClick={() => setQty(i.product_id, i.stock)}>Set to {i.stock}</button>
                    )}
                    <button className="linklike" onClick={() => remove(i.product_id)}>Delete</button>
                  </div>
                </div>
                <div className="cart-line-total">{i.buyable ? amd(i.line_total_amd) : <span className="muted">Not counted</span>}</div>
              </div>
            ))}
          </section>
        ))}
      </div>
      <aside className="card cart-summary">
        <div className="cart-total">
          Subtotal ({c.item_count} {c.item_count === 1 ? 'item' : 'items'}): <b>{amd(c.total_amd)}</b>
        </div>
        <div className="small muted">{c.groups.length} {c.groups.length === 1 ? 'seller' : 'sellers'} · Payment: cash on delivery</div>
        {c.blocking_problems > 0 && <Alert kind="warn">Fix the items marked in red before checkout.</Alert>}
        <button className="btn btn-primary btn-block" disabled={c.blocking_problems > 0} onClick={() => nav('/checkout')}>
          Proceed to checkout
        </button>
      </aside>
    </div>
  );
}
