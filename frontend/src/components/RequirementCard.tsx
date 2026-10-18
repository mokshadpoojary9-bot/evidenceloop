import { AnimatePresence, motion } from 'framer-motion';
import { Brain, ChevronDown, Clock, Eye, Gavel, ListChecks, Paperclip, SearchX, ShieldAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { CANNOT_VERIFY, EVIDENCE_KIND_LABELS, type Evidence, type EvidenceNeed, type WorkOrderDetail } from '../types';
import { EVIDENCE_ICON, REQUIREMENT_STATUS, formatSeconds } from './labels';
import { StatusBadge } from './StatusBadge';
import type { ViewTarget } from './EvidenceViewer';
import { Badge } from './ui';

type RequirementWithAssessment = WorkOrderDetail['requirements'][number];

interface Props {
  requirement: RequirementWithAssessment;
  evidence: Evidence[];
  onOpenEvidence: (target: ViewTarget) => void;
  /** Briefly ringed after it was selected in the verification graph. */
  highlighted?: boolean;
}

/** "82%" as reported by the model, or an explicit "not given": never computed or filled in. */
export function confidenceLabel(confidence: number | null): string {
  return confidence === null ? 'Confidence not given' : `Confidence ${Math.round(confidence * 100)}% (model-reported)`;
}

/** One checklist item, expandable into Requirement → Evidence → Observation → Reasoning → Decision. */
export function RequirementCard({ requirement, evidence, onOpenEvidence, highlighted = false }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { assessment } = requirement;
  const meta = REQUIREMENT_STATUS[requirement.status];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const cited = assessment ? [...new Set(assessment.observations.map((o) => o.evidenceId))] : [];
  const unproven = requirement.status !== 'PROVEN' && requirement.status !== 'ANALYZING';
  // The policy prefixes unproven reasoning with the sentence; it is shown on its own line here.
  const reasoning = assessment?.reasoning.replace(CANNOT_VERIFY, '').trim() ?? '';
  const missing: EvidenceNeed[] = assessment ? assessment.missingEvidence : requirement.evidenceNeeds;

  return (
    <motion.li
      layout="position"
      id={`requirement-${requirement.id}`}
      className={`card overflow-hidden transition-shadow duration-500 ${highlighted ? 'ring-2 ring-analyzing/80' : ''}`}
    >
      <button
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink-950"
          style={{ backgroundColor: meta.hex }}
          aria-hidden
        >
          {requirement.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold break-words text-fg">{requirement.title}</span>
            <span
              className={`rounded border px-1.5 text-[10px] font-semibold uppercase ${
                requirement.mandatory ? 'border-line-strong text-fg-muted' : 'border-line text-fg-faint'
              }`}
            >
              {requirement.mandatory ? 'Mandatory' : 'Optional'}
            </span>
          </span>
          {assessment ? (
            <>
              <span className="mt-1 line-clamp-2 block text-sm text-fg-muted">{reasoning || assessment.reasoning}</span>
              <span className="mt-1 block text-xs text-fg-faint">{confidenceLabel(assessment.confidence)}</span>
            </>
          ) : (
            <span className="mt-0.5 block text-sm text-fg-subtle">{requirement.description}</span>
          )}
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
          <ChevronDown className={`size-4 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          <span className="sr-only">{open ? 'Hide' : 'Show'} the evidence chain</span>
        </span>
      </button>

      {unproven && (
        <div className="mx-4 mb-4 -mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
          <p className="flex items-start gap-2 font-medium text-fg">
            <SearchX className="mt-0.5 size-4 shrink-0 text-uncertain-fg" aria-hidden />
            {CANNOT_VERIFY}
          </p>
          {missing.length > 0 && (
            <div className="mt-1.5 pl-6 text-xs text-fg-muted">
              <p className="font-semibold text-fg-subtle">Missing:</p>
              <ul className="mt-0.5 space-y-0.5">
                {missing.map((need, index) => {
                  const Icon = EVIDENCE_ICON[need.kind];
                  return (
                    <li key={index} className="flex gap-1.5">
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
                      <span>
                        <span className="text-fg-subtle">{EVIDENCE_KIND_LABELS[need.kind]}:</span> {need.instruction}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ol className="space-y-4 border-t border-line px-4 py-4 text-sm" aria-label="Evidence chain">
              <Step icon={<ListChecks className="size-4" />} title="Requirement">
                <p className="text-fg-muted">{requirement.description || requirement.title}</p>
                {requirement.evidenceNeeds.length > 0 && (
                  <p className="mt-1 text-xs text-fg-subtle">
                    Expects: {requirement.evidenceNeeds.map((need) => EVIDENCE_KIND_LABELS[need.kind]).join(', ')}
                  </p>
                )}
              </Step>

              {!assessment ? (
                <li className="pl-7 text-fg-subtle">No verification run has assessed this requirement yet.</li>
              ) : (
                <>
                  {assessment.simulated && (
                    <li className="dev-stripe rounded-lg border border-dev/40 px-3 py-2 text-xs text-dev-fg">
                      <strong>DEV ONLY.</strong> This assessment was produced by the deterministic fixture. No AI model
                      examined the evidence.
                    </li>
                  )}

                  <Step icon={<Paperclip className="size-4" />} title="Evidence">
                    {cited.length === 0 ? (
                      <p className="text-fg-subtle">No evidence was cited for this requirement.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {cited.map((id) => (
                          <li key={id}>
                            <button
                              type="button"
                              className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs break-all hover:border-line-strong"
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

                  <Step icon={<Eye className="size-4" />} title="Observation">
                    {assessment.observations.length === 0 ? (
                      <p className="text-fg-subtle">Nothing relevant was observed in the evidence.</p>
                    ) : (
                      <ul className="space-y-2">
                        {assessment.observations.map((observation, index) => {
                          const item = evidenceById.get(observation.evidenceId);
                          return (
                            <li key={index} className="flex gap-2">
                              <span
                                className={`mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10px] font-bold uppercase ${
                                  observation.kind === 'direct' ? 'bg-proven/15 text-proven-fg' : 'bg-review/15 text-review-fg'
                                }`}
                                title={
                                  observation.kind === 'direct'
                                    ? 'Directly visible, audible or readable in the evidence'
                                    : 'Concluded from the evidence, not directly observed'
                                }
                              >
                                {observation.kind}
                              </span>
                              <span className="min-w-0 text-fg-muted">
                                {observation.text}
                                <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                                  <button
                                    type="button"
                                    className="text-left break-all text-fg-faint hover:text-fg-muted hover:underline"
                                    onClick={() => onOpenEvidence({ evidenceId: observation.evidenceId })}
                                    disabled={!item}
                                  >
                                    {describe(item)}
                                  </button>
                                  {observation.startSec !== null && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 font-semibold text-accent-fg hover:underline"
                                      onClick={() =>
                                        onOpenEvidence({ evidenceId: observation.evidenceId, atSec: observation.startSec })
                                      }
                                      disabled={!item}
                                      aria-label={`Play from ${formatSeconds(observation.startSec)}`}
                                    >
                                      <Clock className="size-3" aria-hidden />
                                      {formatSeconds(observation.startSec)}
                                      {observation.endSec !== null && `–${formatSeconds(observation.endSec)}`}
                                    </button>
                                  )}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Step>

                  <Step icon={<Brain className="size-4" />} title="Reasoning">
                    <p className="text-fg-muted">{assessment.reasoning}</p>
                  </Step>

                  <Step icon={<Gavel className="size-4" />} title="Decision">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <StatusBadge meta={REQUIREMENT_STATUS[assessment.status]} simulated={assessment.simulated} />
                      <Badge>{confidenceLabel(assessment.confidence)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-faint">
                      {assessment.simulated
                        ? 'Decided by the DEV fixture (not AI)'
                        : assessment.model
                          ? `Decided by ${assessment.model}`
                          : 'Decided without a model'}
                      {' · '}checked by the verification policy
                    </p>
                  </Step>

                  {assessment.policyNotes.length > 0 && (
                    <Step icon={<ShieldAlert className="size-4" />} title="Verification policy adjustments">
                      <ul className="list-disc space-y-1 pl-4 text-uncertain-fg/90">
                        {assessment.policyNotes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </Step>
                  )}
                </>
              )}
            </ol>
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
    <li className="flex gap-3">
      <span className="mt-0.5 text-fg-faint" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="eyebrow mb-1">{title}</h4>
        {children}
      </div>
    </li>
  );
}
