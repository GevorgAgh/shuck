import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, Spinner, useTitle } from '../../components.jsx';

const MAX_IMAGES = 5;
const MAX_MB = 8;

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  useTitle(isNew ? 'Add product' : 'Edit product');
  const nav = useNavigate();
  const loc = useLocation();
  const { categories } = useOutletContext();

  const [product, setProduct] = useState(null);
  const [form, setForm] = useState({ title: '', category_id: '', description: '', price_amd: '', stock: '1', is_published: true });
  const [pending, setPending] = useState([]); // files picked but not uploaded yet (new product)
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(loc.state?.msg || null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    api.get(`/seller/products/${id}`).then(
      (r) => { load(r.product); setLoading(false); },
      (e) => { setMsg({ kind: 'error', text: e.message }); setLoading(false); }
    );
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function load(p) {
    setProduct(p);
    setForm({ title: p.title, category_id: String(p.category_id), description: p.description, price_amd: String(p.price_amd), stock: String(p.stock), is_published: p.is_published });
  }

  const previews = useMemo(() => pending.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [pending]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const numbers = () => ({
    title: form.title,
    category_id: form.category_id ? Number(form.category_id) : '',
    description: form.description,
    // Sent as cleaned text: the server parses whole numbers and explains what is wrong otherwise.
    price_amd: String(form.price_amd).replace(/[\s,֏]/g, ''),
    stock: String(form.stock).trim(),
  });

  function checkFiles(files) {
    const existing = (product?.images.length || 0) + pending.length;
    if (existing + files.length > MAX_IMAGES) return `A product can have at most ${MAX_IMAGES} photos.`;
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return `"${big.name}" is too large. Each photo must be at most ${MAX_MB} MB.`;
    return null;
  }

  async function uploadFiles(productId, files) {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    return api.upload(`/seller/products/${productId}/images`, fd);
  }

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const err = checkFiles(files);
    if (err) { setErrors((x) => ({ ...x, images: err })); return; }
    setErrors((x) => ({ ...x, images: undefined }));
    if (isNew) { setPending((p) => [...p, ...files]); return; }
    setBusy(true);
    try {
      const r = await uploadFiles(product.id, files);
      setProduct(r.product);
      setMsg({ kind: 'success', text: `${files.length} photo${files.length > 1 ? 's' : ''} uploaded.` });
    } catch (e2) {
      setErrors((x) => ({ ...x, images: e2.message }));
    }
    setBusy(false);
  };

  const imageAction = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setProduct(r.product);
      setForm((f) => ({ ...f, is_published: r.product.is_published }));
      if (okText) setMsg({ kind: 'success', text: okText });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const body = numbers();
    // Check every field first so all messages appear at once (the server checks again).
    const errs = {};
    const title = body.title.trim();
    if (title.length < 3) errs.title = title ? 'Title must be at least 3 characters.' : 'Title is required.';
    if (!body.category_id) errs.category_id = 'Choose a category from the list.';
    const desc = body.description.trim();
    if (desc.length < 10) errs.description = desc ? 'Description must be at least 10 characters.' : 'Description is required.';
    if (!body.price_amd) errs.price_amd = 'Price is required.';
    else if (!/^\d+$/.test(body.price_amd) || Number(body.price_amd) < 1) errs.price_amd = 'Price must be a whole number of dram, at least 1.';
    if (!body.stock) errs.stock = 'Stock is required.';
    else if (!/^\d+$/.test(body.stock)) errs.stock = 'Stock must be a whole number, 0 or more.';
    const photoCount = (product?.images.length || 0) + pending.length;
    if (form.is_published && photoCount === 0) errs.images = 'Add at least one photo, or untick "Published" to save a draft.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      setMsg({ kind: 'error', text: 'Please fix the highlighted fields.' });
      setBusy(false);
      return;
    }
    if (isNew) {
      let created;
      try {
        created = (await api.post('/seller/products', body)).product;
      } catch (err) {
        setErrors(err.fields || {});
        setMsg({ kind: 'error', text: err.message });
        setBusy(false);
        return;
      }
      // Product saved as a draft; now photos, then publish.
      try {
        if (pending.length) await uploadFiles(created.id, pending);
        if (form.is_published) await api.patch(`/seller/products/${created.id}`, { is_published: true });
        nav(`/seller/products/${created.id}/edit`, { replace: true, state: { msg: { kind: 'success', text: form.is_published ? 'Product published! It is now visible in the store.' : 'Draft saved.' } } });
      } catch (err) {
        nav(`/seller/products/${created.id}/edit`, { replace: true, state: { msg: { kind: 'error', text: `Product saved as a draft, but: ${err.message}` } } });
      }
      return;
    }
    try {
      const r = await api.patch(`/seller/products/${product.id}`, { ...body, is_published: form.is_published });
      load(r.product);
      setMsg({ kind: 'success', text: 'Changes saved.' });
    } catch (err) {
      setErrors(err.fields || {});
      setMsg({ kind: 'error', text: err.message });
    }
    setBusy(false);
  };

  if (loading) return <Spinner />;
  if (!isNew && !product) return <Alert>{msg?.text || 'Product not found.'}</Alert>;

  const images = product?.images || [];
  return (
    <form className="editor" onSubmit={save} noValidate>
      <nav className="crumbs small"><Link to="/seller/products">Products</Link> › {isNew ? 'New product' : product.title}</nav>
      <div className="section-head">
        <h2>{isNew ? 'Add a product' : 'Edit product'}</h2>
        {!isNew && <Link to={`/p/${product.id}`}>View in store ›</Link>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="editor-grid">
        <div className="card pad">
          <Field label="Title" error={errors.title}><input value={form.title} onChange={set('title')} maxLength={120} /></Field>
          <Field label="Category" error={errors.category_id}>
            <select value={form.category_id} onChange={set('category_id')}>
              <option value="">Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Description" error={errors.description} hint="At least 10 characters.">
            <textarea rows={6} value={form.description} onChange={set('description')} maxLength={5000} />
          </Field>
          <div className="form-grid">
            <Field label="Price (֏ AMD)" error={errors.price_amd}>
              <input inputMode="numeric" value={form.price_amd} onChange={set('price_amd')} placeholder="e.g. 15000" />
            </Field>
            <Field label="Stock (units)" error={errors.stock}>
              <input inputMode="numeric" value={form.stock} onChange={set('stock')} />
            </Field>
          </div>
        </div>

        <div className="card pad">
          <h3>Photos <span className="muted small">({images.length + pending.length}/{MAX_IMAGES}) — the first one is the main image</span></h3>
          <div className="img-grid">
            {images.map((img, i) => (
              <div key={img.id} className={`img-tile ${i === 0 ? 'main' : ''}`}>
                <img src={img.thumb} alt="" />
                {i === 0 ? <span className="img-main-tag">Main</span> : (
                  <button type="button" className="img-btn" disabled={busy} onClick={() => imageAction(() => api.patch(`/seller/products/${product.id}`, { main_image_id: img.id }), 'Main image changed.')}>Make main</button>
                )}
                <button type="button" className="img-del" aria-label="Remove photo" disabled={busy} onClick={() => imageAction(() => api.del(`/seller/products/${product.id}/images?imageId=${img.id}`), 'Photo removed.')}>×</button>
              </div>
            ))}
            {previews.map((p, i) => (
              <div key={p.url} className={`img-tile ${i === 0 && !images.length ? 'main' : ''}`}>
                <img src={p.url} alt="" />
                {i === 0 && !images.length && <span className="img-main-tag">Main</span>}
                <button type="button" className="img-del" aria-label="Remove photo" onClick={() => setPending((list) => list.filter((f) => f !== p.file))}>×</button>
              </div>
            ))}
            {images.length + pending.length < MAX_IMAGES && (
              <label className="img-add">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={pick} disabled={busy} />
                <span>+ Add photos</span>
                <span className="small muted">JPEG, PNG or WebP, up to {MAX_MB} MB</span>
              </label>
            )}
          </div>
          {errors.images && <div className="field-error">{errors.images}</div>}
          <label className="check">
            <input type="checkbox" checked={form.is_published} onChange={set('is_published')} />
            <span>Published — visible to buyers</span>
          </label>
        </div>
      </div>

      <div className="editor-actions">
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Saving…' : isNew ? (form.is_published ? 'Save and publish' : 'Save draft') : 'Save changes'}</button>
        <Link className="btn btn-light btn-lg" to="/seller/products">Cancel</Link>
      </div>
    </form>
  );
}
