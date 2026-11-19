import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, amd, fmtDate, fmtDateTime, STATUS_LABEL } from '../api.js';
import { Alert, EmptyState, Field, Spinner, StatusBadge, useAsync, useTitle } from '../components.jsx';

export function OrderPlaced() {
  const { id } = useParams();
  useTitle('Order placed');
  return (
    <div className="card pad confirm">
      <div className="confirm-icon">✓</div>
      <h1>Order placed, thank you!</h1>
      <p>Your order number is <b className="order-no">#{id}</b>.</p>
      <p className="muted">Each seller will confirm their part and deliver it. Pay in cash when it arrives.</p>
      <div className="row-gap">
        <Link className="btn btn-primary" to={`/orders/${id}`}>View order</Link>
        <Link className="btn btn-light" to="/">Continue shopping</Link>
      </div>
    </div>
  );
}

export function OrderList() {
  useTitle('My orders');
  const res = useAsync(() => api.get('/orders'), []);
  if (res.loading) return <Spinner />;
  if (res.error) return <Alert>{res.error.message}</Alert>;
  const orders = res.data.orders;
  return (
    <div className="orders-page">
      <h1>Your orders</h1>
      {!orders.length ? (
        <EmptyState title="You have no orders yet." action={<Link to="/search" className="btn btn-primary">Start shopping</Link>} />
      ) : orders.map((o) => (
        <Link to={`/orders/${o.id}`} key={o.id} className="card order-card">
          <div className="order-card-head">
            <div><span className="muted small">ORDER PLACED</span><div>{fmtDate(o.created_at)}</div></div>
            <div><span className="muted small">TOTAL</span><div>{amd(o.total_amd)}</div></div>
            <div className="grow" />
            <div className="right"><span className="muted small">ORDER #</span><div>{o.id}</div></div>
          </div>
          <div className="order-card-body">
            {o.sellers.map((s) => (
              <div key={s.id} className="order-part-row">
                <StatusBadge status={s.status} />
                <span>{s.store_name}</span>
                <span className="muted small">{s.item_count} {s.item_count === 1 ? 'item' : 'items'} · {amd(s.subtotal_amd)}</span>
              </div>
            ))}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function StatusHistory({ history }) {
  return (
    <ol className="timeline">
      {history.map((h, i) => (
        <li key={i} className={`tl-${h.to_status}`}>
          <b>{STATUS_LABEL[h.to_status]}</b>
          <span className="muted small"> · {fmtDateTime(h.created_at)} · by {h.changed_by_role}</span>
        </li>
      ))}
    </ol>
  );
}

function ReviewForm({ item, onDone }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/products/${item.product_id}/reviews`, { rating, body });
      onDone();
    } catch (e2) {
      setErr(e2.fields?.body || e2.message);
      setBusy(false);
    }
  };
  return (
    <form className="review-form" onSubmit={submit}>
      <div className="star-input" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`} aria-checked={n === rating} role="radio">★</button>
        ))}
      </div>
      <Field label="Your review" error={err}>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like or dislike?" />
      </Field>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Submit review'}</button>
    </form>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  useTitle(`Order #${id}`);
  const res = useAsync(() => api.get(`/orders/${id}`), [id]);
  const [reviewing, setReviewing] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);

  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <EmptyState title="Order not found" action={<Link to="/orders" className="btn btn-primary">Your orders</Link>} />;
  const o = res.data.order;

  const cancel = async (part) => {
    setConfirming(null);
    setBusy(part.id);
    setMsg(null);
    try {
      await api.post(`/orders/${o.id}/sellers/${part.id}/cancel`);
      setMsg({ kind: 'success', text: `The part from ${part.store_name} was cancelled.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(null);
    res.reload();
  };

  return (
    <div className="order-detail">
      <nav className="crumbs small"><Link to="/orders">Your orders</Link> › Order #{o.id}</nav>
      <h1>Order #{o.id}</h1>
      <div className="muted">Placed on {fmtDateTime(o.created_at)} · Total {amd(o.total_amd)} · Cash on delivery</div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="card pad address-card">
        <div>
          <h2 className="h3">Delivery address</h2>
          <div>{o.recipient}</div>
          <div>{o.street}{o.apartment && `, apt. ${o.apartment}`}</div>
          <div>{o.city}, {o.region}</div>
          <div>{o.phone}</div>
          {o.note && <div className="muted small">Note: {o.note}</div>}
        </div>
      </div>

      {o.sellers.map((part) => (
        <section key={part.id} className="card pad order-part">
          <div className="order-part-head">
            <div>
              <StatusBadge status={part.status} /> <b>{part.store_name}</b>
              <div className="muted small">Shipment subtotal {amd(part.subtotal_amd)} · Seller phone {part.seller_phone}</div>
            </div>
            {part.can_cancel && confirming !== part.id && (
              <button className="btn btn-light" disabled={busy === part.id} onClick={() => setConfirming(part.id)}>Cancel this part</button>
            )}
            {confirming === part.id && (
              <div className="confirm-inline">
                <span>Cancel the items from {part.store_name}?</span>
                <button className="btn btn-danger btn-sm" onClick={() => cancel(part)}>Yes, cancel</button>
                <button className="btn btn-light btn-sm" onClick={() => setConfirming(null)}>Keep</button>
              </div>
            )}
          </div>
          <div className="order-part-body">
            <div className="grow">
              {part.items.map((i) => (
                <div key={i.id} className="order-item">
                  {i.image ? <img src={i.image.thumb} alt="" /> : <div className="noimg sm">—</div>}
                  <div className="grow">
                    <Link to={`/p/${i.product_id}`}>{i.title}</Link>
                    <div className="small muted">{i.quantity} × {amd(i.unit_price_amd)}</div>
                    {i.can_review && reviewing !== i.id && (
                      <button className="btn btn-light btn-sm" onClick={() => setReviewing(i.id)}>Write a review</button>
                    )}
                    {i.reviewed && <div className="small stock-in">✓ You reviewed this product</div>}
                    {reviewing === i.id && (
                      <ReviewForm item={i} onDone={() => { setReviewing(null); setMsg({ kind: 'success', text: 'Thanks! Your review is published.' }); res.reload(); }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="order-history">
              <h3 className="h4">Status history</h3>
              <StatusHistory history={part.history} />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
