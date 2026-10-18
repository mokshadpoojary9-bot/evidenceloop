import { motion } from 'framer-motion';
import { MessageSquareWarning, Upload } from 'lucide-react';
import { EVIDENCE_KIND_LABELS, type EvidenceRequest, type Requirement } from '../types';
import { EVIDENCE_ICON } from './labels';
import { Button } from './ui';

interface Props {
  requests: EvidenceRequest[];
  requirements: Requirement[];
  /** Null when the viewer may not upload (e.g. a reviewer). */
  onRespond: ((request: EvidenceRequest) => void) | null;
}

/** The agent's open requests: the minimum additional evidence needed to settle what is unproven. */
export function EvidenceRequests({ requests, requirements, onRespond }: Props) {
  const open = requests.filter((request) => request.status === 'OPEN');
  if (open.length === 0) return null;
  const positionById = new Map(requirements.map((r) => [r.id, r.position]));

  return (
    <section aria-labelledby="requests-heading" className="rounded-2xl border border-uncertain/40 bg-uncertain/[0.07] p-4">
      <h2 id="requests-heading" className="flex items-center gap-2 font-semibold text-uncertain-fg">
        <MessageSquareWarning className="size-5" aria-hidden />
        Additional evidence needed ({open.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {open.map((request) => {
          const Icon = EVIDENCE_ICON[request.kind];
          const positions = request.requirementIds
            .map((id) => positionById.get(id))
            .filter((position) => position !== undefined)
            .sort((a, b) => a - b);
          return (
            <motion.li
              key={request.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3"
            >
              <Icon className="size-5 shrink-0 text-uncertain-fg" aria-hidden />
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium text-fg">{request.instruction}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {request.requestedBy === 'agent' ? 'Requested by the agent' : 'Requested by a reviewer'} ·{' '}
                  {EVIDENCE_KIND_LABELS[request.kind]} · would address requirement{positions.length === 1 ? '' : 's'}{' '}
                  {positions.join(', ')}
                </p>
              </div>
              {onRespond && (
                <Button variant="primary" onClick={() => onRespond(request)}>
                  <Upload className="size-4" aria-hidden /> Upload
                </Button>
              )}
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
