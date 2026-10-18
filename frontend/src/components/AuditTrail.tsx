import { Bot, Server, User } from 'lucide-react';
import type { AuditEvent } from '../types';
import { formatTime } from './labels';

const TONE: Record<string, string> = {
  ANALYSIS_FAILED: 'bg-contradicted',
  ANALYSIS_SKIPPED: 'bg-uncertain',
  EVIDENCE_REQUESTED: 'bg-uncertain',
  EVIDENCE_UPLOADED: 'bg-analyzing',
  REVIEW_REQUESTED: 'bg-review',
  REVIEW_APPROVED: 'bg-review',
  REVIEW_REJECTED: 'bg-contradicted',
  REVIEW_EVIDENCE_REQUESTED: 'bg-uncertain',
};

// A completed run is only green when it actually ended in VERIFIED.
function tone(event: AuditEvent): string {
  if (event.type === 'ANALYSIS_COMPLETED') {
    const status = event.data.status;
    return status === 'VERIFIED' ? 'bg-proven' : status === 'CONTRADICTED' ? 'bg-contradicted' : 'bg-uncertain';
  }
  return TONE[event.type] ?? 'bg-not-proven';
}

/** Append-only record of everything that happened to this work order, newest first. */
export function AuditTrail({ events }: { events: AuditEvent[] }) {
  return (
    <section aria-labelledby="audit-heading" className="card p-4">
      <h2 id="audit-heading" className="eyebrow">
        Audit trail ({events.length})
      </h2>
      <ol className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
        {[...events].reverse().map((event) => {
          const Icon = event.actor === 'agent' ? Bot : event.actor === 'system' ? Server : User;
          const role = event.data.actorRole;
          const actor = event.actor.startsWith('user:')
            ? role === 'reviewer'
              ? 'Reviewer'
              : role === 'technician'
                ? 'Technician'
                : 'User'
            : event.actor === 'agent'
              ? 'Agent'
              : 'System';
          return (
            <li key={event.id} className="flex gap-3 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone(event)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="break-words text-fg">{event.summary}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-faint">
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3" aria-hidden /> {actor}
                  </span>
                  <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
                  <span className="font-mono">{event.type}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
