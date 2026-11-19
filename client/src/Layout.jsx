import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, peek } from './api.js';
import { useAuth } from './auth.jsx';
import { Spinner, useOutsideClick } from './components.jsx';

function useCategories() {
  const [cats, setCats] = useState(() => peek('/categories')?.categories || []);
  useEffect(() => {
    if (cats.length) return;
    api.get('/categories').then((r) => setCats(r.categories)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return cats;
}

function SearchBar({ categories }) {
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const onSearch = loc.pathname === '/search';
  const [q, setQ] = useState(onSearch ? params.get('q') || '' : '');
  const [cat, setCat] = useState(onSearch ? params.get('category') || '' : '');
  useEffect(() => {
    if (onSearch) { setQ(params.get('q') || ''); setCat(params.get('category') || ''); }
  }, [onSearch, params]);

  const submit = (e) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (cat) sp.set('category', cat);
    nav(`/search?${sp}`);
  };
  return (
    <form className="searchbar" onSubmit={submit} role="search">
      {/* The visible label sizes itself to the chosen category, so the name is never cut off. */}
      <label className="search-cat">
        <span className="search-cat-label" aria-hidden="true">{categories.find((c) => c.slug === cat)?.name || 'All'} ▾</span>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Shuka" aria-label="Search products" />
      <button type="submit" aria-label="Search">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
    </form>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClick(close);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { close(); }, [loc.pathname, close]);

  if (!user) {
    return (
      <Link to="/login" className="hdr-link">
        <span className="hdr-small">Hello, sign in</span>
        <span className="hdr-strong">Account</span>
      </Link>
    );
  }
  return (
    <div className="account-menu" ref={ref}>
      <button className="hdr-link" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="hdr-small">Hello, {user.name.split(' ')[0]}</span>
        <span className="hdr-strong">Account ▾</span>
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <Link to="/orders" role="menuitem">My orders</Link>
          {user.is_seller
            ? <Link to="/seller" role="menuitem">Seller dashboard</Link>
            : <Link to="/sell" role="menuitem">Sell on Shuka</Link>}
          <Link to="/account" role="menuitem">Account settings</Link>
          <button role="menuitem" onClick={() => { nav('/'); logout(); }}>Log out</button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const categories = useCategories();
  const { cartCount, user } = useAuth();
  const loc = useLocation();
  const [params] = useSearchParams();
  const activeCat = loc.pathname === '/search' ? params.get('category') || '' : null;
  const [catsOpen, setCatsOpen] = useState(false);
  useEffect(() => { setCatsOpen(false); }, [loc.pathname, loc.search]);
  return (
    <>
      <header className="hdr">
        <div className="hdr-top">
          <Link to="/" className="logo" title="Shuka home">
            shuka<span className="logo-dot">.am</span>
          </Link>
          <SearchBar categories={categories} />
          <div className="hdr-right">
            <AccountMenu />
            {user && (
              <Link to="/orders" className="hdr-link hide-sm">
                <span className="hdr-small">Your</span>
                <span className="hdr-strong">Orders</span>
              </Link>
            )}
            <Link to="/cart" className="hdr-cart">
              <svg aria-hidden="true" focusable="false" width="34" height="30" viewBox="0 0 34 30" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 2h5l4 17h18l4-12H8" /><circle cx="12" cy="25" r="2.3" /><circle cx="26" cy="25" r="2.3" /></svg>
              <span className="cart-count">{cartCount}</span>
              <span className="sr-only"> {cartCount === 1 ? 'item' : 'items'} in </span>
              <span className="hdr-strong sr-only-sm">Cart</span>
            </Link>
          </div>
        </div>
        <nav className={`hdr-cats ${catsOpen ? 'open' : ''}`} aria-label="Categories">
          <button type="button" className="cats-toggle" aria-expanded={catsOpen} onClick={() => setCatsOpen((o) => !o)}>
            ☰ {activeCat ? categories.find((c) => c.slug === activeCat)?.name || 'Categories' : 'Categories'}
          </button>
          <Link to="/search" className={activeCat === '' ? 'active' : ''}>All products</Link>
          {categories.map((c) => (
            <Link key={c.slug} to={`/search?category=${c.slug}`} className={activeCat === c.slug ? 'active' : ''}>{c.name}</Link>
          ))}
          {user?.is_seller
            ? <Link to="/seller" className="cats-sell">Seller dashboard</Link>
            : <Link to={user ? '/sell' : '/login?next=/sell'} className="cats-sell">Sell on Shuka</Link>}
        </nav>
      </header>
      <main className="main">
        {/* Lazy pages load inside the layout, so the header never disappears. */}
        <Suspense fallback={<Spinner />}>
          <Outlet context={{ categories }} />
        </Suspense>
      </main>
      <footer className="ftr">
        <div>
          <strong>Shuka</strong> — «շուկա», the market. Cash on delivery across Yerevan and all 10 marzer.
        </div>
        <div className="muted">Prices in Armenian dram (֏). Student project.</div>
      </footer>
    </>
  );
}
