import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Page title row: optional back link and eyebrow, title, description, actions on the right. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="space-y-3">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="text-title font-semibold text-fg">{title}</h1>
          {description && <div className="mt-1 max-w-2xl text-sm text-fg-subtle">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
