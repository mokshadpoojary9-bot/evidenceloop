import { motion } from 'framer-motion';
import {
  ArrowRight,
  CircleCheckBig,
  ClipboardList,
  FilePen,
  History,
  Inbox,
  LoaderCircle,
  OctagonAlert,
  Plus,
  Send,
  UserSearch,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useLiveRefresh, useSystem } from '../hooks';
import { fetchCached, readCache } from '../lib/cache';
import { CACHE_KEYS } from '../lib/prefetch';
import { DASHBOARD_BUCKETS, EVIDENCE_KIND_LABELS, type DashboardBucket, type DashboardData } from '../types';
import { useViewer } from '../viewer';
import { EVIDENCE_ICON, formatDate, formatRelative } from './labels';
import { AiBanner, SystemChips } from './SystemStatus';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Loading, PageHeader, Skeleton, type Tone, TONE, useToast } from './ui';

const LIVE_TABLES = ['work_orders', 'evidence_requests', 'audit_events'] as const;

const BUCKETS: Record<DashboardBucket, { label: string; hint: string; icon: LucideIcon; tone: Tone }> = {
  VERIFIED: { label: 'Verified', hint: 'Every mandatory requirement proven', icon: CircleCheckBig, tone: 'proven' },
  NEEDS_EVIDENCE: { label: 'Needs evidence', hint: 'Something cannot be verified yet', icon: Upload, tone: 'uncertain' },
  IN_REVIEW: { label: 'In review', hint: 'Waiting for a reviewer', icon: UserSearch, tone: 'review' },
  CONTRADICTED: { label: 'Contradicted', hint: 'Evidence conflicts with a requirement', icon: OctagonAlert, tone: 'contradicted' },
  AWAITING_EVIDENCE: { label: 'Draft', hint: 'Not verified yet', icon: FilePen, tone: 'not-proven' },
};

/** The home page after sign-in: where things stand, what needs action, what just happened. */
export function Dashboard() {
  const { system, error: systemError } = useSystem();
  const { viewer } = useViewer();
  const isReviewer = viewer?.role === 'reviewer';
  // The last data shows at once on a revisit; the request below refreshes it.
  const [data, setData] = useState<DashboardData | null>(() => readCache<DashboardData>(CACHE_KEYS.dashboard) ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchCached(CACHE_KEYS.dashboard, api.dashboard).then(
      (next) => {
        setData(next);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(load, 'dashboard', LIVE_TABLES);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isReviewer ? 'Reviewer' : 'Technician'}
        title="Dashboard"
        description={
          isReviewer
            ? 'Every work order, and the ones waiting for your decision.'
            : 'Your work orders, what the evidence proves so far, and what is still missing.'
        }
        actions={
          <>
            <SystemChips system={system} error={systemError} />
            {!isReviewer && (
              <ButtonLink to="/work-orders/new" variant="primary">
                <Plus className="size-4" aria-hidden /> New work order
              </ButtonLink>
            )}
          </>
        }
      />

      <AiBanner system={system} />

      {error && !data && <ErrorState message={`Could not load the dashboard: ${error}`} onRetry={load} />}
      {!data && !error && <DashboardSkeleton />}

      {data && (
        <>
          {error && <ErrorState message={`Showing the last loaded data. ${error}`} onRetry={load} />}
          <section aria-labelledby="counts-heading">
            <h2 id="counts-heading" className="sr-only">
              Work orders by status
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {DASHBOARD_BUCKETS.map((bucket, index) => (
                <CountCard key={bucket} bucket={bucket} count={data.counts[bucket]} index={index} />
              ))}
            </ul>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <NeedsAction data={data} isReviewer={isReviewer} onChanged={load} />
            <Activity data={data} />
          </div>
        </>
      )}
    </div>
  );
}

function CountCard({ bucket, count, index }: { bucket: DashboardBucket; count: number; index: number }) {
  const { label, hint, icon: Icon, tone } = BUCKETS[bucket];
  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Link
        to={`/work-orders?status=${bucket}`}
        className="card group flex h-full flex-col gap-3 p-4 transition-colors hover:border-line-strong"
        aria-label={`${count} ${label}: show these work orders`}
      >
        <span className={`flex size-9 items-center justify-center rounded-xl border ${TONE[tone]}`}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <span>
          <span className="block text-display font-semibold text-fg tabular-nums">{count}</span>
          <span className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-fg">
            {label}
            <ArrowRight className="size-3.5 text-fg-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>
        </span>
      </Link>
    </motion.li>
  );
}

