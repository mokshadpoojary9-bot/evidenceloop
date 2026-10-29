import { LoaderCircle, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { currentPasswordError, emailError, newPasswordError, PASSWORD_MIN_LENGTH } from '../lib/authValidation';
import { NEXT_PARAM, safeReturnPath } from '../lib/returnTo';
import { Button, Field, Input } from './ui';

type FieldErrors = { email: string | null; password: string | null };
const NO_ERRORS: FieldErrors = { email: null, password: null };

export function Login() {
  const auth = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  /** Set after a sign-up that still needs the emailed confirmation link. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);

  const next = new URLSearchParams(location.search).get(NEXT_PARAM);
  const destination = safeReturnPath(next);
  if (!auth.enabled || auth.session) return <Navigate to={destination} replace />;

  const handleGoogle = async () => {
    setBusy('google');
    setMessage(null);
    const error = await auth.signInWithGoogle(next);
    // On success the browser is already on its way to Google.
    if (error) {
      setBusy(null);
      setMessage({ text: error, error: true });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: FieldErrors = {
      email: emailError(email),
      password: mode === 'sign-up' ? newPasswordError(password) : currentPasswordError(password),
    };
    setFieldErrors(errors);
    setMessage(null);
    if (errors.email || errors.password) return;

    setBusy('email');
    if (mode === 'sign-in') {
      const error = await auth.signIn(email.trim(), password);
      setBusy(null);
      if (error) setMessage({ text: error, error: true });
      return;
    }
    const result = await auth.signUp(email.trim(), password);
    setBusy(null);
    if (result.error !== null) setMessage({ text: result.error, error: true });
    else if (result.confirmEmail) {
      setAwaitingConfirmation(email.trim());
      setPassword('');
    }
    // Otherwise sign-up returned a session and the redirect above takes over.
  };

  if (awaitingConfirmation) {
    return (
      <div role="status" className="card mx-auto mt-10 max-w-sm space-y-4 p-6 text-center">
        <MailCheck className="mx-auto size-10 text-proven-fg" aria-hidden />
        <h1 className="text-xl font-bold text-fg">Check your email to confirm your account</h1>
        <p className="text-sm text-fg-muted">
          We sent a confirmation link to <strong className="text-fg">{awaitingConfirmation}</strong>. Open it to
          activate your account; you will be signed in here. You cannot sign in until the address is confirmed.
        </p>
        <p className="text-xs text-fg-subtle">No email after a few minutes? Check your spam folder.</p>
        <Button
          type="button"
          className="w-full"
          onClick={() => {
            setAwaitingConfirmation(null);
            setMode('sign-in');
            setMessage(null);
          }}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="card mx-auto mt-10 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-bold text-fg">{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</h1>
      <Button type="button" variant="primary" className="w-full" disabled={busy !== null} onClick={() => void handleGoogle()}>
        {busy === 'google' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <GoogleG />}
        Continue with Google
      </Button>
      <p className="flex items-center gap-3 text-xs text-fg-faint" aria-hidden>
        <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
      </p>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Email" error={fieldErrors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((current) => ({ ...current, email: null }));
              }}
              required
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={mode === 'sign-up' ? `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.` : undefined}
          error={fieldErrors.password}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: null }));
              }}
              required
            />
          )}
        </Field>
        {message && (
          <p role="status" className={`text-sm ${message.error ? 'text-contradicted-fg' : 'text-proven-fg'}`}>
            {message.text}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === 'email' && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        </Button>
      </form>
      <button
        type="button"
        className="w-full text-center text-sm text-fg-subtle hover:text-fg"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
          setMessage(null);
          setFieldErrors(NO_ERRORS);
        }}
      >
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
      <p className="text-center text-xs text-fg-faint">
        By continuing you agree to the{' '}
        <Link to="/terms" className="underline hover:text-fg">Terms</Link> and{' '}
        <Link to="/privacy" className="underline hover:text-fg">Privacy Policy</Link>.
      </p>
    </div>
  );
}

/** Google's four-colour "G" mark, as Google's sign-in branding asks. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-4.5 rounded-full bg-white p-px" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
