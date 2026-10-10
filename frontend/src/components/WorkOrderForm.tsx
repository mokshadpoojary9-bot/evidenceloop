import { ArrowLeft, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type EvidenceKind,
  type EvidenceNeed,
  type WorkOrderTemplate,
} from '../types';

interface DraftRequirement {
  key: number;
  title: string;
  description: string;
  mandatory: boolean;
  evidenceNeeds: EvidenceNeed[];
}

let nextKey = 0;
const blankRequirement = (): DraftRequirement => ({
  key: nextKey++,
  title: '',
  description: '',
  mandatory: true,
  evidenceNeeds: [],
});

const CUSTOM = 'custom';

export function WorkOrderForm() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WorkOrderTemplate[]>([]);
  const [templateId, setTemplateId] = useState(CUSTOM);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState<DraftRequirement[]>(() => [blankRequirement()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (template: WorkOrderTemplate | undefined) => {
    setTemplateId(template?.id ?? CUSTOM);
    if (!template) return;
    setTitle(template.title);
    setLocation(template.location);
    setDescription(template.description);
    setRequirements(template.requirements.map((requirement) => ({ key: nextKey++, ...requirement })));
  };

  // Start from the demo scenario; it is one click to switch to a blank work order.
  useEffect(() => {
    api.templates().then(
      (loaded) => {
        setTemplates(loaded);
        applyTemplate(loaded[0]);
      },
      (err: Error) => setError(err.message),
    );
  }, []);

  const update = (key: number, patch: Partial<DraftRequirement>) =>
    setRequirements((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const toggleNeed = (requirement: DraftRequirement, kind: EvidenceKind) => {
    const has = requirement.evidenceNeeds.some((need) => need.kind === kind);
    update(requirement.key, {
      evidenceNeeds: has
        ? requirement.evidenceNeeds.filter((need) => need.kind !== kind)
        : // The instruction is filled in from the title when the form is submitted.
          [...requirement.evidenceNeeds, { kind, instruction: '' }],
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createWorkOrder({
        title,
        location,
        description,
        templateId: templateId === CUSTOM ? null : templateId,
        requirements: requirements.map(({ key: _key, ...requirement }) => ({
          ...requirement,
          evidenceNeeds: requirement.evidenceNeeds.map((need) => ({
            kind: need.kind,
            instruction:
              need.instruction ||
              `Upload ${EVIDENCE_KIND_LABELS[need.kind].toLowerCase()} evidence that demonstrates: ${requirement.title}.`,
          })),
        })),
      });
      navigate(`/work-orders/${created.workOrder.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create work order');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" aria-hidden /> Work orders
      </Link>

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">New work order</h1>
          <p className="mt-1 text-sm text-slate-400">
            Define the task and the requirements that evidence must prove. Nothing is assumed complete.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Start from</span>
          <select
            className="input"
            value={templateId}
            onChange={(event) => {
              const template = templates.find((candidate) => candidate.id === event.target.value);
              if (template) applyTemplate(template);
              else {
                setTemplateId(CUSTOM);
                setRequirements([blankRequirement()]);
              }
            }}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                Template: {template.name}
              </option>
            ))}
            <option value={CUSTOM}>Blank work order</option>
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Title</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Replace emergency light in Room 204"
              maxLength={200}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Location</span>
            <input
              className="input"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Room 204"
              maxLength={200}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Description</span>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
          />
        </label>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Requirements ({requirements.length})</legend>
          {requirements.map((requirement, index) => (
            <div key={requirement.key} className="rounded-xl border border-line bg-ink-800 p-3">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-bold">
                  {index + 1}
                </span>
                <input
                  className="input"
                  aria-label={`Requirement ${index + 1} title`}
                  value={requirement.title}
                  onChange={(event) => update(requirement.key, { title: event.target.value })}
                  placeholder="What must be true for this task to be complete?"
                  maxLength={200}
                  required
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={requirement.mandatory}
                    onChange={(event) => update(requirement.key, { mandatory: event.target.checked })}
                  />
                  Mandatory
                </label>
                <button
                  type="button"
                  className="btn px-2 py-2"
                  aria-label={`Remove requirement ${index + 1}`}
                  disabled={requirements.length === 1}
                  onClick={() => setRequirements((items) => items.filter((item) => item.key !== requirement.key))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
                <span className="text-xs text-slate-400">Evidence that would prove it:</span>
                {EVIDENCE_KINDS.map((kind) => {
                  const selected = requirement.evidenceNeeds.some((need) => need.kind === kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleNeed(requirement, kind)}
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        selected
                          ? 'border-accent/60 bg-accent/15 text-accent'
                          : 'border-line text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {EVIDENCE_KIND_LABELS[kind]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRequirements((items) => [...items, blankRequirement()])}>
            <Plus className="size-4" aria-hidden /> Add requirement
          </button>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-5">
          <Link to="/work-orders" className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {submitting ? 'Creating…' : 'Create work order'}
          </button>
        </div>
      </form>
    </div>
  );
}
