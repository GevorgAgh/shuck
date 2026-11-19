import { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ProductCard, Spinner, Alert, Pagination, EmptyState, useAsync, useTitle } from '../components.jsx';

const SORTS = [
  ['newest', 'Newest arrivals'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['rating', 'Avg. customer review'],
];

export default function Search() {
  const { categories } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const minPrice = params.get('minPrice') || '';
  const maxPrice = params.get('maxPrice') || '';
  const sort = params.get('sort') || 'newest';
  const page = Number(params.get('page')) || 1;

  // Filters and sort live in the URL, so any search can be shared.
  const key = `/products?${params.toString()}`;
  const res = useAsync(() => api.get(key), [key], key);
  const catName = categories.find((c) => c.slug === category)?.name;
  useTitle(q ? `“${q}”` : catName || 'All products');

  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => { setMin(minPrice); setMax(maxPrice); }, [minPrice, maxPrice]);

  const update = (changes) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? sp.set(k, v) : sp.delete(k));
    if (!('page' in changes)) sp.delete('page');
    setParams(sp);
    if ('page' in changes) window.scrollTo({ top: 0 });
  };

  const applyPrice = (e) => {
    e.preventDefault();
    update({ minPrice: min.replace(/\D/g, ''), maxPrice: max.replace(/\D/g, '') });
    setShowFilters(false);
  };

  const data = res.data;
  const heading = q ? <>Results for “<b>{q}</b>”{catName && <> in {catName}</>}</> : catName || 'All products';

  return (
    <div className="search-page">
      <aside className={`filters ${showFilters ? 'open' : ''}`}>
        <h3>Category</h3>
        <ul className="filter-list">
          <li><button className={!category ? 'active' : ''} onClick={() => update({ category: '' })}>Any category</button></li>
          {categories.map((c) => (
            <li key={c.slug}>
              <button className={category === c.slug ? 'active' : ''} onClick={() => { update({ category: c.slug }); setShowFilters(false); }}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        <h3>Price (֏)</h3>
        <form className="price-filter" onSubmit={applyPrice}>
          <input inputMode="numeric" placeholder="From" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum price" />
          <span>–</span>
          <input inputMode="numeric" placeholder="To" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum price" />
          <button className="btn btn-light">Go</button>
        </form>
        {(minPrice || maxPrice) && (
          <button className="linklike small" onClick={() => update({ minPrice: '', maxPrice: '' })}>Clear price</button>
        )}
      </aside>

      <section className="results">
        <div className="results-bar">
          <div>
            <h1 className="results-title">{heading}</h1>
            {data && <div className="muted small">{data.total.toLocaleString('en-US')} {data.total === 1 ? 'result' : 'results'}</div>}
          </div>
          <div className="results-controls">
            <button className="btn btn-light only-sm" onClick={() => setShowFilters((s) => !s)}>Filters</button>
            <label className="sort">
              <span className="muted small">Sort by</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </div>

        {res.loading && !data ? <Spinner /> : res.error ? <Alert>{res.error.message}</Alert> : data.items.length === 0 ? (
          <EmptyState
            title="No products match your search."
            action={<Link to="/search" className="btn btn-primary">See all products</Link>}
          >
            Try other words, another category or a wider price range.
          </EmptyState>
        ) : (
          <>
            <div className={`grid ${res.loading ? 'loading' : ''}`}>
              {data.items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} />)}
            </div>
            <Pagination page={page} totalPages={data.totalPages} onPage={(n) => update({ page: String(n) })} />
          </>
        )}
      </section>
    </div>
  );
}
