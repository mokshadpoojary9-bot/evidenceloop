import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth';
import { useSystem } from '../hooks';
import { DISCLAIMER } from '../types';
import { AiPill } from './SystemStatus';

export function AppShell() {
  const { system, error } = useSystem();
  const auth = useAuth();

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <Link to="/" className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>
            <span className="block text-lg leading-tight font-bold tracking-tight text-white">EvidenceLoop</span>
            <span className="block text-xs text-slate-400">Prove the work. Don't just trust the photo.</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <NavLink
            to="/work-orders"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 font-semibold ${isActive ? 'bg-ink-700 text-white' : 'text-slate-300 hover:text-white'}`
            }
          >
            Work orders
          </NavLink>
          <AiPill system={system} error={error} />
          {auth.session && (
            <button className="btn px-2.5 py-1.5" onClick={() => void auth.signOut()} title={auth.session.user.email}>
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          )}
        </nav>
      </header>

      <main className="flex-1 pb-12">
        <Outlet />
      </main>

      <footer className="border-t border-line py-5 text-xs text-slate-500">
        <p>{DISCLAIMER}</p>
      </footer>
    </div>
  );
}
