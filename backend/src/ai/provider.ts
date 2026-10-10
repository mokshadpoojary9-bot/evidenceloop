import type {
  DecisionStatus,
  Evidence,
  EvidenceNeed,
  Observation,
  ProviderId,
  Requirement,
  WorkOrder,
} from '../types.js';

export interface AssessInput {
  workOrder: WorkOrder;
  /** The requirements to (re-)evaluate in this run. */
  requirements: Requirement[];
  /** All evidence currently attached to the work order. */
  evidence: Evidence[];
}

/** What a provider is expected to return for each requirement. */
export interface RawAssessment {
  requirementId: string;
  status: DecisionStatus;
  reasoning: string;
  confidence: number | null;
  observations: Observation[];
  missingEvidence: EvidenceNeed[];
}

/**
 * The seam between the verification engine and AI inference.
 *
 * The production implementation is Nebius Token Factory + NVIDIA Nemotron
 * (`NebiusNemotronProvider`). No other inference provider may be added.
 *
 * `assess` returns `unknown[]` on purpose: the engine never trusts provider
 * output and validates every assessment through the verification policy.
 */
export interface AiProvider {
  readonly id: Exclude<ProviderId, 'none'>;
  readonly model: string | null;
  /** True for the DEV ONLY fixture: its output is simulated, not AI inference. */
  readonly simulated: boolean;
  assess(input: AssessInput): Promise<unknown[]>;
}
