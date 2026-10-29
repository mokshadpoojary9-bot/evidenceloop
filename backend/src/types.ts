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
  'IN_REVIEW', // submitted to a reviewer; frozen until a decision
  'APPROVED', // a reviewer approved it although evidence did not prove everything — a human decision
  'REJECTED', // a reviewer rejected the work
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Work order statuses decided by the verification engine (as opposed to a reviewer). */
export type ComputedStatus = Extract<WorkOrderStatus, 'ANALYZING' | 'NEEDS_EVIDENCE' | 'CONTRADICTED' | 'VERIFIED'>;

export const ROLES = ['technician', 'reviewer'] as const;
/** technician: creates work orders and uploads evidence. reviewer: reads all work orders, decides reviews. */
export type Role = (typeof ROLES)[number];

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
  IN_REVIEW: 'In review',
  APPROVED: 'Approved by reviewer (not AI-verified)',
  REJECTED: 'Rejected by reviewer',
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
  /** The analysis run that planned it; null when a reviewer asked for it. */
  runId: string | null;
  /** `agent`, or `user:<id>` for a reviewer's request. */
  requestedBy: string;
  requirementIds: string[];
  kind: EvidenceKind;
  instruction: string;
  status: 'OPEN' | 'FULFILLED' | 'SUPERSEDED';
  fulfilledByEvidenceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const REVIEW_DECISIONS = ['approve', 'reject', 'request_evidence'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** A request for human sign-off on a contradicted or uncertain work order. */
export interface Review {
  id: string;
  workOrderId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EVIDENCE_REQUESTED';
  /** The work order status when it was submitted. */
  statusAtSubmission: WorkOrderStatus;
  submittedBy: string;
  submissionNote: string;
  submittedAt: string;
  reviewerId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
}

/** One row per user who is not a plain technician; `id` is the auth user id. */
export interface UserRole {
  id: string;
  role: Role;
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

/** The dashboard's count cards, in display order. AWAITING_EVIDENCE is shown as "Draft". */
export const DASHBOARD_BUCKETS = ['VERIFIED', 'NEEDS_EVIDENCE', 'IN_REVIEW', 'CONTRADICTED', 'AWAITING_EVIDENCE'] as const;
export type DashboardBucket = (typeof DASHBOARD_BUCKETS)[number];

export interface DashboardData {
  /** Non-archived work orders the user can see, by status. */
  counts: Record<DashboardBucket, number>;
  /** Open evidence requests, newest first. */
  openRequests: {
    id: string;
    workOrderId: string;
    workOrderTitle: string;
    kind: EvidenceKind;
    instruction: string;
    requirementTitles: string[];
    createdAt: string;
  }[];
  /** Work orders waiting for a reviewer's decision, oldest submission first. */
  awaitingReview: { workOrderId: string; title: string; location: string; submittedAt: string }[];
  /** Technicians: their drafts (no verification run yet), most recently changed first. */
  drafts: { workOrderId: string; title: string; location: string; updatedAt: string }[];
  /** Technicians: contradicted or uncertain work orders they can submit for review now. */
  readyForReview: { workOrderId: string; title: string; status: WorkOrderStatus }[];
  /** The latest audit events across the user's work orders, newest first. */
  activity: {
    id: string;
    workOrderId: string;
    workOrderTitle: string;
    type: string;
    summary: string;
    /** "You", "Agent", "System", "Reviewer", "Technician" — never an email or id. */
    actor: string;
    createdAt: string;
  }[];
}

/** Why a work order is in the reviewer's queue. */
export const QUEUE_REASONS = ['IN_REVIEW', 'CONTRADICTED', 'UNCERTAIN'] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

/** One row of the reviewer's queue (GET /api/reviewer/queue). */
export interface ReviewQueueItem {
  workOrderId: string;
  title: string;
  location: string;
  status: WorkOrderStatus;
  reason: QueueReason;
  simulated: boolean;
  /** The owning technician's name (or email when they have no name). */
  technician: string;
  /** When the pending review was submitted; null while the technician has not submitted it. */
  submittedAt: string | null;
  submissionNote: string | null;
  requirementStatuses: RequirementStatus[];
  /** Whether this reviewer can decide now; otherwise `blocker` says why. */
  canDecide: boolean;
  blocker: string | null;
  updatedAt: string;
}

/** One event in the reviewer's audit log (GET /api/reviewer/audit-log). */
export interface AuditLogEntry {
  id: string;
  workOrderId: string;
  workOrderTitle: string;
  type: string;
  summary: string;
  /** "Agent", "System", or the person's name. */
  actor: string;
  actorRole: 'agent' | 'system' | Role;
  createdAt: string;
}

/** What the upload-time check found in a PDF. Without a text layer (a scan) the AI cannot read it. */
export interface PdfFacts {
  pages: number | null;
  textLayer: boolean;
}

export interface WorkOrderDetail {
  workOrder: WorkOrder;
  requirements: (Requirement & { assessment: Assessment | null })[];
  /** `pdf` is null for other files, and for PDFs uploaded before the check existed. */
  evidence: (Evidence & { url: string | null; pdf: PdfFacts | null })[];
  requests: EvidenceRequest[];
  runs: AnalysisRun[];
  audit: AuditEvent[];
  reviews: Review[];
  /** What the current user may do with this work order, decided by the backend. */
  permissions: WorkOrderPermissions;
}

export interface WorkOrderPermissions {
  /** Edit, archive, delete, add requirements, run verification. Owner technician only. */
  manage: boolean;
  upload: boolean;
  submitForReview: boolean;
  /** Decide the pending review. Reviewers only, never the person who submitted it. */
  review: boolean;
  /** Why an action is unavailable, for the UI. */
  reasons: Partial<Record<'manage' | 'upload' | 'submitForReview' | 'review', string>>;
}

export interface Viewer {
  id: string;
  email: string | null;
  role: Role;
  /** `demo` = local development role switcher; `supabase` = assigned in public.user_roles. */
  roleSource: 'demo' | 'supabase';
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

export interface ReadinessCheck {
  ok: boolean;
  /** A short reason. Never a configuration value. */
  detail: string;
}

/** GET /api/health/ready: what this backend can actually reach and run (AI is in SystemStatus). */
export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: ReadinessCheck;
    storage: ReadinessCheck;
    video: ReadinessCheck;
    pdf: ReadinessCheck;
  };
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
