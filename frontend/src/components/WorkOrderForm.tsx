import { ArrowLeft, ChevronDown, LoaderCircle, Plus, UserSearch } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { Button, ButtonLink, Card, EmptyState, ErrorState, Input, Loading, Select, Skeleton, Textarea, useToast } from './ui';

const CUSTOM = 'custom';

export function WorkOrderForm() {
  const navigate = useNavigate();
  const { system } = useSystem();
  const { viewer } = useViewer();
  const [templates, setTemplates] = useState<WorkOrderTemplate[]>([]);
  const [templateState, setTemplateState] = useState<'loading' | 'ready' | string>('loading');
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
  const loadTemplates = useCallback(() => {
    setTemplateState('loading');
    api.templates().then(
      (loaded) => {
        setTemplates(loaded);
        applyTemplate(loaded[0]);
        setTemplateState('ready');
      },
      (err: Error) => setTemplateState(err.message),
    );
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

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

  const toast = useToast();
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
      toast.success(`Created “${created.workOrder.title}”`);
      navigate(`/work-orders/${created.workOrder.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create work order';
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  };

  if (viewer?.role === 'reviewer') {
    return (
      <EmptyState
        icon={UserSearch}
        title="Reviewers do not create work orders"
        className="mx-auto mt-10 max-w-lg"
        action={<ButtonLink to="/work-orders">Back to work orders</ButtonLink>}
      >
        Switch to a technician account to create one.
      </EmptyState>
    );
  }
  if (templateState === 'loading') return <FormSkeleton />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Work orders
      </Link>

      {templateState !== 'ready' && (
        <ErrorState
          message={`Templates could not be loaded (${templateState}). You can still create a blank work order.`}
          onRetry={loadTemplates}
        />
      )}

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">New work order</h1>
          <p className="mt-1 text-sm text-fg-subtle">
            Define the task and the requirements that evidence must prove. Nothing is assumed complete.
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Start from</span>
          <Select
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
          </Select>
        </label>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Replace emergency light in Room 204"
              maxLength={200}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Location</span>
            <Input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Room 204"
              maxLength={200}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Description</span>
          <Textarea
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
            <ChevronDown className={`size-4 text-fg-faint transition-transform ${sopOpen ? 'rotate-180' : ''}`} aria-hidden />
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
          <Button type="button" onClick={() => setRequirements((items) => [...items, blankRequirement()])}>
            <Plus className="size-4" aria-hidden /> Add requirement
          </Button>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl border border-contradicted/40 bg-contradicted/10 px-4 py-3 text-sm text-contradicted-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-5">
          <ButtonLink to="/work-orders" >
            Cancel
          </ButtonLink>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {submitting ? 'Creating…' : 'Create work order'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FormSkeleton() {
  return (
    <Loading label="Loading the form…">
      <div className="mx-auto max-w-3xl space-y-5">
        <Skeleton className="h-4 w-28" />
        <Card padding="lg" className="space-y-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-3/4" />
          {[0, 1, 2].map((k) => (
            <div key={k} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </Card>
      </div>
    </Loading>
  );
}
