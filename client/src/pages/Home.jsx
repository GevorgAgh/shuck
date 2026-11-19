import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { ProductCard, Spinner, Alert, useAsync, useTitle } from '../components.jsx';

const CAT_ICON = {
  electronics: '🎧', 'phones-tablets': '📱', computers: '💻', 'home-kitchen': '🏠', fashion: '👟',
  'beauty-health': '🧴', books: '📚', 'sports-outdoors': '⛰️', 'toys-kids': '🧸', 'food-drinks': '🍑', 'handmade-crafts': '🏺',
};

export default function Home() {
  useTitle(null);
  const { categories } = useOutletContext();
  const NEWEST = '/products?sort=newest&pageSize=18';
  const TOP = '/products?sort=rating&pageSize=6';
  const newest = useAsync(() => api.get(NEWEST), [], NEWEST);
  const top = useAsync(() => api.get(TOP), [], TOP);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <h1>Everything from Yerevan to Meghri, in one cart.</h1>
          <p>Buy from local sellers across Armenia and pay cash when it arrives.</p>
          <Link to="/search" className="btn btn-primary btn-lg">Browse all products</Link>
        </div>
      </section>

      <section className="section">
        <h2>Shop by category</h2>
        <div className="cat-grid">
          {categories.map((c) => (
            <Link key={c.slug} to={`/search?category=${c.slug}`} className="card cat-tile">
              <span className="cat-icon" aria-hidden="true">{CAT_ICON[c.slug] || '🛍️'}</span>
              <span className="cat-name">{c.name}</span>
              <span className="muted small">{c.product_count} products</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>New arrivals</h2>
          <Link to="/search?sort=newest">See all ›</Link>
        </div>
        {newest.loading ? <Spinner /> : newest.error ? <Alert>{newest.error.message}</Alert> : (
          <div className="grid">
            {newest.data.items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} />)}
          </div>
        )}
      </section>

      {top.data?.items?.some((p) => p.rating_count > 0) && (
        <section className="section">
          <div className="section-head">
            <h2>Top rated</h2>
            <Link to="/search?sort=rating">See all ›</Link>
          </div>
          <div className="grid">
            {top.data.items.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
