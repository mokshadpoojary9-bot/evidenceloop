import { motion } from 'framer-motion';
import { Archive, ClipboardList, MapPin, Plus, Search, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useLiveRefresh, useSystem } from '../hooks';
import { DEFAULT_QUERY, queryWorkOrders, type SortOrder, type StatusFilter } from '../lib/workOrderQuery';
import { WORK_ORDER_STATUSES, type WorkOrderSummary } from '../types';
import { REQUIREMENT_STATUS, WORK_ORDER_STATUS, formatDate } from './labels';
import { StatusBadge } from './StatusBadge';
import { AiBanner } from './SystemStatus';
import { useViewer } from '../viewer';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Select, Skeleton } from './ui';

const LIVE_TABLES = ['work_orders', 'evidence_requests'] as const;
const STATUS_FILTERS: readonly string[] = ['active', 'archived', 'all', ...WORK_ORDER_STATUSES];

/** The status filter lives in the URL (?status=…), so the dashboard's cards can link to it. */
function statusFromUrl(value: string | null): StatusFilter {
  return value && STATUS_FILTERS.includes(value) ? (value as StatusFilter) : DEFAULT_QUERY.status;
}

export function WorkOrderList() {
  const { system } = useSystem();
  const { viewer } = useViewer();
  const isReviewer = viewer?.role === 'reviewer';
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>(DEFAULT_QUERY.sort);
  const status = statusFromUrl(params.get('status'));
  const query = useMemo(() => ({ search, sort, status }), [search, sort, status]);
  const setStatus = (next: StatusFilter) =>
    setParams(next === DEFAULT_QUERY.status ? {} : { status: next }, { replace: true });
  const shown = useMemo(() => (workOrders ? queryWorkOrders(workOrders, query) : null), [workOrders, query]);
  const filtered = query.search !== '' || query.status !== 'active';

  const load = useCallback(() => {
    api.listWorkOrders().then(
      (list) => {
        setWorkOrders(list);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);
  useEffect(load, [load]);
  // Realtime with Supabase; in local mode, polling every 5 s while the tab is visible.
  useLiveRefresh(load, 'work-order-list', LIVE_TABLES);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Work orders"
        description={
          isReviewer
            ? 'As a reviewer you see every work order. Filter by “In review” to find the ones waiting for you.'
            : 'Every work order you created, with how much of each checklist the evidence proves.'
        }
        actions={
          !isReviewer && (
            <ButtonLink to="/work-orders/new" variant="primary">
              <Plus className="size-4" aria-hidden /> New work order
            </ButtonLink>
          )
        }
      />

      <AiBanner system={system} />

      {error && (
        <ErrorState
          message={workOrders ? `Showing the last loaded list. ${error}` : `Could not load work orders: ${error}`}
          onRetry={load}
        />
      )}

      {workOrders !== null && workOrders.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3 p-3" role="search">
          <label className="relative min-w-48 flex-1 text-sm">
            <span className="sr-only">Search work orders</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
            <Input
              className="pl-9"
              type="search"
              placeholder="Search title, location or description"
              value={query.search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-fg-subtle">Status</span>
            <Select
              value={query.status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="active">All active</option>
              {WORK_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {WORK_ORDER_STATUS[status].label}
                </option>
              ))}
              <option value="archived">Archived</option>
              <option value="all">Everything, including archived</option>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-fg-subtle">Sort</span>
            <Select
              value={query.sort}
              onChange={(event) => setSort(event.target.value as SortOrder)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="updated">Recently updated</option>
            </Select>
          </label>
          {filtered && (
            <Button
              onClick={() => {
                setSearch('');
                setStatus(DEFAULT_QUERY.status);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {shown?.length === 0 && workOrders!.length > 0 && (
        <EmptyState icon={SearchX} title="No work orders match these filters">
          Try another status or search term, or clear the filters.
        </EmptyState>
      )}

      {workOrders === null && !error && <ListSkeleton />}

      {workOrders?.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No work orders yet"
          action={
            !isReviewer && (
              <ButtonLink to="/work-orders/new" variant="primary">
                <Plus className="size-4" aria-hidden /> Create the demo work order
              </ButtonLink>
            )
          }
        >
          {isReviewer
            ? 'Work orders appear here as technicians create them.'
            : 'Start with the demo scenario — “Replace emergency light in Room 204” — and see which requirements the evidence actually proves.'}
        </EmptyState>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {shown?.map((workOrder, index) => (
          <motion.li
            key={workOrder.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.04, 0.3) }}
          >
            <Link
              to={`/work-orders/${workOrder.id}`}
              className="card block p-4 transition-colors hover:border-line-strong"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-semibold text-fg">{workOrder.title}</h2>
                <span className="flex flex-wrap items-center gap-1.5">
                  {workOrder.archivedAt && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-fg-subtle">
                      <Archive className="size-3" aria-hidden /> Archived
                    </span>
                  )}
                  <StatusBadge
                    meta={WORK_ORDER_STATUS[workOrder.status]}
                    simulated={workOrder.simulated && workOrder.status !== 'AWAITING_EVIDENCE'}
                  />
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-fg-subtle">
                {workOrder.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden /> {workOrder.location}
                  </span>
                )}
                <span>{formatDate(workOrder.createdAt)}</span>
                {workOrder.openRequestCount > 0 && (
                  <span className="text-uncertain-fg">
                    {workOrder.openRequestCount} evidence request{workOrder.openRequestCount === 1 ? '' : 's'} open
                  </span>
                )}
              </p>
              <div
                className="mt-3 flex gap-1.5"
                aria-label={`${workOrder.requirementStatuses.filter((s) => s === 'PROVEN').length} of ${workOrder.requirementStatuses.length} requirements proven`}
              >
                {workOrder.requirementStatuses.map((status, i) => (
                  <span
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{ backgroundColor: REQUIREMENT_STATUS[status].hex }}
                    title={`Requirement ${i + 1}: ${REQUIREMENT_STATUS[status].label}`}
                  />
                ))}
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ListSkeleton() {
  return (
    <Loading label="Loading work orders…">
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((k) => (
          <Card key={k} className="space-y-3">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </Card>
        ))}
      </div>
    </Loading>
  );
}
