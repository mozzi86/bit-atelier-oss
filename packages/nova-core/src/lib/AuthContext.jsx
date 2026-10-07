import React, { createContext, useState, useContext, useEffect } from 'react';
import { bitApi } from '@core/api/bitApi';
import { DATENQUELLE } from '@core/lib/umgebung';

// Auth context — TWO lives (Phase 57-02):
//
// express/serverlos: the local backend has no real login flow — it returns a
// single dev user from /api/auth/me (demo: demoUser()) — so this just loads
// that user on mount. Kept API-compatible so App.jsx/pages never changed.
//
// supabase (cloud, app.bit-atelier.de): real session handling. getSession()
// on mount, onAuthStateChange afterwards — SIGNED_IN loads the user,
// SIGNED_OUT clears everything (App.jsx then renders the /anmeldung route),
// TOKEN_REFRESHED keeps the user. A session that expires mid-work surfaces as
// a 401 with a plain-text message from the data layer (supabaseDb wirf) —
// writes are never lost silently (Research §7, project rule).
//
// Contract for consumers (unchanged): user, isAuthenticated, isLoadingAuth,
// authError, logout, navigateToLogin.

// null default + useAuth throws on falsy: consumers outside the provider get a
// clear error, and createContext(null) keeps checkJs quiet (TS2554).
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);

  // --- express/serverlos: wie bisher, einmal me() laden ----------------------
  useEffect(() => {
    if (DATENQUELLE === 'supabase') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const currentUser = await bitApi.auth.me();
        if (cancelled) return;
        setUser(currentUser);
        setIsAuthenticated(true);
      } catch (error) {
        if (cancelled) return;
        console.error('Auth check failed:', error);
        setAuthError({ type: 'unknown', message: error.message });
      } finally {
        if (!cancelled) setIsLoadingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- supabase: Session + onAuthStateChange (57-02 Task 4) ------------------
  useEffect(() => {
    if (DATENQUELLE !== 'supabase') return undefined;
    let cancelled = false;
    let subscription = null;
    (async () => {
      // Dynamic import behind the DATENQUELLE guard — same tree-shaking rule
      // as bitApi: supabase-js must never enter the demo/lokal bundles.
      const { supabaseClient } = await import('@core/api/supabaseClient.js');
      if (cancelled) return;
      const client = supabaseClient();

      const anwenden = async (session) => {
        if (cancelled) return;
        if (!session?.user) {
          setUser(null);
          setIsAuthenticated(false);
          return;
        }
        try {
          setUser(await bitApi.auth.me()); // adapter shape (role from org_members)
          setIsAuthenticated(true);
          setAuthError(null);
        } catch (error) {
          console.error('Supabase auth.me failed:', error);
          setAuthError({ type: 'unknown', message: error.message });
          setIsAuthenticated(false);
        }
      };

      const { data } = await client.auth.getSession();
      await anwenden(data?.session);

      subscription = client.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          anwenden(session);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setIsAuthenticated(false);
        }
      }).data.subscription;

      if (!cancelled) setIsLoadingAuth(false);
    })().catch((error) => {
      if (cancelled) return;
      console.error('Supabase auth init failed:', error);
      setAuthError({ type: 'unknown', message: error.message });
      setIsLoadingAuth(false);
    });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const logout = async () => {
    // Optimistic local clear — the UI must react even if signOut hiccups
    // (token already expired); bitApi.auth.logout reports errors itself.
    setUser(null);
    setIsAuthenticated(false);
    await bitApi.auth.logout();
  };

  const navigateToLogin = () => {
    // supabase: hard navigation to the in-app login route (rendered OUTSIDE
    // the auth gate in App.jsx). express/serverlos: no login exists — no-op.
    if (DATENQUELLE === 'supabase') bitApi.auth.redirectToLogin();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings: null,
        logout,
        navigateToLogin,
        checkAppState: () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
