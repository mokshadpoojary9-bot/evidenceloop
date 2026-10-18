import {
  Archive,
  Bot,
  CircleCheck,
  CircleX,
  FilePlus2,
  FileUp,
  Gavel,
  ListChecks,
  MessageSquareWarning,
  Pencil,
  Play,
  Server,
  SkipForward,
  User,
  UserCheck,
  UserSearch,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AnalysisRun, AuditEvent } from '../types';
import { formatDate, formatTime } from './labels';
import { SimulatedTag } from './StatusBadge';
import { Badge } from './ui';

type Category = 'evidence' | 'analysis' | 'requests' | 'review' | 'changes';

const CATEGORY_LABEL: Record<Category, string> = {
  evidence: 'Evidence',
  analysis: 'Analysis',
  requests: 'Requests',
  review: 'Review',
  changes: 'Changes',
};

const EVENT: Record<string, { icon: LucideIcon; category: Category; tone: string }> = {
  EVIDENCE_UPLOADED: { icon: FileUp, category: 'evidence', tone: 'text-analyzing-fg' },
  EVIDENCE_REQUEST_FULFILLED: { icon: CircleCheck, category: 'requests', tone: 'text-analyzing-fg' },
  EVIDENCE_REQUEST_SUPERSEDED: { icon: SkipForward, category: 'requests', tone: 'text-fg-subtle' },
  EVIDENCE_REQUESTED: { icon: MessageSquareWarning, category: 'requests', tone: 'text-uncertain-fg' },
  ANALYSIS_STARTED: { icon: Play, category: 'analysis', tone: 'text-analyzing-fg' },
  ANALYSIS_COMPLETED: { icon: CircleCheck, category: 'analysis', tone: 'text-fg-muted' },
  ANALYSIS_FAILED: { icon: CircleX, category: 'analysis', tone: 'text-contradicted-fg' },
  ANALYSIS_SKIPPED: { icon: SkipForward, category: 'analysis', tone: 'text-uncertain-fg' },
  REQUIREMENT_ASSESSED: { icon: Gavel, category: 'analysis', tone: 'text-fg-muted' },
  STATUS_CHANGED: { icon: ListChecks, category: 'analysis', tone: 'text-fg-muted' },
  REVIEW_REQUESTED: { icon: UserSearch, category: 'review', tone: 'text-review-fg' },
  REVIEW_APPROVED: { icon: UserCheck, category: 'review', tone: 'text-review-fg' },
  REVIEW_REJECTED: { icon: UserX, category: 'review', tone: 'text-contradicted-fg' },
  REVIEW_EVIDENCE_REQUESTED: { icon: MessageSquareWarning, category: 'review', tone: 'text-uncertain-fg' },
  WORK_ORDER_CREATED: { icon: FilePlus2, category: 'changes', tone: 'text-fg-muted' },
  CHECKLIST_BUILT: { icon: ListChecks, category: 'changes', tone: 'text-fg-muted' },
  REQUIREMENTS_ADDED: { icon: ListChecks, category: 'changes', tone: 'text-fg-muted' },
  WORK_ORDER_EDITED: { icon: Pencil, category: 'changes', tone: 'text-fg-muted' },
  WORK_ORDER_ARCHIVED: { icon: Archive, category: 'changes', tone: 'text-fg-muted' },
  WORK_ORDER_UNARCHIVED: { icon: Archive, category: 'changes', tone: 'text-fg-muted' },
};
const FALLBACK = { icon: Server, category: 'changes' as Category, tone: 'text-fg-muted' };
const describeEvent = (event: AuditEvent) => {
  const known = EVENT[event.type] ?? FALLBACK;
  // A completed run is only green when it actually ended in VERIFIED.
  if (event.type === 'ANALYSIS_COMPLETED') {
    const status = event.data.status;
    const tone = status === 'VERIFIED' ? 'text-proven-fg' : status === 'CONTRADICTED' ? 'text-contradicted-fg' : 'text-uncertain-fg';
    return { ...known, tone };
  }
  return known;
};

function actorLabel(event: AuditEvent): { label: string; icon: LucideIcon } {
  if (event.actor === 'agent') return { label: 'Agent', icon: Bot };
  if (event.actor === 'system') return { label: 'System', icon: Server };
  const role = event.data.actorRole;
  return { label: role === 'reviewer' ? 'Reviewer' : role === 'technician' ? 'Technician' : 'User', icon: User };
}

