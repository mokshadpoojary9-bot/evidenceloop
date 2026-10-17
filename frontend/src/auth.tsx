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
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

export type SignUpResult =
  | { error: string }
  /** No session yet: the account must be confirmed from the emailed link first. */
  | { error: null; confirmEmail: boolean };

/** Friendlier wording for the Supabase Auth errors people actually hit. */
function authMessage(message: string): string {
  if (/email not confirmed/i.test(message)) {
    return 'Your email address is not confirmed yet. Open the link in the confirmation email, then sign in.';
  }
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  return message;
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
        return error ? authMessage(error.message) : null;
      },
      signUp: async (email, password) => {
        // The confirmation link returns here; this origin must be listed under
        // Supabase → Authentication → URL Configuration → Redirect URLs.
        const { data, error } = await supabase!.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) return { error: authMessage(error.message) };
        return { error: null, confirmEmail: data.session === null };
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
