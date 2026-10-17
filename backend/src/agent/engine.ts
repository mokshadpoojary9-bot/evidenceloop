import { randomUUID } from 'node:crypto';
import type { AiProvider } from '../ai/provider.js';
import { HttpError } from '../middleware/errors.js';
import type { Db } from '../stores/db.js';
import {
  EVIDENCE_KIND_LABELS,
  type AnalysisRun,
  type Assessment,
  type Evidence,
  type EvidenceNeed,
  type EvidenceRequest,
  type Requirement,
  type RequirementStatus,
  type WorkOrder,
} from '../types.js';
import { audit, now } from './audit.js';
import { planEvidenceRequests } from './planner.js';
import { applyPolicy, indexRawAssessments, notProven, overallStatus, type Decision } from './policy.js';

/**
 * The verification loop:
 *
 *   retrieve requirements → build checklist → analyze evidence → map evidence to
 *   requirements → check proof → detect uncertainty and contradictions → identify
 *   missing evidence → plan the minimum request → (new evidence) → re-analyze →
 *   final verification — with every step written to the audit trail.
 *
 * The provider supplies perception and judgment; everything else here is
 * deterministic and does not depend on which provider is plugged in.
 */

export type Trigger =
  | { type: 'manual'; actor: string }
  | { type: 'new_evidence'; actor: string; evidenceId: string };

export interface Engine {
  readonly available: boolean;
  /** Starts a run, or queues one if a run is already in flight for this work order. */
  start(workOrderId: string, trigger: Trigger): Promise<{ runId: string | null; queued: boolean }>;
  /** Resolves when no run is in flight for the work order (used by tests). */
  whenIdle(workOrderId: string): Promise<void>;
}

export const AI_NOT_CONFIGURED =
  'Production AI is not configured, so verification cannot run. Set NEBIUS_API_KEY and NEBIUS_MODEL to enable Nebius Token Factory + NVIDIA Nemotron.';

interface ActiveRun {
  done: Promise<void>;
  queued: Trigger | null;
}

