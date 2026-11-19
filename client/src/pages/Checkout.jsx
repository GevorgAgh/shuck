import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, amd, REGIONS } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, EmptyState, Field, Spinner, useAsync, useTitle } from '../components.jsx';

function randomKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export default function Checkout() {
  useTitle('Checkout');
  const nav = useNavigate();
  const { user, lastAddress, refresh, setCartCount } = useAuth();
  const cart = useAsync(() => api.get('/cart'), []);
  const requestKey = useRef(randomKey()); // one key per checkout page → a double click can't create two orders
  const [form, setForm] = useState({ recipient: '', phone: '', region: 'Yerevan', city: 'Yerevan', street: '', apartment: '', note: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // The last address is pre-filled.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      ...(lastAddress || {}),
      recipient: lastAddress?.recipient || user?.name || '',
      phone: lastAddress?.phone || user?.phone || '',
      note: '',
    }));
  }, [lastAddress, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true); // the button locks after one click
    setErrors({});
    setError(null);
    try {
      const res = await api.post('/orders', { ...form, request_key: requestKey.current });
      setCartCount(0);
      refresh();
      nav(`/order-placed/${res.order_id}`, { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      if (err.status === 409) cart.reload(); // show new prices / stock
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (cart.loading && !cart.data) return <Spinner />;
  const c = cart.data;
  if (!c?.groups.length) {
    return <EmptyState title="Your cart is empty." action={<Link to="/search" className="btn btn-primary">Continue shopping</Link>} />;
  }

  return (
    <form className="checkout-page" onSubmit={submit} noValidate>
      <div className="checkout-main">
        <h1>Checkout</h1>
        <Alert>{error}</Alert>
        <section className="card pad">
          <h2>1. Delivery address</h2>
          <div className="form-grid">
            <Field label="Recipient full name" error={errors.recipient}>
              <input value={form.recipient} onChange={set('recipient')} autoComplete="name" required />
            </Field>
            <Field label="Phone" error={errors.phone} hint="The courier will call this number.">
              <input value={form.phone} onChange={set('phone')} type="tel" autoComplete="tel" placeholder="+374 91 123456" required />
            </Field>
            <Field label="Region" error={errors.region}>
              <select value={form.region} onChange={set('region')}>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="City or village" error={errors.city}>
              <input value={form.city} onChange={set('city')} autoComplete="address-level2" required />
            </Field>
            <Field label="Street and building" error={errors.street}>
              <input value={form.street} onChange={set('street')} autoComplete="street-address" placeholder="Abovyan St 5" required />
            </Field>
            <Field label="Apartment (optional)" error={errors.apartment}>
              <input value={form.apartment} onChange={set('apartment')} />
            </Field>
          </div>
          <Field label="Note for delivery (optional)" error={errors.note}>
            <textarea value={form.note} onChange={set('note')} rows={2} placeholder="e.g. call 10 minutes before, 3rd floor, no elevator" />
          </Field>
        </section>

        <section className="card pad">
          <h2>2. Payment</h2>
          <div className="payment-cod">💵 <b>Payment: cash on delivery.</b> Pay each seller's courier when your items arrive.</div>
        </section>

        <section className="card pad">
          <h2>3. Review items</h2>
          {c.groups.map((g) => (
            <div key={g.seller_id} className="checkout-group">
              <div className="checkout-group-head">
                <span>Shipment from <b>{g.store_name}</b></span>
                <span>{amd(g.subtotal_amd)}</span>
              </div>
              {g.items.map((i) => (
                <div key={i.product_id} className="checkout-line">
                  {i.image && <img src={i.image.thumb} alt="" />}
                  <div className="grow">
                    <div>{i.title}</div>
                    <div className="small muted">{i.quantity} × {amd(i.price_amd)}</div>
                    {i.warnings.map((w) => <div key={w.code} className={`line-warning ${w.code === 'PRICE_CHANGED' ? 'warn' : 'err'}`}>⚠ {w.message}</div>)}
                  </div>
                  <b>{amd(i.line_total_amd)}</b>
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>

      <aside className="card cart-summary checkout-summary">
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting || c.blocking_problems > 0}>
          {submitting ? 'Placing order…' : 'Place your order'}
        </button>
        <h3>Order summary</h3>
        {c.groups.map((g) => (
          <div key={g.seller_id} className="sum-row"><span>{g.store_name}</span><span>{amd(g.subtotal_amd)}</span></div>
        ))}
        <div className="sum-row"><span>Delivery</span><span>Free</span></div>
        <div className="sum-row sum-total"><span>Order total</span><span>{amd(c.total_amd)}</span></div>
        <div className="small muted">Payment: cash on delivery</div>
        {c.blocking_problems > 0 && <Alert kind="warn">Some items can't be bought. <Link to="/cart">Review your cart</Link>.</Alert>}
      </aside>
    </form>
  );
}
