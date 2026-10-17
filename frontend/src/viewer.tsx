import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setDemoRole } from './api';
import { useAuth } from './auth';
import type { Role, Viewer } from './types';

const DEMO_ROLE_KEY = 'evidenceloop.demoRole';

interface ViewerState {
  viewer: Viewer | null;
  /** Local development only: switch between the demo technician and reviewer. */
  switchDemoRole: (role: Role) => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

function storedDemoRole(): Role {
  try {
    return localStorage.getItem(DEMO_ROLE_KEY) === 'reviewer' ? 'reviewer' : 'technician';
  } catch {
    return 'technician';
  }
}

/**
 * Who is signed in and in which role. With Supabase the role is assigned by an
 * administrator; in local development a switcher picks the demo user. Either
 * way the backend enforces it — the UI only reflects it.
 */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [role, setRole] = useState<Role>(() => {
    const initial = auth.enabled ? null : storedDemoRole();
    setDemoRole(initial);
    return initial ?? 'technician';
  });

  const signedIn = !auth.enabled || auth.session !== null;
  const sessionUser = auth.session?.user.id ?? null;

  useEffect(() => {
    if (!signedIn) {
      setViewer(null);
      return;
    }
    let cancelled = false;
    api.me().then(
      (value) => !cancelled && setViewer(value),
      () => !cancelled && setViewer(null),
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, sessionUser, role]);

  const switchDemoRole = useCallback(
    (next: Role) => {
      if (auth.enabled) return;
      try {
        localStorage.setItem(DEMO_ROLE_KEY, next);
      } catch {
        // storage unavailable: the switch still applies to this page load
      }
      setDemoRole(next);
      setRole(next);
    },
    [auth.enabled],
  );

  const value = useMemo(() => ({ viewer, switchDemoRole }), [viewer, switchDemoRole]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  const value = useContext(ViewerContext);
  if (!value) throw new Error('useViewer must be used inside ViewerProvider');
  return value;
}
