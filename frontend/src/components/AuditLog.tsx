import { History, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useLiveRefresh } from '../hooks';
import type { AuditLogEntry, WorkOrderSummary } from '../types';
import { CATEGORY_LABEL, EVENT, FALLBACK, type Category } from './AuditTrail';
import { formatDate, formatRelative } from './labels';
import { Card, EmptyState, ErrorState, Input, Loading, PageHeader, Select, Skeleton } from './ui';

const LIVE_TABLES = ['audit_events'] as const;
const LIMIT = 200;

type ActorFilter = 'all' | AuditLogEntry['actorRole'];
const ACTOR_LABEL: Record<ActorFilter, string> = {
  all: 'Everyone',
  agent: 'Agent',
  technician: 'Technicians',
  reviewer: 'Reviewers',
  system: 'System',
};

/** Reviewers: the latest events across every work order, filterable. */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState('');
  const [category, setCategory] = useState<'all' | Category>('all');
  const [actor, setActor] = useState<ActorFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    api.auditLog({ workOrderId: workOrderId || undefined, limit: LIMIT }).then(
      (next) => {
        setEntries(next);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, [workOrderId]);
  useEffect(load, [load]);
  useLiveRefresh(load, 'audit-log', LIVE_TABLES);
  useEffect(() => {
    api.listWorkOrders().then(setWorkOrders, () => setWorkOrders([]));
  }, []);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries ?? []).filter(
      (entry) =>
        (category === 'all' || (EVENT[entry.type] ?? FALLBACK).category === category) &&
        (actor === 'all' || entry.actorRole === actor) &&
        (!needle || `${entry.summary} ${entry.workOrderTitle} ${entry.actor}`.toLowerCase().includes(needle)),
    );
  }, [entries, category, actor, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span className="text-review-fg">Reviewer console</span>}
        title="Audit log"
        description={`The latest ${LIMIT} events across every work order: uploads, verification runs, evidence requests and review decisions.`}
      />

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-fg-subtle">Search</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
            <Input className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Summary, work order, person" />
          </span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-fg-subtle">Work order</span>
          <Select value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)}>
            <option value="">All work orders</option>
            {workOrders.map((workOrder) => (
              <option key={workOrder.id} value={workOrder.id}>
                {workOrder.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-fg-subtle">Event type</span>
          <Select value={category} onChange={(event) => setCategory(event.target.value as 'all' | Category)}>
            <option value="all">All events</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-fg-subtle">By</span>
          <Select value={actor} onChange={(event) => setActor(event.target.value as ActorFilter)}>
            {(Object.keys(ACTOR_LABEL) as ActorFilter[]).map((value) => (
              <option key={value} value={value}>
                {ACTOR_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
      </Card>

      {error && <ErrorState message={`Could not load the audit log: ${error}`} onRetry={load} />}
      {!entries && !error && (
        <Loading label="Loading the audit log…">
          <Card className="space-y-3">
            {[0, 1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-4 w-full" />
            ))}
          </Card>
        </Loading>
      )}
      {entries && shown.length === 0 && (
        <EmptyState icon={History} title="No matching events">
          Change the filters, or wait for activity: every upload, run and decision is recorded here.
        </EmptyState>
      )}
      {shown.length > 0 && (
        <Card as="section" padding="none" aria-label="Events">
          <p className="border-b border-line px-5 py-3 text-xs text-fg-subtle tabular-nums">
            {shown.length} of {entries?.length ?? 0} events
          </p>
          <ol className="divide-y divide-line">
            {shown.map((entry) => {
              const { icon: Icon, tone } = EVENT[entry.type] ?? FALLBACK;
              return (
                <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-5 py-3">
                  <Icon className={`mt-0.5 size-4 ${tone}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{entry.summary}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      <time dateTime={entry.createdAt} title={formatDate(entry.createdAt)}>
                        {formatRelative(entry.createdAt)}
                      </time>{' '}
                      · {entry.actor}
                      {(entry.actorRole === 'technician' || entry.actorRole === 'reviewer') && (
                        <span className="capitalize"> ({entry.actorRole})</span>
                      )}{' '}
                      ·{' '}
                      <Link to={`/work-orders/${entry.workOrderId}`} className="font-semibold text-accent-fg hover:underline">
                        {entry.workOrderTitle}
                      </Link>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}
