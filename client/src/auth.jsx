import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, bootMe } from './api.js';

const AuthContext = createContext(null);
const SIGNED_OUT = { loading: false, user: null, cartCount: 0, lastAddress: null };

export function AuthProvider({ children }) {
  // The server embeds the signed-in user in the page, so no /me request is needed on load.
  const [state, setState] = useState(() =>
    bootMe === undefined
      ? { ...SIGNED_OUT, loading: true }
      : bootMe
        ? { loading: false, user: bootMe.user, cartCount: bootMe.cart_count, lastAddress: bootMe.last_address }
        : SIGNED_OUT
  );

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/me');
      setState({ loading: false, user: me.user, cartCount: me.cart_count, lastAddress: me.last_address });
    } catch {
      setState(SIGNED_OUT);
    }
  }, []);

  useEffect(() => { if (bootMe === undefined) refresh(); }, [refresh]);

  // Stable setters that skip the update when nothing changed (no re-render loops).
  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);
  const setCartCount = useCallback((n) => setState((s) => (s.cartCount === n ? s : { ...s, cartCount: n })), []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setState(SIGNED_OUT);
  }, []);

  const value = useMemo(() => ({ ...state, refresh, setUser, setCartCount, logout }), [state, refresh, setUser, setCartCount, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
