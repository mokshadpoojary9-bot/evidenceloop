import { motion } from 'framer-motion';
import {
  ClipboardList,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { useSystem } from '../hooks';
import { useTheme } from '../lib/theme';
import { DISCLAIMER, type Role } from '../types';
import { useViewer } from '../viewer';
import { AiPill, SystemChips } from './SystemStatus';
import { Badge, Button, Select } from './ui';

// Two layouts: the public pages (landing, sign-in) keep a top bar so the hero can use the
// full width; the signed-in app has a sidebar on desktop and a drawer on mobile.

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  isActive: (path: string) => boolean;
  /** Who sees it; everyone when omitted. Roles come from the server, never from the browser. */
  role?: Role;
}

const isWorkOrders = (p: string) => p.startsWith('/work-orders') && p !== '/work-orders/new';

// Technicians do the work; reviewers (admins) check it. Each gets their own workspace.
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, isActive: (p) => p === '/dashboard', role: 'technician' },
  { to: '/work-orders', label: 'My work orders', icon: ClipboardList, isActive: isWorkOrders, role: 'technician' },
  { to: '/work-orders/new', label: 'New work order', icon: Plus, isActive: (p) => p === '/work-orders/new', role: 'technician' },
  { to: '/review', label: 'Review queue', icon: Inbox, isActive: (p) => p === '/review', role: 'reviewer' },
  { to: '/work-orders', label: 'All work orders', icon: ClipboardList, isActive: isWorkOrders, role: 'reviewer' },
  { to: '/audit', label: 'Audit log', icon: History, isActive: (p) => p === '/audit', role: 'reviewer' },
  { to: '/', label: 'About EvidenceLoop', icon: Sparkles, isActive: (p) => p === '/' },
];

export function AppLayout() {
  const { viewer } = useViewer();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col lg:pl-sidebar">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-line bg-surface/85 backdrop-blur lg:flex">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 py-2.5 backdrop-blur lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="nav-drawer"
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        <span className="flex items-center gap-2">
          <Logo compact />
          <ReviewerBadge />
        </span>
        <ThemeToggle />
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <SidebarContent onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
      </Drawer>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
        <PageTransition>
          {/* Remount pages when the acting user changes, so everything is re-fetched for that role. */}
          <Outlet key={viewer?.id ?? 'signed-out'} />
        </PageTransition>
      </main>

      <Footer className="px-4 sm:px-6 lg:px-8" />
    </div>
  );
}

export function PublicLayout() {
  const { system, error } = useSystem();
  const { viewer } = useViewer();

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6">
      <SkipLink />
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <Logo />
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Main">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 font-semibold ${isActive ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg'}`
            }
          >
            Dashboard
          </NavLink>
          <AiPill system={system} error={error} />
          <RoleControl />
          <ThemeToggle />
          {viewer && <SignOut />}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 pb-12 outline-none">
        <PageTransition>
          <Outlet key={viewer?.id ?? 'signed-out'} />
        </PageTransition>
      </main>
      <Footer legalLinks />
    </div>
  );
}

