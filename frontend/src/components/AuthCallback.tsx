import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { NEXT_PARAM, oauthError, safeReturnPath } from '../lib/returnTo';
import { ButtonLink } from './ui';

/**
 * Google sign-in lands here. The Supabase client reads the tokens from the address while it
 * starts up; once that is done there is either a session (go on) or an error to explain.
 */
export function AuthCallback() {
  const auth = useAuth();
  const location = useLocation();
  const next = safeReturnPath(new URLSearchParams(location.search).get(NEXT_PARAM));
  const error = oauthError(location.search, location.hash);

  if (!auth.enabled || auth.session) return <Navigate to={next} replace />;

  if (auth.loading && !error) {
    return (
      <p role="status" className="card mx-auto mt-10 flex max-w-sm items-center justify-center gap-2 p-6 text-sm text-fg-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Signing you in with Google…
      </p>
    );
  }

  return (
    <div role="alert" className="card mx-auto mt-10 max-w-sm space-y-4 p-6 text-center">
      <CircleAlert className="mx-auto size-10 text-contradicted-fg" aria-hidden />
      <h1 className="text-xl font-bold text-fg">Sign-in did not complete</h1>
      <p className="text-sm text-fg-muted">{error ?? 'Google sign-in did not return a session. Please try again.'}</p>
      <ButtonLink to={`/login?${NEXT_PARAM}=${encodeURIComponent(next)}`} variant="primary" className="w-full">
        Back to sign in
      </ButtonLink>
    </div>
  );
}