export function createEngine(db: Db, provider: AiProvider | null): Engine {
  const active = new Map<string, ActiveRun>();

  async function start(workOrderId: string, trigger: Trigger) {
    if (!provider) throw new HttpError(503, AI_NOT_CONFIGURED, 'AI_NOT_CONFIGURED');

    // One run per work order at a time. Anything arriving mid-run is folded into
    // a single full re-run afterwards, so no evidence is ever left unconsidered.
    const current = active.get(workOrderId);
    if (current) {
      current.queued = { type: 'manual', actor: trigger.actor };
      return { runId: null, queued: true };
    }

    let onStarted!: (runId: string) => void;
    let onStartFailed!: (error: unknown) => void;
    const started = new Promise<string>((resolve, reject) => {
      onStarted = resolve;
      onStartFailed = reject;
    });

    const entry: ActiveRun = { done: Promise.resolve(), queued: null };
    active.set(workOrderId, entry);
    entry.done = run(provider, workOrderId, trigger, onStarted)
      .catch(onStartFailed)
      .finally(() => {
        active.delete(workOrderId);
        if (entry.queued) {
          start(workOrderId, entry.queued).catch((error) =>
            console.error('Queued verification run failed to start:', error),
          );
        }
      });

    return { runId: await started, queued: false };
  }

  async function whenIdle(workOrderId: string) {
    for (let entry = active.get(workOrderId); entry; entry = active.get(workOrderId)) {
      await entry.done;
    }
  }

  async function run(
    ai: AiProvider,
    workOrderId: string,
    trigger: Trigger,
    onStarted: (runId: string) => void,
  ) {
    const workOrder = await db.get('work_orders', workOrderId);
    if (!workOrder) throw new HttpError(404, 'Work order not found');

    // Retrieve requirements and build the checklist for this run.
    const requirements = await db.list('requirements', { workOrderId }, 'position');
    const evidence = await db.list('evidence', { workOrderId }, 'createdAt');
    // Only the agent's own requests are reconciled; a reviewer's request stays open until answered.
    const openRequests = (await db.list('evidence_requests', { workOrderId, status: 'OPEN' })).filter(
      (request) => (request.requestedBy ?? 'agent') === 'agent',
    );
    const targets = selectTargets(requirements, evidence, trigger);

    const analysisRun: AnalysisRun = {
      id: randomUUID(),
      workOrderId,
      trigger: trigger.type,
      triggerEvidenceId: trigger.type === 'new_evidence' ? trigger.evidenceId : null,
      requirementIds: targets.map((r) => r.id),
      provider: ai.id,
      model: ai.model,
      simulated: ai.simulated,
      status: 'RUNNING',
      error: null,
      startedAt: now(),
      completedAt: null,
    };
    await db.insert('analysis_runs', analysisRun);

    const previousStatus = new Map<string, RequirementStatus>(targets.map((r) => [r.id, r.status]));
    for (const requirement of targets) {
      await db.update('requirements', requirement.id, { status: 'ANALYZING', updatedAt: now() });
    }
    await db.update('work_orders', workOrderId, { status: 'ANALYZING', updatedAt: now() });
    await audit(db, {
      workOrderId,
      runId: analysisRun.id,
      actor: trigger.actor,
      type: 'ANALYSIS_STARTED',
      summary:
        `${trigger.type === 'new_evidence' ? 'Re-analysis after new evidence' : 'Verification run'} started: ` +
        `${targets.length} of ${requirements.length} requirements against ${evidence.length} evidence file(s)` +
        (ai.simulated ? ' — DEV FIXTURE, simulated, not AI inference.' : ` using ${ai.model}.`),
      data: {
        trigger: trigger.type,
        provider: ai.id,
        model: ai.model,
        simulated: ai.simulated,
        requirementIds: analysisRun.requirementIds,
        evidenceIds: evidence.map((item) => item.id),
      },
    });
    onStarted(analysisRun.id);

    try {
      // Analyze the evidence. With nothing uploaded there is nothing to send to a model.
      // Earlier conclusions are deliberately not passed in: each run judges the evidence afresh.
      const raw =
        evidence.length > 0 ? await ai.assess({ workOrder, requirements: targets, evidence }) : [];
      const rawById = indexRawAssessments(raw);
      const evidenceIds = new Set(evidence.map((item) => item.id));

      // Map evidence to requirements and check proof, one explicit decision per requirement.
      const decisions = new Map<string, Decision>();
      for (const requirement of targets) {
        const decision =
          evidence.length > 0
            ? applyPolicy(requirement, rawById.get(requirement.id), evidenceIds)
            : notProven('No evidence has been uploaded for this work order.');
        decisions.set(requirement.id, decision);
        await recordDecision(ai, analysisRun, requirement, decision, previousStatus.get(requirement.id)!);
      }

      // Identify missing evidence and plan the minimum request.
      const updated = await db.list('requirements', { workOrderId }, 'position');
      const planned = planEvidenceRequests(
        updated.map((requirement) => ({
          requirement,
          missingEvidence: decisions.get(requirement.id)?.missingEvidence ?? [],
        })),
        evidence,
      );
      await reconcileRequests(analysisRun, openRequests, planned);

      const status = overallStatus(updated);
      await db.update('work_orders', workOrderId, {
        status,
        simulated: ai.simulated,
        updatedAt: now(),
      });
      await db.update('analysis_runs', analysisRun.id, { status: 'COMPLETED', completedAt: now() });
      await audit(db, {
        workOrderId,
        runId: analysisRun.id,
        actor: 'agent',
        type: 'ANALYSIS_COMPLETED',
        summary: `${completionSummary(status, updated, planned.length)}${ai.simulated ? ' (DEV FIXTURE — simulated)' : ''}`,
        data: {
          status,
          previousStatus: workOrder.status,
          simulated: ai.simulated,
          requirements: updated.map((r) => ({ id: r.id, status: r.status })),
        },
      });
    } catch (error) {
      // A failed run must not leave requirements stuck in ANALYZING or change any decision.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Verification run ${analysisRun.id} failed: ${message}`);
      for (const [id, status] of previousStatus) {
        const current = await db.get('requirements', id);
        if (current?.status === 'ANALYZING') {
          await db.update('requirements', id, { status, updatedAt: now() });
        }
      }
      await db.update('work_orders', workOrderId, { status: workOrder.status, updatedAt: now() });
      await db.update('analysis_runs', analysisRun.id, {
        status: 'FAILED',
        error: message,
        completedAt: now(),
      });
      await audit(db, {
        workOrderId,
        runId: analysisRun.id,
        actor: 'agent',
        type: 'ANALYSIS_FAILED',
        summary: `Verification run failed; no requirement status was changed. ${message}`,
        data: { error: message },
      });
    }
  }

  async function recordDecision(
    ai: AiProvider,
    analysisRun: AnalysisRun,
    requirement: Requirement,
    decision: Decision,
    previous: RequirementStatus,
  ) {
    const assessment: Assessment = {
      id: randomUUID(),
      workOrderId: requirement.workOrderId,
      requirementId: requirement.id,
      runId: analysisRun.id,
      ...decision,
      provider: ai.id,
      model: ai.model,
      simulated: ai.simulated,
      createdAt: now(),
    };
    await db.insert('assessments', assessment);
    await db.update('requirements', requirement.id, {
      status: decision.status,
      currentAssessmentId: assessment.id,
      updatedAt: now(),
    });
    await audit(db, {
      workOrderId: requirement.workOrderId,
      runId: analysisRun.id,
      actor: 'agent',
      type: 'REQUIREMENT_ASSESSED',
      summary:
        `Requirement ${requirement.position}. "${requirement.title}": ` +
        (previous === decision.status ? decision.status : `${previous} → ${decision.status}`) +
        (ai.simulated ? ' (simulated)' : ''),
      data: {
        requirementId: requirement.id,
        assessmentId: assessment.id,
        previousStatus: previous,
        status: decision.status,
        confidence: decision.confidence,
        evidenceIds: [...new Set(decision.observations.map((o) => o.evidenceId))],
        policyNotes: decision.policyNotes,
        simulated: ai.simulated,
      },
    });
  }

  /** Keeps still-needed requests open, retires the rest, and opens any new ones. */
  async function reconcileRequests(
    analysisRun: AnalysisRun,
    open: EvidenceRequest[],
    planned: { kind: EvidenceRequest['kind']; instruction: string; requirementIds: string[] }[],
  ) {
    const { workOrderId } = analysisRun;

    for (const request of open) {
      const match = planned.find((candidate) => candidate.kind === request.kind);
      if (match) {
        await db.update('evidence_requests', request.id, {
          instruction: match.instruction,
          requirementIds: match.requirementIds,
          updatedAt: now(),
        });
      } else {
        await db.update('evidence_requests', request.id, { status: 'SUPERSEDED', updatedAt: now() });
        await audit(db, {
          workOrderId,
          runId: analysisRun.id,
          actor: 'agent',
          type: 'EVIDENCE_REQUEST_SUPERSEDED',
          summary: `Request for ${EVIDENCE_KIND_LABELS[request.kind]} is no longer needed.`,
          data: { requestId: request.id },
        });
      }
    }

    for (const plan of planned) {
      if (open.some((request) => request.kind === plan.kind)) continue;
      const request: EvidenceRequest = {
        id: randomUUID(),
        workOrderId,
        runId: analysisRun.id,
        requestedBy: 'agent',
        ...plan,
        status: 'OPEN',
        fulfilledByEvidenceId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      await db.insert('evidence_requests', request);
      await audit(db, {
        workOrderId,
        runId: analysisRun.id,
        actor: 'agent',
        type: 'EVIDENCE_REQUESTED',
        summary: `Additional evidence requested: ${plan.instruction}`,
        data: { requestId: request.id, kind: plan.kind, requirementIds: plan.requirementIds },
      });
    }
  }

  return { available: provider !== null, start, whenIdle };
}

/**
 * A manual run re-evaluates everything. New evidence re-evaluates every requirement
 * that is not yet proven, plus any requirement the new file's kind is relevant to —
 * including already-PROVEN ones, since new evidence can contradict an earlier decision.
 */
function selectTargets(requirements: Requirement[], evidence: Evidence[], trigger: Trigger) {
  if (trigger.type === 'manual') return requirements;
  const added = evidence.find((item) => item.id === trigger.evidenceId);
  if (!added) return requirements;
  return requirements.filter(
    (requirement) =>
      requirement.status !== 'PROVEN' ||
      requirement.evidenceNeeds.some((need: EvidenceNeed) => need.kind === added.kind),
  );
}

function completionSummary(
  status: WorkOrder['status'],
  requirements: Requirement[],
  requestCount: number,
) {
  const proven = requirements.filter((r) => r.status === 'PROVEN').length;
  const tally = `${proven} of ${requirements.length} requirements proven.`;
  switch (status) {
    case 'VERIFIED':
      return `Verification complete: every mandatory requirement is supported by evidence. ${tally}`;
    case 'CONTRADICTED':
      return `Evidence contradicts at least one requirement; human review is required. ${tally}`;
    default:
      return `Not verified: ${tally} ${requestCount} evidence request(s) open.`;
  }
}
