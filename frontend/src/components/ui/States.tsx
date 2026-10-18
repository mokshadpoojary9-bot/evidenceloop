import { RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/** A placeholder block that shimmers while content loads (still under reduced motion). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/** Screen-reader announcement for a region that is loading. */
export function Loading({ label = 'Loading…', children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}>
      <span className="flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2">
        <Icon className="size-6 text-fg-faint" aria-hidden />
      </span>
      <p className="text-heading font-semibold text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-fg-subtle">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Something failed to load: say what, and offer to try again. */
export function ErrorState({ message, onRetry, className = '' }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-3 rounded-card border border-contradicted/40 bg-contradicted/10 px-4 py-3 text-sm text-contradicted-fg ${className}`}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}
