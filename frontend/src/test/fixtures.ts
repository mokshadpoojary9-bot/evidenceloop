// Test-only builders for API shapes.
import type {
  Assessment,
  Review,
  SystemStatus,
  WorkOrderDetail,
  WorkOrderPermissions,
  WorkOrderSummary,
} from '../types';

const T = '2026-10-01T10:00:00.000Z';

export const NO_PERMISSIONS: WorkOrderPermissions = {
  manage: false,
  upload: false,
  submitForReview: false,
  review: false,
  reasons: {},
};

export function summary(overrides: Partial<WorkOrderSummary> = {}): WorkOrderSummary {
  return {
    id: crypto.randomUUID(),
    ownerId: 'owner',
    title: 'Replace emergency light in Room 204',
    description: '',
    location: 'Room 204',
    templateId: null,
    status: 'AWAITING_EVIDENCE',
    simulated: false,
    archivedAt: null,
    createdAt: T,
    updatedAt: T,
    requirementStatuses: [],
    openRequestCount: 0,
    ...overrides,
  };
}

export function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'as-1',
    workOrderId: 'wo-1',
    requirementId: 'req-1',
    runId: 'run-1',
    status: 'PROVEN',
    reasoning: 'Seen in the video.',
    confidence: null,
    observations: [],
    missingEvidence: [],
    policyNotes: [],
    provider: 'nebius-nemotron',
    model: 'nvidia/test',
    simulated: false,
    createdAt: T,
    ...overrides,
  };
}

export function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 'rv-1',
    workOrderId: 'wo-1',
    status: 'PENDING',
    statusAtSubmission: 'CONTRADICTED',
    submittedBy: 'tech',
    submissionNote: 'Bracket looks loose',
    submittedAt: T,
    reviewerId: null,
    decisionNote: null,
    decidedAt: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    workOrder: summary({ id: 'wo-1', status: 'CONTRADICTED' }),
    requirements: [
      {
        id: 'req-1',
        workOrderId: 'wo-1',
        position: 1,
        title: 'Functional test completed',
        description: '',
        mandatory: true,
        evidenceNeeds: [],
        status: 'PROVEN',
        currentAssessmentId: 'as-1',
        updatedAt: T,
        assessment: null,
      },
    ],
    evidence: [
      {
        id: 'ev-video',
        workOrderId: 'wo-1',
        kind: 'video',
        fileName: 'test.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        sha256: 'a'.repeat(64),
        storagePath: 'wo-1/ev-video/test.mp4',
        note: 'Pressed the test button',
        requestId: null,
        uploadedBy: 'tech',
        createdAt: T,
        url: '/api/files/wo-1/ev-video/test.mp4',
        pdf: null,
      },
    ],
    requests: [],
    runs: [],
    audit: [],
    reviews: [],
    permissions: NO_PERMISSIONS,
    ...overrides,
  };
}

export function system(ai: Partial<SystemStatus['ai']> = {}): SystemStatus {
  return {
    status: 'ok',
    ai: {
      mode: 'nebius',
      production: true,
      provider: 'nebius-nemotron',
      model: 'nvidia/nemotron-nano-vl',
      message: '',
      live: { state: 'connected', vision: true, checkedAt: T, detail: null },
      ...ai,
    },
    persistence: 'local',
    auth: 'disabled',
    maxUploadMb: 50,
  };
}
