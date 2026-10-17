import { AnimatePresence, motion } from 'framer-motion';
import { Brain, ChevronDown, Eye, Gavel, Paperclip, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CANNOT_VERIFY, EVIDENCE_KIND_LABELS, type Evidence, type WorkOrderDetail } from '../types';
import { REQUIREMENT_STATUS, formatSeconds } from './labels';
import { StatusBadge } from './StatusBadge';
import type { ViewTarget } from './EvidenceViewer';

type RequirementWithAssessment = WorkOrderDetail['requirements'][number];

interface Props {
  requirement: RequirementWithAssessment;
  evidence: Evidence[];
  onOpenEvidence: (target: ViewTarget) => void;
}

/** One checklist item, expandable into Requirement → Evidence → Observation → Reasoning → Decision. */
export function RequirementCard({ requirement, evidence, onOpenEvidence }: Props) {
  const [open, setOpen] = useState(false);
  const { assessment } = requirement;
  const meta = REQUIREMENT_STATUS[requirement.status];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const cited = assessment ? [...new Set(assessment.observations.map((o) => o.evidenceId))] : [];

  return (
    <motion.li layout="position" className="card overflow-hidden">
      <button
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink-950"
          style={{ backgroundColor: meta.hex }}
        >
          {requirement.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-white">{requirement.title}</span>
            {!requirement.mandatory && (
              <span className="rounded border border-line px-1.5 text-[10px] font-semibold text-slate-400 uppercase">
                Optional
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-slate-400">{requirement.description}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={requirement.status}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.18 }}
            >
              <StatusBadge meta={meta} />
            </motion.span>
          </AnimatePresence>
          <ChevronDown className={`size-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
              {!assessment ? (
                <p className="text-slate-400">
                  {CANNOT_VERIFY} No verification run has assessed this requirement yet.
                </p>
              ) : (
                <>
                  {assessment.simulated && (
                    <p className="dev-stripe rounded-lg border border-fuchsia-400/40 px-3 py-2 text-xs text-fuchsia-100">
                      <strong>DEV ONLY.</strong> This assessment was produced by the deterministic fixture. No AI model
                      examined the evidence.
                    </p>
                  )}

                  <Step icon={<Paperclip className="size-4" />} title="Evidence considered">
                    {cited.length === 0 ? (
                      <p className="text-slate-400">No evidence was cited for this requirement.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {cited.map((id) => (
                          <li key={id}>
                            <button
                              type="button"
                              className="rounded-md border border-line bg-ink-800 px-2 py-0.5 text-xs hover:border-slate-500"
                              onClick={() => onOpenEvidence({ evidenceId: id })}
                              disabled={!evidenceById.has(id)}
                            >
                              {describe(evidenceById.get(id))}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Step>

                  <Step icon={<Eye className="size-4" />} title="Observations">
                    {assessment.observations.length === 0 ? (
                      <p className="text-slate-400">None.</p>
                    ) : (
                      <ul className="space-y-2">
                        {assessment.observations.map((observation, index) => (
                          <li key={index} className="flex gap-2">
                            <span
                              className={`mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10px] font-bold uppercase ${
                                observation.kind === 'direct'
                                  ? 'bg-emerald-400/15 text-emerald-300'
                                  : 'bg-violet-400/15 text-violet-300'
                              }`}
                              title={
                                observation.kind === 'direct'
                                  ? 'Directly visible, audible or readable in the evidence'
                                  : 'Concluded from the evidence, not directly observed'
                              }
                            >
                              {observation.kind}
                            </span>
                            <span className="text-slate-300">
                              {observation.text}
                              <button
                                type="button"
                                className="ml-1 text-left text-xs text-slate-500 hover:text-slate-300 hover:underline"
                                onClick={() =>
                                  onOpenEvidence({ evidenceId: observation.evidenceId, atSec: observation.startSec })
                                }
                                disabled={!evidenceById.has(observation.evidenceId)}
                              >
                                — {describe(evidenceById.get(observation.evidenceId))}
                                {observation.startSec !== null &&
                                  ` @ ${formatSeconds(observation.startSec)}${
                                    observation.endSec !== null ? `–${formatSeconds(observation.endSec)}` : ''
                                  }`}
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Step>

                  <Step icon={<Brain className="size-4" />} title="Reasoning">
                    <p className="text-slate-300">{assessment.reasoning}</p>
                  </Step>

                  <Step icon={<Gavel className="size-4" />} title="Decision">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <StatusBadge meta={REQUIREMENT_STATUS[assessment.status]} simulated={assessment.simulated} />
                      <span className="text-xs text-slate-400">
                        Confidence:{' '}
                        {assessment.confidence === null
                          ? 'not reported'
                          : `${Math.round(assessment.confidence * 100)}% (reported by the model)`}
                      </span>
                    </div>
                  </Step>

                  {assessment.policyNotes.length > 0 && (
                    <Step icon={<ShieldAlert className="size-4" />} title="Verification policy adjustments">
                      <ul className="list-disc space-y-1 pl-4 text-amber-200/90">
                        {assessment.policyNotes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </Step>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

const describe = (item: Evidence | undefined) =>
  item ? `${EVIDENCE_KIND_LABELS[item.kind]}: ${item.fileName}` : 'unknown evidence';

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className="mt-0.5 text-slate-500" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="eyebrow mb-1">{title}</h4>
        {children}
      </div>
    </section>
  );
}
