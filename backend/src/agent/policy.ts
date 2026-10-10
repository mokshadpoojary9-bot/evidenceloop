import { z } from 'zod';
import {
  CANNOT_VERIFY,
  DECISION_STATUSES,
  EVIDENCE_KINDS,
  type DecisionStatus,
  type EvidenceNeed,
  type Observation,
  type Requirement,
  type WorkOrderStatus,
} from '../types.js';

/**
 * The verification policy: code-enforced rules applied to every provider answer.
 * The model proposes; this decides. It can only ever make a decision *more*
 * cautious — it never upgrades a status and never invents confidence.
 */

export interface Decision {
  status: DecisionStatus;
  reasoning: string;
  confidence: number | null;
  observations: Observation[];
  missingEvidence: EvidenceNeed[];
  policyNotes: string[];
}

const observationSchema = z.object({
  evidenceId: z.string(),
  kind: z.enum(['direct', 'inferred']),
  text: z.string().trim().min(1),
  startSec: z.number().nullish(),
  endSec: z.number().nullish(),
});

const needSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  instruction: z.string().trim().min(1),
});

const rawSchema = z.object({
  requirementId: z.string(),
  status: z.enum(DECISION_STATUSES),
  reasoning: z.string().trim().min(1),
  confidence: z.unknown().optional(),
  observations: z.array(z.unknown()).default([]),
  missingEvidence: z.array(z.unknown()).default([]),
});

/** Indexes a provider's raw output by requirement id, ignoring entries without one. */
export function indexRawAssessments(raw: unknown[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const entry of raw) {
    const id = (entry as { requirementId?: unknown } | null)?.requirementId;
    if (typeof id === 'string' && !byId.has(id)) byId.set(id, entry);
  }
  return byId;
}

const cannotVerify = (reasoning: string) =>
  reasoning.includes(CANNOT_VERIFY) ? reasoning : `${CANNOT_VERIFY} ${reasoning}`.trim();

export function notProven(reason: string, note?: string): Decision {
  return {
    status: 'NOT_PROVEN',
    reasoning: cannotVerify(reason),
    confidence: null,
    observations: [],
    missingEvidence: [],
    policyNotes: note ? [note] : [],
  };
}

export function applyPolicy(
  requirement: Requirement,
  raw: unknown,
  evidenceIds: ReadonlySet<string>,
): Decision {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success || parsed.data.requirementId !== requirement.id) {
    return notProven(
      'The AI provider returned no valid assessment for this requirement.',
      'No valid provider assessment; defaulted to NOT_PROVEN.',
    );
  }

  const notes: string[] = [];
  const data = parsed.data;

  // Observations must be well-formed and cite evidence that actually exists.
  const observations: Observation[] = [];
  for (const candidate of data.observations) {
    const observation = observationSchema.safeParse(candidate);
    if (!observation.success) {
      notes.push('Dropped a malformed observation.');
      continue;
    }
    if (!evidenceIds.has(observation.data.evidenceId)) {
      notes.push('Dropped an observation that cited evidence not attached to this work order.');
      continue;
    }
    let { startSec = null, endSec = null } = observation.data;
    if ((startSec !== null && startSec < 0) || (endSec !== null && endSec < (startSec ?? 0))) {
      notes.push('Dropped an invalid timestamp range from an observation.');
      startSec = null;
      endSec = null;
    }
    observations.push({ ...observation.data, startSec, endSec });
  }

  // A decision is only as strong as the observations behind it.
  let status = data.status;
  const hasDirect = observations.some((observation) => observation.kind === 'direct');
  if (status === 'PROVEN' && !hasDirect) {
    status = observations.length > 0 ? 'UNCERTAIN' : 'NOT_PROVEN';
    notes.push(
      `Provider said PROVEN without a direct observation of attached evidence; downgraded to ${status}.`,
    );
  }
  if (status === 'CONTRADICTED' && observations.length === 0) {
    status = 'UNCERTAIN';
    notes.push(
      'Provider said CONTRADICTED without citing any attached evidence; downgraded to UNCERTAIN.',
    );
  }

  // Confidence is passed through or dropped — never synthesized.
  let confidence: number | null = null;
  if (typeof data.confidence === 'number') {
    if (data.confidence >= 0 && data.confidence <= 1) confidence = data.confidence;
    else notes.push('Dropped a confidence value outside the 0–1 range.');
  }
  if (status !== data.status && confidence !== null) {
    confidence = null;
    notes.push('Dropped the confidence value because it described the overridden status.');
  }

  const resolved = status === 'PROVEN';
  const missingEvidence = resolved
    ? []
    : data.missingEvidence.flatMap((candidate) => {
        const need = needSchema.safeParse(candidate);
        return need.success ? [need.data] : [];
      });

  return {
    status,
    reasoning:
      status === 'NOT_PROVEN' || status === 'UNCERTAIN'
        ? cannotVerify(data.reasoning)
        : data.reasoning,
    confidence,
    observations,
    missingEvidence,
    policyNotes: notes,
  };
}

/**
 * VERIFIED requires every mandatory requirement to be PROVEN. Any contradiction,
 * mandatory or not, blocks verification until a person has looked at it.
 */
export function overallStatus(
  requirements: Pick<Requirement, 'mandatory' | 'status'>[],
): Exclude<WorkOrderStatus, 'AWAITING_EVIDENCE'> {
  if (requirements.some((r) => r.status === 'ANALYZING')) return 'ANALYZING';
  if (requirements.some((r) => r.status === 'CONTRADICTED')) return 'CONTRADICTED';
  const mandatory = requirements.filter((r) => r.mandatory);
  return mandatory.length > 0 && mandatory.every((r) => r.status === 'PROVEN')
    ? 'VERIFIED'
    : 'NEEDS_EVIDENCE';
}
