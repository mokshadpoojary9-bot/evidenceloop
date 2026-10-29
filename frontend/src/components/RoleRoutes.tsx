import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useViewer } from '../viewer';

// Small and loaded with the shell: they decide where to go before any page code is fetched.

/** Reviewer pages only. The backend refuses technicians too; this keeps them out of a dead end. */
export function ReviewerOnly({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  if (!viewer) return <p role="status" className="p-10 text-center text-fg-subtle">Loading…</p>;
  if (viewer.role !== 'reviewer') return <Navigate to="/dashboard" replace />;
  return children;
}

/** After sign-in without a return address: technicians to their dashboard, reviewers to the queue. */
export function RoleHome() {
  const { viewer } = useViewer();
  if (!viewer) return <p role="status" className="p-10 text-center text-fg-subtle">Loading…</p>;
  return <Navigate to={viewer.role === 'reviewer' ? '/review' : '/dashboard'} replace />;
}