function SidebarContent({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { pathname } = useLocation();
  const { system, error } = useSystem();
  const { viewer } = useViewer();
  const role = viewer?.role ?? 'technician';
  const items = NAV.filter((item) => !item.role || item.role === role);

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <Logo onClick={onNavigate} />
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation">
            <X className="size-5" aria-hidden />
          </Button>
        )}
      </div>

      <ReviewerBadge className="self-start" />

      <nav aria-label="Main">
        <ul className="space-y-1">
          {items.map(({ to, label, icon: Icon, isActive }) => {
            const active = isActive(pathname);
            return (
              <li key={label}>
                <Link
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-accent/12 text-fg shadow-[inset_3px_0_0_var(--color-accent)]'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  <Icon className={`size-4.5 ${active ? 'text-accent-fg' : 'text-fg-faint'}`} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto space-y-4">
        <div className="space-y-1.5">
          <p className="eyebrow">System</p>
          <SystemChips system={system} error={error} />
        </div>
        <SignedInUser />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <RoleControl />
          <span className="flex items-center gap-1">
            <ThemeToggle />
            {viewer && <SignOut compact />}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Mobile navigation: a native modal dialog, so focus is trapped and Esc closes it. */
function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id="nav-drawer"
      aria-label="Navigation"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-line bg-surface p-0 text-fg-muted backdrop:bg-black/60 lg:hidden"
    >
      {open && children}
    </dialog>
  );
}

function Logo({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex items-center gap-2.5 rounded-control">
      <img src="/favicon.svg" alt="" width={compact ? 26 : 30} height={compact ? 26 : 30} />
      <span>
        <span className="block leading-tight font-bold tracking-tight text-fg">EvidenceLoop</span>
        {!compact && <span className="block text-xs text-fg-subtle">Prove the work.</span>}
      </span>
    </Link>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === 'light' ? <Moon className="size-4.5" aria-hidden /> : <Sun className="size-4.5" aria-hidden />}
    </Button>
  );
}

/** The reviewer (admin) console is marked everywhere, in the review colour. Nothing for technicians. */
export function ReviewerBadge({ className = '' }: { className?: string }) {
  const { viewer } = useViewer();
  if (viewer?.role !== 'reviewer') return null;
  return (
    <Badge tone="review" className={className} title="Reviewer (admin): you check the work, you do not do it">
      <ShieldCheck className="size-3.5" aria-hidden /> Reviewer
    </Badge>
  );
}

/**
 * Local mode only: "Demo mode" switches between the demo technician and reviewer. With
 * Supabase the role is read from public.user_roles and only shown, never switchable.
 */
function RoleControl() {
  const { viewer, switchDemoRole } = useViewer();
  if (!viewer) return null;
  if (viewer.roleSource === 'demo') {
    return (
      <label
        className="inline-flex items-center gap-1.5 text-xs text-fg-subtle"
        title="Local development only: act as the demo technician or reviewer"
      >
        <UserRound className="size-3.5" aria-hidden />
        <span className="font-semibold">Demo mode</span>
        <Select className="w-auto py-1 text-xs" value={viewer.role} onChange={(event) => switchDemoRole(event.target.value as Role)}>
          <option value="technician">Technician</option>
          <option value="reviewer">Reviewer</option>
        </Select>
      </label>
    );
  }
  if (viewer.role === 'reviewer') return <ReviewerBadge />;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-subtle capitalize">
      <UserRound className="size-3.5" aria-hidden /> {viewer.role}
    </span>
  );
}

/** The Supabase user: name and avatar from Google when present, otherwise the email address. */
function SignedInUser() {
  const { session } = useAuth();
  const [avatarFailed, setAvatarFailed] = useState(false);
  if (!session) return null;
  const { email, user_metadata: meta = {} } = session.user;
  const name = [meta.full_name, meta.name].find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const avatar = [meta.avatar_url, meta.picture].find((value): value is string => typeof value === 'string' && value.startsWith('https://'));
  const label = name ?? email ?? 'Signed in';
  return (
    <div className="flex items-center gap-2.5 border-t border-line pt-4">
      {avatar && !avatarFailed ? (
        <img
          src={avatar}
          alt=""
          width={32}
          height={32}
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
          className="size-8 shrink-0 rounded-full border border-line"
        />
      ) : (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-bold text-fg">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{label}</span>
        {name && email && <span className="block truncate text-xs text-fg-subtle">{email}</span>}
      </span>
    </div>
  );
}

/** Clears the Supabase session and returns to the landing page. */
function SignOut({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  if (!auth.session) return null;
  return (
    <Button
      variant="ghost"
      size={compact ? 'icon' : 'sm'}
      onClick={() => {
        // Leave the protected page first, so it does not bounce to sign-in on the way out.
        void navigate('/', { replace: true });
        void auth.signOut();
      }}
      title={auth.session.user.email}
      aria-label="Sign out"
    >
      <LogOut className="size-4" aria-hidden /> {!compact && 'Sign out'}
    </Button>
  );
}

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-control bg-accent px-3 py-2 text-sm font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  );
}

/** A short fade-and-rise on navigation. MotionConfig (App) drops the movement under reduced motion. */
function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

function Footer({ className = '', legalLinks = false }: { className?: string; legalLinks?: boolean }) {
  return (
    <footer className={`border-t border-line py-5 text-xs text-fg-faint ${className}`}>
      <p>{DISCLAIMER}</p>
      {legalLinks && (
        <nav aria-label="Legal" className="mt-2 flex gap-4">
          <Link to="/privacy" className="hover:text-fg">Privacy</Link>
          <Link to="/terms" className="hover:text-fg">Terms</Link>
        </nav>
      )}
    </footer>
  );
}
