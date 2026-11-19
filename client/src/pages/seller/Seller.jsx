import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api, amd, fmtDate, fmtDateTime, STATUS_LABEL } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, EmptyState, Pagination, Spinner, StatusBadge, useAsync, useTitle } from '../../components.jsx';
import { StatusHistory } from '../Orders.jsx';

export function SellerLayout() {
  const { user } = useAuth();
  const ctx = useOutletContext(); // pass the categories down to the product editor
  return (
    <div className="seller">
      <div className="seller-head">
        <div>
          <div className="muted small">Seller dashboard</div>
          <h1 className="seller-store">{user.store_name}</h1>
        </div>
        <nav className="seller-tabs">
          <NavLink to="/seller" end>Overview</NavLink>
          <NavLink to="/seller/products">Products</NavLink>
          <NavLink to="/seller/orders">Orders</NavLink>
        </nav>
      </div>
      <Suspense fallback={<Spinner />}>
        <Outlet context={ctx} />
      </Suspense>
    </div>
  );
}

export function SellerOverview() {
  useTitle('Seller overview');
  const res = useAsync(() => api.get('/seller/overview'), []);
  if (res.loading) return <Spinner />;
  if (res.error) return <Alert>{res.error.message}</Alert>;
  const d = res.data;
  return (
    <>
      <div className="stat-grid">
        <Link to="/seller/orders?status=placed" className="card stat stat-accent">
          <div className="stat-label">Orders to confirm</div>
          <div className="stat-value">{d.to_confirm}</div>
        </Link>
        <Link to="/seller/orders?status=confirmed" className="card stat">
          <div className="stat-label">Orders to ship</div>
          <div className="stat-value">{d.to_ship}</div>
        </Link>
        <div className="card stat">
          <div className="stat-label">Revenue, last 30 days</div>
          <div className="stat-value">{amd(d.revenue_30d_amd)}</div>
          <div className="small muted">{d.delivered_30d} delivered {d.delivered_30d === 1 ? 'order' : 'orders'}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Products</div>
          <div className="stat-value">{d.products.published}<span className="stat-of"> / {d.products.total} published</span></div>
          {d.products.out_of_stock > 0 && <div className="small stock-out">{d.products.out_of_stock} out of stock</div>}
        </div>
      </div>
      <div className="card pad">
        <h2 className="h3">Orders by status</h2>
        <div className="status-bars">
          {Object.entries(d.counts).map(([s, n]) => (
            <Link key={s} to={`/seller/orders?status=${s}`} className="status-bar-row">
              <StatusBadge status={s} />
              <span className="bar"><span style={{ width: `${Math.min(100, (n / Math.max(...Object.values(d.counts), 1)) * 100)}%` }} className={`bar-${s}`} /></span>
              <b>{n}</b>
            </Link>
          ))}
        </div>
        <div className="muted small">All-time revenue from delivered orders: {amd(d.revenue_all_amd)}</div>
      </div>
      <div className="row-gap">
        <Link to="/seller/products/new" className="btn btn-primary">+ Add a product</Link>
        <Link to="/seller/orders" className="btn btn-light">See all orders</Link>
      </div>
    </>
  );
}

