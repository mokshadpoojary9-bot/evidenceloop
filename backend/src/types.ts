// EvidenceLoop domain model — the single source of truth for both workspaces.
// The frontend imports this file through the `@domain` alias, so it must stay
// free of Node-specific imports.

// ---------- Statuses ----------

export const DECISION_STATUSES = ['PROVEN', 'NOT_PROVEN', 'UNCERTAIN', 'CONTRADICTED'] as const;
/** A status a verification decision can end in. */
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
/** What a requirement shows at any moment: a decision, or ANALYZING while a run is in flight. */
export type RequirementStatus = DecisionStatus | 'ANALYZING';

export const WORK_ORDER_STATUSES = [
  'AWAITING_EVIDENCE', // no verification run has completed yet
  'ANALYZING',
  'NEEDS_EVIDENCE', // at least one mandatory requirement is not proven
  'CONTRADICTED', // evidence conflicts with a requirement — needs human review
  'VERIFIED', // every mandatory requirement is PROVEN
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const EVIDENCE_KINDS = [
  'before_photo',
  'after_photo',
  'additional_photo',
  'video',
  'document',
  'audio',
  'transcript',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  before_photo: 'Before photo',
  after_photo: 'After photo',
  additional_photo: 'Additional photo',
  video: 'Video',
  document: 'SOP / manual',
  audio: 'Audio',
  transcript: 'Transcript',
};

/** MIME type prefixes accepted for each evidence kind. */
export const EVIDENCE_KIND_MIME: Record<EvidenceKind, string[]> = {
  before_photo: ['image/'],
  after_photo: ['image/'],
  additional_photo: ['image/'],
  video: ['video/'],
  document: ['application/pdf', 'text/'],
  audio: ['audio/'],
  transcript: ['text/'],
};

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  PROVEN: 'Proven',
  NOT_PROVEN: 'Not proven',
  UNCERTAIN: 'Uncertain',
  CONTRADICTED: 'Contradicted',
  ANALYZING: 'Analyzing',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  AWAITING_EVIDENCE: 'Awaiting evidence',
  ANALYZING: 'Analyzing',
  NEEDS_EVIDENCE: 'Not verified — evidence needed',
  CONTRADICTED: 'Contradicted — review required',
  VERIFIED: 'Verified',
};

/** The exact sentence used whenever a requirement cannot be verified. */
export const CANNOT_VERIFY = 'I cannot verify this requirement from the available evidence.';

export const DISCLAIMER =
  'EvidenceLoop assists verification. It does not replace qualified inspectors or certification, and it does not guarantee physical safety.';

// ---------- Entities ----------

/** A kind of evidence that would help prove a requirement, with an actionable instruction. */
export interface EvidenceNeed {
  kind: EvidenceKind;
  instruction: string;
}

export interface WorkOrder {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  location: string;
  templateId: string | null;
  status: WorkOrderStatus;
  /** True when the current status came from the DEV ONLY fixture rather than real AI inference. */
  simulated: boolean;
  /** Archived work orders are read-only and hidden from the default list. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Requirement {
  id: string;
  workOrderId: string;
  position: number;
  title: string;
  description: string;
  mandatory: boolean;
  evidenceNeeds: EvidenceNeed[];
  status: RequirementStatus;
  currentAssessmentId: string | null;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  workOrderId: string;
  kind: EvidenceKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Content hash recorded at upload so the audit trail can show the file was not swapped. */
  sha256: string;
  storagePath: string;
  note: string;
  /** The evidence request this upload answers, if any. */
  requestId: string | null;
  uploadedBy: string;
  createdAt: string;
}

export interface Observation {
  evidenceId: string;
  /** `direct` = visible/audible/readable in the evidence. `inferred` = concluded from it. */
  kind: 'direct' | 'inferred';
  text: string;
  /** Temporal grounding for video/audio evidence, in seconds. */
  startSec: number | null;
  endSec: number | null;
}

export type ProviderId = 'nebius-nemotron' | 'dev-fixture' | 'none';

