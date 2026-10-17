import { ArrowLeft, ChevronDown, LoaderCircle, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useSystem } from '../hooks';
import type { WorkOrderTemplate } from '../types';
import {
  blankRequirement,
  draftKey,
  RequirementEditor,
  toRequirementInput,
  type DraftRequirement,
} from './RequirementEditor';
import { SopDraftPanel } from './SopDraftPanel';
import { useViewer } from '../viewer';

const CUSTOM = 'custom';

export function WorkOrderForm() {
  const navigate = useNavigate();
  const { system } = useSystem();
  const { viewer } = useViewer();
  const [templates, setTemplates] = useState<WorkOrderTemplate[]>([]);
  const [templateId, setTemplateId] = useState(CUSTOM);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState<DraftRequirement[]>(() => [blankRequirement()]);
  const [sopOpen, setSopOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (template: WorkOrderTemplate | undefined) => {
    setTemplateId(template?.id ?? CUSTOM);
    if (!template) return;
    setTitle(template.title);
    setLocation(template.location);
    setDescription(template.description);
    setRequirements(template.requirements.map((requirement) => ({ key: draftKey(), ...requirement })));
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

  // Reviewed SOP proposals join the list; a single untouched blank row is replaced.
  const addFromSop = async (proposals: DraftRequirement[]) => {
    setRequirements((items) => {
      const untouched = items.length === 1 && !items[0]!.title.trim() && items[0]!.evidenceNeeds.length === 0;
      return [...(untouched ? [] : items), ...proposals];
    });
    setTemplateId(CUSTOM);
    setSopOpen(false);
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
        requirements: requirements.map(toRequirementInput),
      });
      navigate(`/work-orders/${created.workOrder.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create work order');
      setSubmitting(false);
    }
  };

  if (viewer?.role === 'reviewer') {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
        <p className="text-slate-300">Reviewers do not create work orders. Switch to a technician account to create one.</p>
        <Link to="/work-orders" className="btn mt-4">
          Back to work orders
        </Link>
      </div>
    );
  }

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

        <section className="rounded-xl border border-line">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
            aria-expanded={sopOpen}
            onClick={() => setSopOpen((open) => !open)}
          >
            Generate requirements from an SOP or manual
            <ChevronDown className={`size-4 text-slate-500 transition-transform ${sopOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {sopOpen && (
            <div className="border-t border-line p-4">
              <SopDraftPanel
                context={{ title, description, location }}
                aiAvailable={system !== null && system.ai.mode !== 'unconfigured'}
                maxUploadMb={system?.maxUploadMb ?? null}
                confirmLabel={(count) => `Add ${count} to this work order`}
                onConfirm={addFromSop}
              />
            </div>
          )}
        </section>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Requirements ({requirements.length})</legend>
          {requirements.map((requirement, index) => (
            <RequirementEditor
              key={requirement.key}
              index={index}
              value={requirement}
              onChange={(patch) => update(requirement.key, patch)}
              onRemove={() => setRequirements((items) => items.filter((item) => item.key !== requirement.key))}
              removable={requirements.length > 1}
            />
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