export function SellerProducts() {
  useTitle('My products');
  const res = useAsync(() => api.get('/seller/products'), []);
  const [msg, setMsg] = useState(null);
  const toggle = async (p) => {
    setMsg(null);
    try {
      await api.patch(`/seller/products/${p.id}`, { is_published: !p.is_published });
      res.reload();
    } catch (e) {
      setMsg(e.message);
    }
  };
  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <Alert>{res.error.message}</Alert>;
  const list = res.data.products;
  return (
    <>
      <div className="section-head">
        <h2>Products ({list.length})</h2>
        <Link to="/seller/products/new" className="btn btn-primary">+ Add product</Link>
      </div>
      <Alert>{msg}</Alert>
      {!list.length ? (
        <EmptyState title="No products yet." action={<Link to="/seller/products/new" className="btn btn-primary">Add your first product</Link>} />
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr><th><span className="sr-only">Photo</span></th><th>Title</th><th className="num">Price</th><th className="num">Stock</th><th>Status</th><th className="num">Sold</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="cell-thumb">{p.image ? <img className="thumb" src={p.image.thumb} alt="" /> : <div className="thumb noimg">—</div>}</td>
                  <td className="cell-title">
                    <Link to={`/p/${p.id}`}>{p.title}</Link>
                    <div className="small muted">{p.category_name}</div>
                  </td>
                  <td className="num" data-label="Price">{amd(p.price_amd)}</td>
                  <td className={`num ${p.stock === 0 ? 'stock-out' : ''}`} data-label="Stock">{p.stock}</td>
                  <td data-label="Status">{p.is_published ? <span className="badge badge-delivered">Published</span> : <span className="badge badge-cancelled">Unpublished</span>}</td>
                  <td className="num" data-label="Units sold">{p.units_sold}</td>
                  <td className="actions">
                    <Link to={`/seller/products/${p.id}/edit`} className="btn btn-light btn-sm">Edit</Link>
                    <button className="btn btn-light btn-sm" onClick={() => toggle(p)}>{p.is_published ? 'Unpublish' : 'Publish'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const TABS = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];

export function SellerOrders() {
  useTitle('Seller orders');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const page = Number(params.get('page')) || 1;
  const res = useAsync(() => api.get(`/seller/orders?${params}`), [params.toString()]);
  const d = res.data;
  const total = d ? Object.values(d.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={!status} className={!status ? 'active' : ''} onClick={() => setParams({})}>All <span className="count">{total}</span></button>
        {TABS.map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={status === s ? 'active' : ''} onClick={() => setParams({ status: s })}>
            {STATUS_LABEL[s]} <span className="count">{d?.counts[s] ?? ''}</span>
          </button>
        ))}
      </div>
      {res.loading && !d ? <Spinner /> : res.error ? <Alert>{res.error.message}</Alert> : !d.orders.length ? (
        <EmptyState title={status ? `No ${STATUS_LABEL[status].toLowerCase()} orders.` : 'No orders yet.'}>New orders appear here as soon as a buyer checks out.</EmptyState>
      ) : (
        <>
          <div className="table-wrap card">
            <table className="table">
              <thead><tr><th>Order</th><th>Date</th><th>Recipient</th><th className="num">Units</th><th className="num">Cash to collect</th><th>Status</th></tr></thead>
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.id} className="clickable">
                    <td className="cell-title" data-label="Order"><Link to={`/seller/orders/${o.id}`}>Order #{o.order_id} ›</Link></td>
                    <td data-label="Date">{fmtDate(o.created_at)}</td>
                    <td data-label="Recipient"><span>{o.recipient}<span className="small muted block">{o.city}, {o.region}</span></span></td>
                    <td className="num" data-label="Units">{o.units}</td>
                    <td className="num" data-label="Cash to collect">{amd(o.subtotal_amd)}</td>
                    <td data-label="Status"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={d.totalPages} onPage={(n) => setParams({ ...(status ? { status } : {}), page: String(n) })} />
        </>
      )}
    </>
  );
}

const MOVE_LABEL = { confirmed: 'Confirm order', shipped: 'Mark as shipped', delivered: 'Mark as delivered (cash received)', cancelled: 'Cancel order' };

export function SellerOrderDetail() {
  const { id } = useParams();
  useTitle('Seller order');
  const res = useAsync(() => api.get(`/seller/orders/${id}`), [id]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <EmptyState title="Order not found" action={<Link to="/seller/orders" className="btn btn-primary">All orders</Link>} />;
  const o = res.data.order;

  const move = async (to) => {
    setConfirmCancel(false);
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/seller/orders/${o.id}/status`, { to });
      setMsg({ kind: 'success', text: `Order moved to ${STATUS_LABEL[to]}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(false);
    res.reload();
  };

  return (
    <div className="seller-order">
      <nav className="crumbs small"><Link to="/seller/orders">Orders</Link> › #{o.order_id}</nav>
      <div className="section-head">
        <h2>Order #{o.order_id} <StatusBadge status={o.status} /></h2>
        <div className="muted small">Placed {fmtDateTime(o.created_at)}</div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="seller-order-grid">
        <div className="card pad">
          <h3>Items</h3>
          {o.items.map((i) => (
            <div key={i.id} className="order-item">
              {i.image ? <img src={i.image.thumb} alt="" /> : <div className="noimg sm">—</div>}
              <div className="grow">
                <div>{i.title}</div>
                <div className="small muted">{i.quantity} × {amd(i.unit_price_amd)} (price at purchase)</div>
              </div>
              <b>{amd(i.quantity * i.unit_price_amd)}</b>
            </div>
          ))}
          <div className="sum-row sum-total"><span>Cash to collect</span><span>{amd(o.cash_to_collect_amd)}</span></div>
        </div>
        <div className="card pad">
          <h3>Deliver to</h3>
          <div className="deliver-to">
            <div><b>{o.recipient}</b></div>
            <div><a href={`tel:${o.phone.replace(/[^+\d]/g, '')}`}>📞 {o.phone}</a></div>
            <div>{o.street}{o.apartment && `, apt. ${o.apartment}`}</div>
            <div>{o.city}, {o.region}</div>
            {o.note && <div className="note">📝 {o.note}</div>}
            <div className="small muted">Buyer account: {o.buyer_name}</div>
          </div>
          {o.allowed_moves.length > 0 && (
            <div className="moves">
              {o.allowed_moves.map((to) => (
                <button key={to} disabled={busy} className={`btn ${to === 'cancelled' ? 'btn-light' : 'btn-primary'}`} onClick={() => (to === 'cancelled' ? setConfirmCancel(true) : move(to))}>
                  {MOVE_LABEL[to]}
                </button>
              ))}
              {confirmCancel && (
                <div className="confirm-inline">
                  <span>Cancel this order? The stock goes back to your products.</span>
                  <button className="btn btn-danger btn-sm" onClick={() => move('cancelled')}>Yes, cancel</button>
                  <button className="btn btn-light btn-sm" onClick={() => setConfirmCancel(false)}>Keep</button>
                </div>
              )}
            </div>
          )}
          <h3>Status history</h3>
          <StatusHistory history={o.history} />
        </div>
      </div>
    </div>
  );
}
