import { Quote, Trash2 } from 'lucide-react';
import { EVIDENCE_KINDS, EVIDENCE_KIND_LABELS, type EvidenceKind, type EvidenceNeed, type TemplateRequirement } from '../types';

/** A requirement being edited before it is saved. */
export interface DraftRequirement {
  key: number;
  title: string;
  description: string;
  mandatory: boolean;
  evidenceNeeds: EvidenceNeed[];
  /** Set for proposals drafted from an SOP: the passage they came from. */
  sourceQuote?: string;
}

let nextKey = 0;
export const draftKey = () => nextKey++;

export const blankRequirement = (): DraftRequirement => ({
  key: draftKey(),
  title: '',
  description: '',
  mandatory: true,
  evidenceNeeds: [],
});

/** Strips editor-only fields and fills blank evidence instructions from the title. */
export function toRequirementInput({ title, description, mandatory, evidenceNeeds }: DraftRequirement): TemplateRequirement {
  return {
    title,
    description,
    mandatory,
    evidenceNeeds: evidenceNeeds.map((need) => ({
      kind: need.kind,
      instruction:
        need.instruction || `Upload ${EVIDENCE_KIND_LABELS[need.kind].toLowerCase()} evidence that demonstrates: ${title}.`,
    })),
  };
}

interface Props {
  index: number;
  value: DraftRequirement;
  onChange: (patch: Partial<DraftRequirement>) => void;
  onRemove: () => void;
  removable: boolean;
}

export function RequirementEditor({ index, value, onChange, onRemove, removable }: Props) {
  const toggleNeed = (kind: EvidenceKind) => {
    const has = value.evidenceNeeds.some((need) => need.kind === kind);
    onChange({
      evidenceNeeds: has
        ? value.evidenceNeeds.filter((need) => need.kind !== kind)
        : // The instruction is filled in from the title when the requirement is saved.
          [...value.evidenceNeeds, { kind, instruction: '' }],
    });
  };

  return (
    <div className="rounded-xl border border-line bg-ink-800 p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-bold">
          {index + 1}
        </span>
        <input
          className="input"
          aria-label={`Requirement ${index + 1} title`}
          value={value.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="What must be true for this task to be complete?"
          maxLength={200}
          required
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-300">
          <input
            type="checkbox"
            className="accent-accent"
            checked={value.mandatory}
            onChange={(event) => onChange({ mandatory: event.target.checked })}
          />
          Mandatory
        </label>
        <button
          type="button"
          className="btn px-2 py-2"
          aria-label={`Remove requirement ${index + 1}`}
          disabled={!removable}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2 space-y-2 pl-8">
        <textarea
          className="input text-sm"
          rows={2}
          aria-label={`Requirement ${index + 1} description`}
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Details: what exactly must be true (optional)"
          maxLength={2000}
        />
        {value.sourceQuote && (
          <p className="flex gap-1.5 text-xs text-slate-400">
            <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold text-slate-300">From the SOP:</span> “{value.sourceQuote}”
            </span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Evidence that would prove it:</span>
          {EVIDENCE_KINDS.map((kind) => {
            const selected = value.evidenceNeeds.some((need) => need.kind === kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleNeed(kind)}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  selected ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-slate-400 hover:text-slate-200'
                }`}
              >
                {EVIDENCE_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
