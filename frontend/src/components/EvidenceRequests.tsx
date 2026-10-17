import { motion } from 'framer-motion';
import { MessageSquareWarning, Upload } from 'lucide-react';
import { EVIDENCE_KIND_LABELS, type EvidenceRequest, type Requirement } from '../types';
import { EVIDENCE_ICON } from './labels';

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
    <section aria-labelledby="requests-heading" className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-4">
      <h2 id="requests-heading" className="flex items-center gap-2 font-semibold text-amber-200">
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
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-900 p-3"
            >
              <Icon className="size-5 shrink-0 text-amber-300" aria-hidden />
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium text-white">{request.instruction}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {request.requestedBy === 'agent' ? 'Requested by the agent' : 'Requested by a reviewer'} ·{' '}
                  {EVIDENCE_KIND_LABELS[request.kind]} · would address requirement{positions.length === 1 ? '' : 's'}{' '}
                  {positions.join(', ')}
                </p>
              </div>
              {onRespond && (
                <button className="btn btn-primary" onClick={() => onRespond(request)}>
                  <Upload className="size-4" aria-hidden /> Upload
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