function NeedsAction({ data, isReviewer, onChanged }: { data: DashboardData; isReviewer: boolean; onChanged: () => void }) {
  const open = data.openRequests.length + data.awaitingReview.length + data.readyForReview.length + data.drafts.length;
  const empty = open === 0;
  return (
    <Card as="section" padding="none" aria-labelledby="action-heading">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="action-heading" className="flex items-center gap-2 text-heading font-semibold text-fg">
          <Inbox className="size-4.5 text-accent-fg" aria-hidden /> Needs your action
        </h2>
        <span className="text-xs text-fg-subtle tabular-nums">
          {open} open
        </span>
      </div>
      {empty ? (
        <p className="px-5 py-10 text-center text-sm text-fg-subtle">
          Nothing is waiting on you. Open evidence requests, drafts and work orders to submit for review appear here.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {data.readyForReview.map((item) => (
            <ReadyForReview key={`ready-${item.workOrderId}`} item={item} onSubmitted={onChanged} />
          ))}
          {data.awaitingReview.map((item) => (
            <li key={`review-${item.workOrderId}`}>
              <Link
                to={`/work-orders/${item.workOrderId}`}
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${TONE.review}`}>
                  <UserSearch className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fg">{item.title}</span>
                  <span className="block text-xs text-fg-subtle">
                    {isReviewer ? 'Waiting for your decision' : 'Waiting for a reviewer'} · submitted{' '}
                    <time dateTime={item.submittedAt} title={formatDate(item.submittedAt)}>
                      {formatRelative(item.submittedAt)}
                    </time>
                  </span>
                </span>
                <span className="self-center text-xs font-semibold text-accent-fg">{isReviewer ? 'Review' : 'View'}</span>
              </Link>
            </li>
          ))}
          {data.openRequests.map((request) => {
            const Icon = EVIDENCE_ICON[request.kind];
            return (
              <li key={request.id}>
                <Link
                  to={`/work-orders/${request.workOrderId}`}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${TONE.uncertain}`}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">{request.instruction}</span>
                    <span className="block text-xs text-fg-subtle">
                      {EVIDENCE_KIND_LABELS[request.kind]} requested for “{request.workOrderTitle}”
                      {request.requirementTitles.length > 0 && <> · {request.requirementTitles.join(', ')}</>}
                    </span>
                  </span>
                  <span className="self-center text-xs font-semibold whitespace-nowrap text-accent-fg">
                    {isReviewer ? 'View' : 'Upload'}
                  </span>
                </Link>
              </li>
            );
          })}
          {data.drafts.map((draft) => (
            <li key={`draft-${draft.workOrderId}`}>
              <Link
                to={`/work-orders/${draft.workOrderId}`}
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${TONE['not-proven']}`}>
                  <FilePen className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fg">{draft.title}</span>
                  <span className="block text-xs text-fg-subtle">
                    Draft · not verified yet{draft.location && <> · {draft.location}</>} · changed{' '}
                    <time dateTime={draft.updatedAt} title={formatDate(draft.updatedAt)}>
                      {formatRelative(draft.updatedAt)}
                    </time>
                  </span>
                </span>
                <span className="self-center text-xs font-semibold text-accent-fg">Add evidence</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Contradicted or uncertain: the evidence cannot settle it, so the technician can hand it to a reviewer. */
function ReadyForReview({ item, onSubmitted }: { item: DashboardData['readyForReview'][number]; onSubmitted: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      await api.submitForReview(item.workOrderId, '');
      toast.success('Submitted for review');
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit for review');
      setBusy(false);
    }
  };
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${TONE[item.status === 'CONTRADICTED' ? 'contradicted' : 'uncertain']}`}>
        <OctagonAlert className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <Link to={`/work-orders/${item.workOrderId}`} className="block font-semibold text-fg hover:underline">
          {item.title}
        </Link>
        <span className="block text-xs text-fg-subtle">
          {item.status === 'CONTRADICTED' ? 'Contradicted' : 'Uncertain'}: the evidence cannot settle it. A reviewer can decide.
        </span>
      </span>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        Submit for review
      </Button>
    </li>
  );
}

function Activity({ data }: { data: DashboardData }) {
  return (
    <Card as="section" padding="none" aria-labelledby="activity-heading">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="activity-heading" className="flex items-center gap-2 text-heading font-semibold text-fg">
          <History className="size-4.5 text-accent-fg" aria-hidden /> Recent activity
        </h2>
        <span className="text-xs text-fg-subtle">Last {data.activity.length}</span>
      </div>
      {data.activity.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No activity yet" className="m-4 border-dashed shadow-none">
          Creating a work order, uploading evidence and every verification decision are recorded here.
        </EmptyState>
      ) : (
        <ol className="space-y-0.5 p-2">
          {data.activity.map((event) => (
            <li key={event.id}>
              <Link
                to={`/work-orders/${event.workOrderId}`}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span className="mt-1.5 size-2 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm text-fg">{event.summary}</span>
                  <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                    <time dateTime={event.createdAt} title={formatDate(event.createdAt)}>
                      {formatRelative(event.createdAt)}
                    </time>{' '}
                    · {event.actor} · {event.workOrderTitle}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <Loading label="Loading the dashboard…">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {DASHBOARD_BUCKETS.map((bucket) => (
            <Card key={bucket} className="space-y-3">
              <Skeleton className="size-9 rounded-xl" />
              <Skeleton className="h-8 w-12" />
              <Skeleton className="h-3 w-24" />
            </Card>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((k) => (
            <Card key={k} className="space-y-3">
              <Skeleton className="h-5 w-40" />
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </Card>
          ))}
        </div>
      </div>
    </Loading>
  );
}
