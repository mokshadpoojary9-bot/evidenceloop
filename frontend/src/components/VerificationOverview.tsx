import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildGraph, summarize } from '../lib/verificationGraph';
import type { RequirementStatus, WorkOrderDetail } from '../types';
import { REQUIREMENT_STATUS } from './labels';
import { LoopVisual } from './LoopVisual';

const OPEN_KEY = 'evidenceloop.graphOpen';
const LEGEND: RequirementStatus[] = ['PROVEN', 'NOT_PROVEN', 'UNCERTAIN', 'CONTRADICTED', 'ANALYZING'];

function storedOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface Props {
  detail: WorkOrderDetail;
  coreHex: string;
  onSelectRequirement: (id: string) => void;
  onOpenEvidence: (id: string) => void;
}

/**
 * The top of a work order: a one-line summary of the verification state next to a live
 * graph of it (3D, or 2D where 3D can't run). Collapsible; the choice is remembered.
 */
export function VerificationOverview({ detail, coreHex, onSelectRequirement, onOpenEvidence }: Props) {
  const graph = useMemo(() => buildGraph(detail), [detail]);
  const [open, setOpen] = useState(storedOpen);
  const summary = summarize(graph.requirements.map((r) => r.status));
  const openRequests = detail.requests.filter((r) => r.status === 'OPEN').length;

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, String(!open));
    } catch {
      // storage unavailable: the choice applies to this page only
    }
  };

  return (
    <section aria-labelledby="overview-heading" className="card overflow-hidden">
      <div className={open ? 'grid lg:grid-cols-[17rem_minmax(0,1fr)]' : ''}>
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="overview-heading" className="eyebrow">
              Verification state
            </h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
              aria-expanded={open}
              aria-controls="verification-graph"
              onClick={toggle}
            >
              {open ? 'Hide graph' : 'Show graph'}
              <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          </div>
          <p className="text-lg leading-snug font-semibold text-white" aria-live="polite">
            {summary}
          </p>
          <p className="text-xs text-slate-400">
            {detail.evidence.length} evidence {detail.evidence.length === 1 ? 'file' : 'files'} · {openRequests} open{' '}
            {openRequests === 1 ? 'request' : 'requests'}
          </p>

          {open && (
            <>
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-300" aria-label="Legend">
                {LEGEND.map((status) => (
                  <li key={status} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: REQUIREMENT_STATUS[status].hex }} aria-hidden />
                    {REQUIREMENT_STATUS[status].label}
                    {status === 'ANALYZING' && ' (pulsing)'}
                  </li>
                ))}
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-slate-200" aria-hidden /> Direct observation
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-slate-200/35" aria-hidden /> Inferred
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="size-2 rotate-45 bg-[#f5a524]" aria-hidden /> Evidence requested
                </li>
              </ul>
              <p className="text-xs text-slate-500">
                Outer ring: requirements. Inner ring: evidence files. Hover for details; select a requirement to find
                it in the checklist, or a file to open it. Drag sideways to turn.
              </p>
            </>
          )}
        </div>

        {open && (
          <div id="verification-graph" className="border-t border-line lg:border-t-0 lg:border-l">
            <LoopVisual
              variant="graph"
              className="relative h-[340px] sm:h-[380px]"
              graph={graph}
              coreHex={coreHex}
              onSelectRequirement={onSelectRequirement}
              onOpenEvidence={onOpenEvidence}
            />
          </div>
        )}
      </div>
    </section>
  );
}
