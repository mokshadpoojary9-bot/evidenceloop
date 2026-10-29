import { Inbox, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { useLiveRefresh } from '../hooks';
import { QUEUE_REASONS, type QueueReason, type ReviewQueueItem } from '../types';
import { useViewer } from '../viewer';
import { formatDate, formatRelative, REQUIREMENT_STATUS } from './labels';
import { DecisionForm } from './ReviewPanel';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader, Skeleton, type Tone } from './ui';

const LIVE_TABLES = ['work_orders', 'reviews', 'requirements'] as const;

const REASON: Record<QueueReason, { label: string; tone: Tone }> = {
  IN_REVIEW: { label: 'In review', tone: 'review' },
  CONTRADICTED: { label: 'Contradicted', tone: 'contradicted' },
  UNCERTAIN: { label: 'Uncertain', tone: 'uncertain' },
};

type Filter = 'all' | QueueReason;

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

/** The reviewer's queue: everything the evidence could not settle, across all technicians. */
export function ReviewQueue() {
  const [items, setItems] = useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    api.reviewQueue().then(
      (next) => {
        setItems(next);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(load, 'review-queue', LIVE_TABLES);

  const shown = items?.filter((item) => filter === 'all' || item.reason === filter) ?? [];
  const count = (reason: QueueReason) => items?.filter((item) => item.reason === reason).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-review-fg">
            <ShieldCheck className="size-3.5" aria-hidden /> Reviewer console
          </span>
        }
        title="Review queue"
        description="Work orders the evidence could not settle, from every technician. Submitted ones come first. Every decision needs a note and is recorded in the audit trail."
      />

      <div role="group" aria-label="Filter the queue" className="flex flex-wrap gap-2">
        {(['all', ...QUEUE_REASONS] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'primary' : 'secondary'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? 'All' : REASON[value].label}
            <span className="tabular-nums opacity-75">{value === 'all' ? (items?.length ?? 0) : count(value)}</span>
          </Button>
        ))}
      </div>

      {error && <ErrorState message={`Could not load the review queue: ${error}`} onRetry={load} />}
      {!items && !error && (
        <Loading label="Loading the review queue…">
          <div className="space-y-3">
            {[0, 1, 2].map((k) => (
              <Card key={k} className="space-y-3">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-3 w-40" />
              </Card>
            ))}
          </div>
        </Loading>
      )}
      {items && shown.length === 0 && (
        <EmptyState icon={Inbox} title="Nothing to review">
          Work orders that are in review, contradicted or uncertain appear here.
        </EmptyState>
      )}
      {shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((item) => (
            <QueueItem key={item.workOrderId} item={item} onDecided={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueItem({ item, onDecided }: { item: ReviewQueueItem; onDecided: () => void }) {
  const [deciding, setDeciding] = useState(false);
  const proven = item.requirementStatuses.filter((status) => status === 'PROVEN').length;
  const total = item.requirementStatuses.length;
  const { label, tone } = REASON[item.reason];

  return (
    <li className="card space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link to={`/work-orders/${item.workOrderId}`} className="font-semibold text-fg hover:underline">
              {item.title}
            </Link>
            <Badge tone={tone}>{label}</Badge>
            {item.simulated && <Badge tone="dev">Simulated</Badge>}
          </p>
          <p className="text-xs text-fg-subtle">
            {item.location && <>{item.location} · </>}
            Technician <strong className="text-fg">{item.technician}</strong> ·{' '}
            {item.submittedAt ? (
              <>
                submitted{' '}
                <time dateTime={item.submittedAt} title={formatDate(item.submittedAt)}>
                  {formatRelative(item.submittedAt)}
                </time>
              </>
            ) : (
              'not submitted for review yet'
            )}
          </p>
          {item.submissionNote && <p className="text-sm text-fg-muted">Technician’s note: “{item.submissionNote}”</p>}
        </div>
        <div className="w-40 space-y-1 text-right">
          <p className="text-sm text-fg">
            <strong className="tabular-nums">
              {proven} / {total}
            </strong>{' '}
            proven
          </p>
          {total > 0 && (
            <div className="flex h-1.5 gap-0.5" aria-hidden>
              {item.requirementStatuses.map((status, index) => (
                <span key={index} className="flex-1 rounded-full" style={{ backgroundColor: REQUIREMENT_STATUS[status].hex }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {item.canDecide ? (
        deciding ? (
          <DecisionForm workOrderId={item.workOrderId} onDone={onDecided} />
        ) : (
          <Button variant="primary" size="sm" onClick={() => setDeciding(true)}>
            Approve, reject or request more evidence
          </Button>
        )
      ) : (
        <p className="text-xs text-fg-subtle">
          {item.blocker === 'There is no pending review.'
            ? 'You can decide once the technician submits it for review.'
            : item.blocker}{' '}
          <Link to={`/work-orders/${item.workOrderId}`} className="font-semibold text-accent-fg hover:underline">
            Open work order
          </Link>
        </p>
      )}
    </li>
  );
}
