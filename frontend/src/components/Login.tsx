import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';

export function Login() {
  const auth = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const destination = (location.state as { from?: string } | null)?.from ?? '/work-orders';
  if (!auth.enabled || auth.session) return <Navigate to={destination} replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const error = mode === 'sign-in' ? await auth.signIn(email, password) : await auth.signUp(email, password);
    setBusy(false);
    if (error) setMessage({ text: error, error: true });
    else if (mode === 'sign-up') {
      setMessage({ text: 'Account created. If email confirmation is enabled, check your inbox, then sign in.', error: false });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card mx-auto mt-10 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-bold text-white">{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</h1>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Email</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Password</span>
        <input
          className="input"
          type="password"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {message && (
        <p role="status" className={`text-sm ${message.error ? 'text-rose-300' : 'text-emerald-300'}`}>
          {message.text}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
      </button>
      <button
        type="button"
        className="w-full text-center text-sm text-slate-400 hover:text-white"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
          setMessage(null);
        }}
      >
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}
