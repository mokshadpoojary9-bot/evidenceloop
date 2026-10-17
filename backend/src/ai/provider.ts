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

export interface DraftInput {
  /** Text extracted from the SOP/manual, already capped. */
  sopText: string;
  /** True when the SOP was longer than the text supplied. */
  truncated: boolean;
  /** What the work order is about, to focus the proposals. May be blank. */
  context: { title: string; description: string; location: string };
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
  /**
   * Proposes requirements from an SOP. Returns raw proposals; `agent/sopDraft.ts`
   * validates them and drops any whose quote is not in the SOP.
   */
  draftRequirements(input: DraftInput): Promise<unknown[]>;
}
