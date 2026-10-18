import { Archive, ArrowLeft, LoaderCircle, MapPin, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useSystem, useWorkOrder } from '../hooks';
import type { EvidenceRequest } from '../types';
import { AuditTrail } from './AuditTrail';
import { EvidencePanel } from './EvidencePanel';
import { EvidenceViewer, type ViewTarget } from './EvidenceViewer';
import { EvidenceRequests } from './EvidenceRequests';
import { REQUIREMENT_STATUS, WORK_ORDER_STATUS, formatDate } from './labels';
import { RequirementCard } from './RequirementCard';
import { ReviewPanel } from './ReviewPanel';
import { SopRequirementsSection } from './SopRequirementsSection';
import { StatusBadge } from './StatusBadge';
import { AiBanner } from './SystemStatus';
import { VerificationOverview } from './VerificationOverview';
import { WorkOrderActions } from './WorkOrderActions';
import { Button, ButtonLink, Card, ErrorState, Loading, Skeleton, useToast } from './ui';

export function WorkOrderDetail() {
  const { id = '' } = useParams();
  const { system } = useSystem();
  const { detail, error, analyzing, refresh } = useWorkOrder(id);
  const [respondingTo, setRespondingTo] = useState<EvidenceRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<ViewTarget | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; at: number } | null>(null);

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(timer);
  }, [highlight]);

  /** From the graph: bring the requirement's card into view, highlight it and focus it. */
  const selectRequirement = useCallback((requirementId: string) => {
    const card = document.getElementById(`requirement-${requirementId}`);
    if (!card) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    card.querySelector('button')?.focus({ preventScroll: true });
    setHighlight({ id: requirementId, at: Date.now() });
  }, []);
  const openEvidence = useCallback((evidenceId: string) => setViewing({ evidenceId }), []);

  // When a run finishes (on this page or elsewhere), say how it ended.
  const toast = useToast();
  const wasAnalyzing = useRef(false);
  const finalStatus = detail?.workOrder.status;
  const simulated = detail?.workOrder.simulated ?? false;
  useEffect(() => {
    if (wasAnalyzing.current && !analyzing && finalStatus) {
      const label = WORK_ORDER_STATUS[finalStatus].label;
      const text = `Verification finished: ${label}${simulated ? ' (simulated)' : ''}`;
      if (finalStatus === 'VERIFIED') toast.success(text);
      else toast.info(text);
    }
    wasAnalyzing.current = analyzing;
  }, [analyzing, finalStatus, simulated, toast]);

  if (error && !detail) {
    return (
      <div className="mx-auto mt-10 max-w-lg space-y-4">
        <ErrorState message={`Could not load this work order: ${error}`} onRetry={() => void refresh()} />
        <ButtonLink to="/work-orders">Back to work orders</ButtonLink>
      </div>
    );
  }
  if (!detail) return <DetailSkeleton />;

  const { workOrder, requirements, evidence, requests, runs, audit, permissions } = detail;
  const meta = WORK_ORDER_STATUS[workOrder.status];
  const aiAvailable = system !== null && system.ai.mode !== 'unconfigured';
  const hasRun = runs.length > 0;
  const proven = requirements.filter((r) => r.status === 'PROVEN').length;
  const lastRun = runs.at(-1);
  const archived = workOrder.archivedAt !== null;
  const inReview = workOrder.status === 'IN_REVIEW';
  const verifyBlocker = archived
    ? 'Archived work orders are read-only'
    : inReview
      ? 'This work order is with a reviewer'
      : !aiAvailable
        ? 'Production AI is not configured'
        : undefined;

  const runVerification = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await api.analyze(workOrder.id);
      toast.info('Verification started');
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start verification';
      setActionError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Work orders
      </Link>

      <AiBanner system={system} />

      {archived && (
        <p role="note" className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          <Archive className="size-4 shrink-0" aria-hidden />
          Archived {formatDate(workOrder.archivedAt!)}. This record is read-only until it is unarchived.
        </p>
      )}

      <header className="card flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1 basis-80">
          <p className="eyebrow">Work order</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg">{workOrder.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-fg-subtle">
            {workOrder.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {workOrder.location}
              </span>
            )}
            <span>Created {formatDate(workOrder.createdAt)}</span>
          </p>
          {workOrder.description && <p className="mt-3 max-w-2xl text-sm text-fg-muted">{workOrder.description}</p>}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <WorkOrderActions workOrder={workOrder} canManage={permissions.manage} onChanged={() => void refresh()} />
          <StatusBadge meta={meta} size="lg" simulated={workOrder.simulated && hasRun} />
          <p className="max-w-xs text-xs text-fg-subtle sm:text-right">{meta.explanation}</p>
          {permissions.manage && (
            <Button
              variant="primary"
              className="mt-1"
              onClick={() => void runVerification()}
              disabled={verifyBlocker !== undefined || analyzing || starting}
              title={verifyBlocker}
            >
              {analyzing || starting ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : hasRun ? (
                <RefreshCw className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {analyzing ? 'Analyzing…' : hasRun ? 'Re-run verification' : 'Run verification'}
            </Button>
          )}
          {actionError && <p className="max-w-xs text-xs text-contradicted-fg sm:text-right">{actionError}</p>}
        </div>
      </header>

      <VerificationOverview
        detail={detail}
        coreHex={hasRun || analyzing ? meta.hex : REQUIREMENT_STATUS.NOT_PROVEN.hex}
        onSelectRequirement={selectRequirement}
        onOpenEvidence={openEvidence}
      />

      {lastRun?.status === 'FAILED' && (
        <p role="alert" className="rounded-xl border border-contradicted/40 bg-contradicted/10 px-4 py-3 text-sm text-contradicted-fg">
          The last verification run failed and changed nothing: {lastRun.error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <ReviewPanel detail={detail} onChanged={() => void refresh()} />

          <EvidenceRequests
            requests={requests}
            requirements={requirements}
            onRespond={permissions.upload ? setRespondingTo : null}
          />

          <section aria-labelledby="checklist-heading">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="checklist-heading" className="eyebrow">
                Requirement checklist
              </h2>
              <p className="text-xs text-fg-subtle">
                {proven} of {requirements.length} proven
              </p>
            </div>
            <ul className="space-y-2">
              {requirements.map((requirement) => (
                <RequirementCard
                  key={requirement.id}
                  requirement={requirement}
                  evidence={evidence}
                  onOpenEvidence={setViewing}
                  highlighted={highlight?.id === requirement.id}
                />
              ))}
            </ul>
          </section>

          {permissions.manage && !archived && !inReview && !analyzing && (
            <SopRequirementsSection workOrder={workOrder} system={system} onSaved={() => void refresh()} />
          )}
        </div>

        <aside className="space-y-5">
          <EvidencePanel
            workOrderId={workOrder.id}
            evidence={evidence}
            maxUploadMb={system?.maxUploadMb ?? null}
            readOnlyReason={permissions.reasons.upload ?? null}
            respondingTo={respondingTo}
            onClearRequest={() => setRespondingTo(null)}
            onUploaded={() => void refresh()}
            onOpen={(evidenceId) => setViewing({ evidenceId })}
          />

          <AuditTrail events={audit} />
        </aside>
      </div>

      <EvidenceViewer
        detail={detail}
        aiMode={system?.ai.mode ?? null}
        target={viewing}
        onNavigate={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/** The page's shape while it loads. */
function DetailSkeleton() {
  return (
    <Loading label="Loading work order…">
      <div className="space-y-5">
        <Skeleton className="h-4 w-28" />
        <Card padding="lg" className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </Card>
        <Card padding="none" className="grid h-[380px] lg:grid-cols-[17rem_minmax(0,1fr)]">
          <div className="space-y-3 p-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="m-5 hidden rounded-card lg:block" />
        </Card>
        <div className="space-y-2">
          {[0, 1, 2].map((k) => (
            <Card key={k} className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </Card>
          ))}
        </div>
      </div>
    </Loading>
  );
}
