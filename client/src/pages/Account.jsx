import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, useTitle } from '../components.jsx';

const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function AuthBox({ title, children }) {
  return (
    <div className="auth-wrap">
      <div className="card pad auth-box">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: values[k], onChange: (e) => setValues((v) => ({ ...v, [k]: e.target.value })) });
  const run = async (fn) => {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await fn(values);
    } catch (e) {
      setErrors(e.fields || {});
      setError(Object.keys(e.fields || {}).length ? null : e.message);
      setBusy(false);
    }
  };
  return { values, errors, error, busy, bind, run, setBusy };
}

export function Login() {
  useTitle('Sign in');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const f = useForm({ email: '', password: '' });
  if (user) return <Navigate to={next} replace />;
  return (
    <AuthBox title="Sign in">
      <form onSubmit={(e) => { e.preventDefault(); f.run(async (v) => { await api.post('/auth/login', v); await refresh(); nav(next, { replace: true }); }); }} noValidate>
        <Alert>{f.error}</Alert>
        <Field label="Email" error={f.errors.email}><input type="email" autoComplete="email" {...f.bind('email')} /></Field>
        <Field label="Password" error={f.errors.password}><input type="password" autoComplete="current-password" {...f.bind('password')} /></Field>
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="divider"><span>New to Shuka?</span></div>
      <Link className="btn btn-light btn-block" to={`/register?next=${encodeURIComponent(next)}`}>Create your Shuka account</Link>
    </AuthBox>
  );
}

export function Register() {
  useTitle('Create account');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const f = useForm({ name: '', email: '', phone: '', password: '' });
  if (user) return <Navigate to={next} replace />;
  return (
    <AuthBox title="Create account">
      <form onSubmit={(e) => { e.preventDefault(); f.run(async (v) => { await api.post('/auth/register', v); await refresh(); nav(next, { replace: true }); }); }} noValidate>
        <Alert>{f.error}</Alert>
        <Field label="Your name" error={f.errors.name}><input autoComplete="name" placeholder="First and last name" {...f.bind('name')} /></Field>
        <Field label="Email" error={f.errors.email}><input type="email" autoComplete="email" {...f.bind('email')} /></Field>
        <Field label="Phone" error={f.errors.phone}><input type="tel" autoComplete="tel" placeholder="+374 91 123456" {...f.bind('phone')} /></Field>
        <Field label="Password" error={f.errors.password} hint="At least 8 characters."><input type="password" autoComplete="new-password" {...f.bind('password')} /></Field>
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Creating…' : 'Create your Shuka account'}</button>
      </form>
      <p className="small">Already have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
    </AuthBox>
  );
}

export function AccountSettings() {
  useTitle('Account');
  const { user, setUser } = useAuth();
  const f = useForm({ name: user.name, phone: user.phone });
  const [saved, setSaved] = useState(false);
  return (
    <div className="narrow">
      <h1>Account settings</h1>
      <div className="card pad">
        <p className="muted">Signed in as <b>{user.email}</b>{user.is_seller && <> · Seller: <b>{user.store_name}</b></>}</p>
        <form onSubmit={(e) => { e.preventDefault(); setSaved(false); f.run(async (v) => { const r = await api.patch('/me', v); setUser(r.user); setSaved(true); f.setBusy(false); }); }} noValidate>
          <Alert>{f.error}</Alert>
          {saved && <Alert kind="success">Saved.</Alert>}
          <Field label="Name" error={f.errors.name}><input {...f.bind('name')} /></Field>
          <Field label="Phone" error={f.errors.phone}><input type="tel" {...f.bind('phone')} /></Field>
          <button className="btn btn-primary" disabled={f.busy}>Save changes</button>
        </form>
      </div>
    </div>
  );
}

export function BecomeSeller() {
  useTitle('Sell on Shuka');
  const { user, setUser } = useAuth();
  const f = useForm({ store_name: '', phone: user.phone });
  const [activated, setActivated] = useState(false);
  if (user.is_seller) return <Navigate to={activated ? '/seller/products/new' : '/seller'} replace />;
  return (
    <div className="narrow">
      <div className="sell-hero">
        <h1>Sell on Shuka</h1>
        <p>Reach buyers all over Armenia. No fees, no paperwork: pick a store name and you can list products right away. Buyers pay your courier in cash.</p>
      </div>
      <div className="card pad">
        <form onSubmit={(e) => { e.preventDefault(); f.run(async (v) => { const r = await api.post('/seller/activate', v); setActivated(true); setUser(r.user); }); }} noValidate>
          <Alert>{f.error}</Alert>
          <Field label="Store name" error={f.errors.store_name} hint="Buyers see this on your products."><input {...f.bind('store_name')} placeholder="e.g. Ararat Electronics" /></Field>
          <Field label="Phone for orders" error={f.errors.phone}><input type="tel" {...f.bind('phone')} /></Field>
          <button className="btn btn-primary" disabled={f.busy}>Start selling</button>
        </form>
      </div>
    </div>
  );
}
