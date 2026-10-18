import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth } from './auth';
import { Login } from './components/Login';
import { loginPath, safeReturnPath } from './lib/returnTo';

// A signed-out Supabase client whose sign-in succeeds and notifies listeners.
const supabaseMock = vi.hoisted(() => {
  let listener: ((event: string, session: unknown) => void) | null = null;
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => (listener = null) } } };
      }),
      signInWithPassword: vi.fn(async () => {
        listener?.('SIGNED_IN', { user: { id: 'u1' }, access_token: 't' });
        return { error: null };
      }),
    },
  };
});
vi.mock('./lib/supabase', () => ({ supabase: supabaseMock }));

describe('safeReturnPath', () => {
  it('keeps a same-site path with its query string and hash', () => {
    expect(safeReturnPath('/work-orders?status=CONTRADICTED')).toBe('/work-orders?status=CONTRADICTED');
    expect(safeReturnPath('/work-orders/abc?x=1#evidence')).toBe('/work-orders/abc?x=1#evidence');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      'https://evil.example/',
      '//evil.example/path',
      '/\\evil.example',
      '/\t/evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(safeReturnPath(value)).toBe('/dashboard');
    }
  });

  it('does not send the user back to the sign-in page', () => {
    expect(safeReturnPath('/login?next=%2Fdashboard')).toBe('/dashboard');
  });

  it('encodes the whole address into the sign-in link', () => {
    expect(loginPath({ pathname: '/work-orders', search: '?status=CONTRADICTED', hash: '' })).toBe(
      '/login?next=%2Fwork-orders%3Fstatus%3DCONTRADICTED',
    );
  });
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

describe('sign-in redirect', () => {
  it('sends a signed-out user to sign in and back to the full address, query string included', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/work-orders?status=CONTRADICTED']}>
          <Routes>
            <Route path="login" element={<><Login /><Where /></>} />
            <Route path="work-orders" element={<RequireAuth><Where /></RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect((await screen.findByTestId('where')).textContent).toBe('/login?next=%2Fwork-orders%3Fstatus%3DCONTRADICTED');
    await user.type(screen.getByLabelText('Email'), 'tech@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await act(() => user.click(screen.getByRole('button', { name: 'Sign in' })));
    expect(screen.getByTestId('where').textContent).toBe('/work-orders?status=CONTRADICTED');
  });

  it('ignores an off-site return address', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login?next=https%3A%2F%2Fevil.example%2F']}>
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    await user.type(await screen.findByLabelText('Email'), 'tech@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await act(() => user.click(screen.getByRole('button', { name: 'Sign in' })));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });
});