/** Requirement → Evidence → Observation → Reasoning → Decision. Append-only. */
export interface Assessment {
  id: string;
  workOrderId: string;
  requirementId: string;
  runId: string;
  status: DecisionStatus;
  reasoning: string;
  /** Reported by the model, never computed. `null` when the provider reported none. */
  confidence: number | null;
  observations: Observation[];
  missingEvidence: EvidenceNeed[];
  /** Adjustments the verification policy made to the provider's raw answer. */
  policyNotes: string[];
  provider: ProviderId;
  model: string | null;
  simulated: boolean;
  createdAt: string;
}

export interface AnalysisRun {
  id: string;
  workOrderId: string;
  trigger: 'manual' | 'new_evidence';
  triggerEvidenceId: string | null;
  /** Requirements re-evaluated in this run. */
  requirementIds: string[];
  provider: ProviderId;
  model: string | null;
  simulated: boolean;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface EvidenceRequest {
  id: string;
  workOrderId: string;
  runId: string;
  requirementIds: string[];
  kind: EvidenceKind;
  instruction: string;
  status: 'OPEN' | 'FULFILLED' | 'SUPERSEDED';
  fulfilledByEvidenceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  workOrderId: string;
  runId: string | null;
  /** `user:<id>`, `agent`, or `system`. */
  actor: string;
  type: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// ---------- API contracts ----------

export interface TemplateRequirement {
  title: string;
  description: string;
  mandatory: boolean;
  evidenceNeeds: EvidenceNeed[];
}

export interface WorkOrderTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  location: string;
  requirements: TemplateRequirement[];
}

export interface NewWorkOrderInput {
  title: string;
  description: string;
  location: string;
  templateId: string | null;
  requirements: TemplateRequirement[];
}

/** A requirement proposed from an SOP. Nothing is saved until a person confirms it. */
export interface RequirementProposal extends TemplateRequirement {
  /** The SOP passage the requirement was taken from, verbatim. */
  sourceQuote: string;
}

export interface RequirementDraftResponse {
  proposals: RequirementProposal[];
  /** True when the DEV ONLY fixture produced the list — no AI read the SOP. */
  simulated: boolean;
  provider: ProviderId;
  model: string | null;
  source: { fileName: string; pages: number | null; chars: number; truncated: boolean };
  /** Proposals discarded because their quote was not found in the SOP, or they were malformed. */
  dropped: number;
}

export interface AddRequirementsInput {
  requirements: TemplateRequirement[];
  source: { kind: 'sop'; fileName: string; simulated: boolean } | { kind: 'manual' };
}

export interface WorkOrderSummary extends WorkOrder {
  requirementStatuses: RequirementStatus[];
  openRequestCount: number;
}

export interface WorkOrderDetail {
  workOrder: WorkOrder;
  requirements: (Requirement & { assessment: Assessment | null })[];
  evidence: (Evidence & { url: string | null })[];
  requests: EvidenceRequest[];
  runs: AnalysisRun[];
  audit: AuditEvent[];
}

export type AiMode = 'nebius' | 'dev-fixture' | 'unconfigured';

export interface LiveAiStatus {
  state: 'not_configured' | 'checking' | 'connected' | 'failed';
  /** Whether the image request succeeded; null until tested. */
  vision: boolean | null;
  checkedAt: string | null;
  /** Failure reason, never containing a key. */
  detail: string | null;
}

export interface SystemStatus {
  status: 'ok';
  ai: {
    mode: AiMode;
    /** True only when Nebius Token Factory + NVIDIA Nemotron is configured. */
    production: boolean;
    provider: ProviderId;
    model: string | null;
    message: string;
    /**
     * Result of the live connection test the backend runs at startup when Nebius is
     * configured. "connected" only after a real text and image request succeeded.
     */
    live: LiveAiStatus;
  };
  persistence: 'supabase' | 'local';
  auth: 'supabase' | 'disabled';
  maxUploadMb: number;
}

export type ReanalysisOutcome =
  | 'started'
  | 'queued'
  | 'skipped_no_prior_run'
  | 'skipped_ai_not_configured';

export interface UploadEvidenceResponse {
  evidence: Evidence;
  reanalysis: ReanalysisOutcome;
}
