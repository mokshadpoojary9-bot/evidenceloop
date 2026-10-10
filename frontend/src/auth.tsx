import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { supabase } from './lib/supabase';

interface AuthState {
  /** False in local development, where Supabase Auth is not configured. */
  enabled: boolean;
  loading: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      enabled: supabase !== null,
      loading,
      session,
      signIn: async (email, password) => {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        return error?.message ?? null;
      },
      signUp: async (email, password) => {
        const { error } = await supabase!.auth.signUp({ email, password });
        return error?.message ?? null;
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** Sends signed-out users to /login. A no-op when auth is not configured. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { enabled, loading, session } = useAuth();
  const location = useLocation();
  if (!enabled) return children;
  if (loading) return <p className="p-10 text-center text-slate-400">Loading…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