type Block = { kind: 'event'; event: AuditEvent } | { kind: 'run'; run: AnalysisRun | undefined; runId: string; number: number; events: AuditEvent[] };

/** Newest first; a verification run's events are kept together under that run. */
export function groupAudit(events: AuditEvent[], runs: AnalysisRun[]): Block[] {
  const runNumber = new Map(runs.map((run, index) => [run.id, index + 1]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const blocks: Block[] = [];
  const groups = new Map<string, Extract<Block, { kind: 'run' }>>();
  for (const event of [...events].reverse()) {
    if (!event.runId) {
      blocks.push({ kind: 'event', event });
      continue;
    }
    let group = groups.get(event.runId);
    if (!group) {
      group = { kind: 'run', runId: event.runId, run: runById.get(event.runId), number: runNumber.get(event.runId) ?? 0, events: [] };
      groups.set(event.runId, group);
      blocks.push(group);
    }
    group.events.push(event);
  }
  return blocks;
}

/** Append-only record of everything that happened to this work order. */
export function AuditTrail({ events, runs }: { events: AuditEvent[]; runs: AnalysisRun[] }) {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const counts = useMemo(() => {
    const result: Partial<Record<Category, number>> = {};
    for (const event of events) {
      const { category } = describeEvent(event);
      result[category] = (result[category] ?? 0) + 1;
    }
    return result;
  }, [events]);
  const visible = filter === 'all' ? events : events.filter((event) => describeEvent(event).category === filter);
  const blocks = groupAudit(visible, runs);

  return (
    <section aria-labelledby="audit-heading" className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="audit-heading" className="eyebrow">
          Audit trail ({events.length})
        </h2>
        <div role="group" aria-label="Filter the audit trail by event type" className="flex flex-wrap gap-1">
          {(['all', ...(Object.keys(CATEGORY_LABEL) as Category[])] as const).map((value) => {
            const count = value === 'all' ? events.length : (counts[value] ?? 0);
            if (value !== 'all' && count === 0) return null;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  filter === value ? 'border-accent bg-accent/15 text-accent-fg' : 'border-line text-fg-subtle hover:text-fg'
                }`}
              >
                {value === 'all' ? 'All' : CATEGORY_LABEL[value]} <span className="font-normal opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="mt-3 text-sm text-fg-subtle">No events of this type.</p>
      ) : (
        <ol className="relative mt-4 max-h-[36rem] space-y-3 overflow-y-auto pr-1">
          {blocks.map((block) =>
            block.kind === 'event' ? (
              <EventRow key={block.event.id} event={block.event} />
            ) : (
              <li key={block.runId} className="rounded-xl border border-line bg-surface-2/60 p-3">
                <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-fg">Verification run {block.number || ''}</span>
                  {block.run && (
                    <>
                      <Badge tone={block.run.status === 'FAILED' ? 'contradicted' : block.run.status === 'RUNNING' ? 'analyzing' : 'neutral'}>
                        {block.run.status === 'RUNNING' ? 'Running' : block.run.status === 'FAILED' ? 'Failed' : 'Completed'}
                      </Badge>
                      <span className="text-fg-faint">
                        {block.run.trigger === 'manual' ? 'started by hand' : 'after new evidence'} ·{' '}
                        {block.run.requirementIds.length} requirement{block.run.requirementIds.length === 1 ? '' : 's'} ·{' '}
                        {formatDate(block.run.startedAt)}
                      </span>
                      {block.run.simulated && <SimulatedTag />}
                    </>
                  )}
                </p>
                <ol className="space-y-2.5 border-l border-line pl-3">
                  {block.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ol>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const { icon: Icon, tone } = describeEvent(event);
  const actor = actorLabel(event);
  return (
    <li className="flex gap-2.5 text-sm">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
        <Icon className={`size-3.5 ${tone}`} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-fg">{event.summary}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-faint">
          <span className="inline-flex items-center gap-1">
            <actor.icon className="size-3" aria-hidden /> {actor.label}
          </span>
          <time dateTime={event.createdAt} title={formatDate(event.createdAt)}>
            {formatTime(event.createdAt)}
          </time>
          <span className="font-mono break-all">{event.type}</span>
        </p>
      </div>
    </li>
  );
}
