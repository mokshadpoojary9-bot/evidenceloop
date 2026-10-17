import { Archive, ArrowLeft, LoaderCircle, MapPin, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useSystem, useWorkOrder } from '../hooks';
import type { EvidenceRequest } from '../types';
import { AuditTrail } from './AuditTrail';
import { EvidencePanel } from './EvidencePanel';
import { EvidenceRequests } from './EvidenceRequests';
import { REQUIREMENT_STATUS, WORK_ORDER_STATUS, formatDate } from './labels';
import { LoopVisual } from './LoopVisual';
import { RequirementCard } from './RequirementCard';
import { ReviewPanel } from './ReviewPanel';
import { SopRequirementsSection } from './SopRequirementsSection';
import { StatusBadge } from './StatusBadge';
import { AiBanner } from './SystemStatus';
import { WorkOrderActions } from './WorkOrderActions';

export function WorkOrderDetail() {
  const { id = '' } = useParams();
  const { system } = useSystem();
  const { detail, error, analyzing, refresh } = useWorkOrder(id);
  const [respondingTo, setRespondingTo] = useState<EvidenceRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (error && !detail) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
        <p className="text-rose-300">{error}</p>
        <Link to="/work-orders" className="btn mt-4">
          Back to work orders
        </Link>
      </div>
    );
  }
  if (!detail) return <p className="p-10 text-center text-slate-400">Loading…</p>;

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
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start verification');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" aria-hidden /> Work orders
      </Link>

      <AiBanner system={system} />

      {archived && (
        <p role="note" className="flex items-center gap-2 rounded-xl border border-line bg-ink-800 px-4 py-3 text-sm text-slate-300">
          <Archive className="size-4 shrink-0" aria-hidden />
          Archived {formatDate(workOrder.archivedAt!)}. This record is read-only until it is unarchived.
        </p>
      )}

      <header className="card flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1 basis-80">
          <p className="eyebrow">Work order</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{workOrder.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-400">
            {workOrder.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {workOrder.location}
              </span>
            )}
            <span>Created {formatDate(workOrder.createdAt)}</span>
          </p>
          {workOrder.description && <p className="mt-3 max-w-2xl text-sm text-slate-300">{workOrder.description}</p>}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <WorkOrderActions workOrder={workOrder} canManage={permissions.manage} onChanged={() => void refresh()} />
          <StatusBadge meta={meta} size="lg" simulated={workOrder.simulated && hasRun} />
          <p className="max-w-xs text-xs text-slate-400 sm:text-right">{meta.explanation}</p>
          {permissions.manage && (
            <button
              className="btn btn-primary mt-1"
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
            </button>
          )}
          {actionError && <p className="max-w-xs text-xs text-rose-300 sm:text-right">{actionError}</p>}
        </div>
      </header>

      {lastRun?.status === 'FAILED' && (
        <p role="alert" className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
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
              <p className="text-xs text-slate-400">
                {proven} of {requirements.length} proven
              </p>
            </div>
            <ul className="space-y-2">
              {requirements.map((requirement) => (
                <RequirementCard key={requirement.id} requirement={requirement} evidence={evidence} />
              ))}
            </ul>
          </section>

          {permissions.manage && !archived && !inReview && !analyzing && (
            <SopRequirementsSection workOrder={workOrder} system={system} onSaved={() => void refresh()} />
          )}
        </div>

        <aside className="space-y-5">
          <section className="card overflow-hidden" aria-label="Verification loop">
            <LoopVisual
              className="h-56"
              statuses={requirements.map((r) => r.status)}
              coreHex={hasRun || analyzing ? meta.hex : REQUIREMENT_STATUS.NOT_PROVEN.hex}
            />
            <p className="border-t border-line px-4 py-2 text-center text-xs text-slate-400">
              One node per requirement. The core shows the overall state.
            </p>
          </section>

          <EvidencePanel
            workOrderId={workOrder.id}
            evidence={evidence}
            maxUploadMb={system?.maxUploadMb ?? null}
            readOnlyReason={permissions.reasons.upload ?? null}
            respondingTo={respondingTo}
            onClearRequest={() => setRespondingTo(null)}
            onUploaded={() => void refresh()}
          />

          <AuditTrail events={audit} />
        </aside>
      </div>
    </div>
  );
}
