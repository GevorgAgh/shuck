import { StrictMode, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './auth.jsx';
import Layout from './Layout.jsx';
import { RequireAuth, EmptyState } from './components.jsx';
import Home from './pages/Home.jsx';
import Search from './pages/Search.jsx';
import Product from './pages/Product.jsx';
import { Login, Register, AccountSettings, BecomeSeller } from './pages/Account.jsx';

// Pages a visitor rarely opens first are loaded on demand, keeping the storefront bundle small.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const loadOrders = () => import('./pages/Orders.jsx');
const loadSeller = () => import('./pages/seller/Seller.jsx');
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const OrderList = named(loadOrders, 'OrderList');
const OrderDetail = named(loadOrders, 'OrderDetail');
const OrderPlaced = named(loadOrders, 'OrderPlaced');
const SellerLayout = named(loadSeller, 'SellerLayout');
const SellerOverview = named(loadSeller, 'SellerOverview');
const SellerProducts = named(loadSeller, 'SellerProducts');
const SellerOrders = named(loadSeller, 'SellerOrders');
const SellerOrderDetail = named(loadSeller, 'SellerOrderDetail');
const ProductEditor = lazy(() => import('./pages/seller/ProductEditor.jsx'));
import './styles.css';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

const auth = (el) => <RequireAuth>{el}</RequireAuth>;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="search" element={<Search />} />
            <Route path="p/:id" element={<Product />} />
            <Route path="cart" element={auth(<Cart />)} />
            <Route path="checkout" element={auth(<Checkout />)} />
            <Route path="order-placed/:id" element={auth(<OrderPlaced />)} />
            <Route path="orders" element={auth(<OrderList />)} />
            <Route path="orders/:id" element={auth(<OrderDetail />)} />
            <Route path="account" element={auth(<AccountSettings />)} />
            <Route path="sell" element={auth(<BecomeSeller />)} />
            <Route path="seller" element={<RequireAuth seller><SellerLayout /></RequireAuth>}>
              <Route index element={<SellerOverview />} />
              <Route path="products" element={<SellerProducts />} />
              <Route path="products/new" element={<ProductEditor />} />
              <Route path="products/:id/edit" element={<ProductEditor key="edit" />} />
              <Route path="orders" element={<SellerOrders />} />
              <Route path="orders/:id" element={<SellerOrderDetail />} />
            </Route>
            <Route path="*" element={<EmptyState title="Page not found" action={<Link className="btn btn-primary" to="/">Go to the home page</Link>} />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
