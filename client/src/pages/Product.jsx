import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, amd, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, QtyInput, Spinner, Stars, StockLabel, EmptyState, useAsync, useTitle } from '../components.jsx';

function Gallery({ images, title }) {
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [images]);
  if (!images.length) return <div className="gallery-main noimg">No photo</div>;
  return (
    <div className="gallery">
      <div className="gallery-thumbs">
        {images.map((img, i) => (
          <button key={img.id} className={i === active ? 'active' : ''} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} aria-label={`Photo ${i + 1}`}>
            <img src={img.thumb} alt="" width="58" height="58" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      <div className="gallery-main">
        <img src={images[active].large} alt={title} width="1200" height="1200" fetchPriority="high" />
      </div>
    </div>
  );
}

export default function Product() {
  const { id } = useParams();
  const loc = useLocation();
  const { user, setCartCount } = useAuth();
  const prod = useAsync(() => api.get(`/products/${id}`), [id], `/products/${id}`);
  const reviews = useAsync(() => api.get(`/products/${id}/reviews`), [id], `/products/${id}/reviews`);
  const [inCart, setInCart] = useState(0);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = prod.data?.product;
  useTitle(p?.title);

  useEffect(() => {
    setQty(1);
    setMsg(null);
    if (!user) return;
    api.get('/cart').then((c) => {
      const line = c.groups.flatMap((g) => g.items).find((i) => i.product_id === Number(id));
      setInCart(line?.quantity || 0);
    }).catch(() => {});
  }, [id, user]);

  if (prod.loading) return <Spinner />;
  if (prod.error) {
    return <EmptyState title="Product not found" action={<Link className="btn btn-primary" to="/search">See all products</Link>}>It may have been removed by the seller.</EmptyState>;
  }

  const canAdd = Math.max(p.stock - inCart, 0);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const cart = await api.put(`/cart/items/${p.id}`, { quantity: inCart + Math.min(qty, canAdd) });
      setInCart(inCart + Math.min(qty, canAdd));
      setCartCount(cart.item_count);
      setMsg({ kind: 'success', text: <>Added {qty} to your cart. <Link to="/cart">Go to cart ›</Link></> });
      setQty(1);
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
      if (e.data?.stock !== undefined) prod.setData({ product: { ...p, stock: e.data.stock } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="product-page">
      <nav className="crumbs small">
        <Link to="/search">All products</Link> › <Link to={`/search?category=${p.category.slug}`}>{p.category.name}</Link>
      </nav>
      {!p.is_published && <Alert kind="info">This product is not published. Only you can see this preview.</Alert>}
      <div className="product-layout">
        <Gallery images={p.images} title={p.title} />

        <div className="product-info">
          <h1>{p.title}</h1>
          <div className="muted">Sold by <b>{p.store_name}</b></div>
          <a href="#reviews" className="rating-link"><Stars value={p.rating_avg} count={p.rating_count} size="md" /></a>
          <hr />
          <div className="price price-lg">{amd(p.price_amd)}</div>
          <h2 className="h3">About this item</h2>
          <p className="description">{p.description}</p>
        </div>

        <div className="card buybox">
          <div className="price price-lg">{amd(p.price_amd)}</div>
          <div className="small muted">Cash on delivery · Delivery across Armenia</div>
          <div className="buybox-stock"><StockLabel stock={p.stock} /></div>
          {p.is_own ? (
            <>
              <Alert kind="info">This is your product.</Alert>
              <Link className="btn btn-light btn-block" to={`/seller/products/${p.id}/edit`}>Edit product</Link>
            </>
          ) : p.stock === 0 ? (
            <button className="btn btn-block" disabled>Out of stock</button>
          ) : !user ? (
            <Link className="btn btn-primary btn-block" to={`/login?next=${encodeURIComponent(loc.pathname)}`}>Sign in to buy</Link>
          ) : (
            <>
              {inCart > 0 && <div className="small muted">You have {inCart} in your cart.</div>}
              {canAdd > 0 ? (
                <>
                  <div className="buybox-qty">
                    <span>Quantity</span>
                    <QtyInput value={Math.min(qty, canAdd)} max={canAdd} onChange={setQty} disabled={busy} />
                  </div>
                  {qty >= canAdd && <div className="small muted">Maximum available: {canAdd}</div>}
                  <button className="btn btn-primary btn-block" onClick={add} disabled={busy}>
                    {busy ? 'Adding…' : 'Add to cart'}
                  </button>
                </>
              ) : (
                <Alert kind="info">All available units are already in your cart.</Alert>
              )}
            </>
          )}
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div className="small muted">Ships from and sold by {p.store_name}.</div>
        </div>
      </div>

      <section className="section reviews" id="reviews">
        <h2>Customer reviews</h2>
        <Stars value={p.rating_avg} count={p.rating_count} size="md" />
        {reviews.loading ? <Spinner /> : reviews.data?.reviews.length ? (
          <ul className="review-list">
            {reviews.data.reviews.map((r) => (
              <li key={r.id} className="review">
                <div className="review-head"><span className="avatar">{r.buyer_name[0]}</span><b>{r.buyer_name}</b></div>
                <Stars value={r.rating} />
                <div className="muted small">Reviewed on {fmtDate(r.created_at)} · Verified purchase</div>
                <p>{r.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No reviews yet. Reviews can be written by buyers after delivery.</p>
        )}
      </section>
    </div>
  );
}
