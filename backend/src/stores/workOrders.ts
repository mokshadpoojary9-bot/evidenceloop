import type { AuthUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type {
  Requirement,
  Review,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderPermissions,
  WorkOrderSummary,
} from '../types.js';
import type { Db } from './db.js';
import type { FileStore } from './fileStore.js';

// Read models and access rules for the work-order API, composed from the generic Db interface.
//
// Access model (mirrored by Row Level Security in supabase/schema.sql):
//   * technicians see and change only the work orders they created;
//   * reviewers can read every work order and decide pending reviews, but change nothing else.

/** Rows written before a column existed (local store) get its default. */
const normalize = (workOrder: WorkOrder): WorkOrder => ({ ...workOrder, archivedAt: workOrder.archivedAt ?? null });

const canRead = (workOrder: WorkOrder, user: AuthUser) => workOrder.ownerId === user.id || user.role === 'reviewer';

/** Loads a work order the user may read, answering 404 for both "missing" and "not yours". */
export async function getAccessibleWorkOrder(db: Db, id: string, user: AuthUser): Promise<WorkOrder> {
  const workOrder = await db.get('work_orders', id);
  if (!workOrder || !canRead(workOrder, user)) throw new HttpError(404, 'Work order not found');
  return normalize(workOrder);
}

/** Loads a work order the user may change: its owner, acting as a technician. */
export async function getManagedWorkOrder(db: Db, id: string, user: AuthUser): Promise<WorkOrder> {
  const workOrder = await getAccessibleWorkOrder(db, id, user);
  const reason = manageBlocker(workOrder, user);
  if (reason) throw new HttpError(403, reason, 'FORBIDDEN');
  return workOrder;
}

function manageBlocker(workOrder: WorkOrder, user: AuthUser): string | undefined {
  if (user.role !== 'technician') return 'Reviewers cannot change work orders or upload evidence.';
  if (workOrder.ownerId !== user.id) return 'Only the technician who created this work order can change it.';
  return undefined;
}

export const pendingReview = (reviews: Review[]) => reviews.find((review) => review.status === 'PENDING');

/** Contradicted work orders, or ones with an uncertain requirement, can be sent to a reviewer. */
export function reviewEligibility(workOrder: WorkOrder, requirements: Pick<Requirement, 'status'>[]): string | undefined {
  if (workOrder.status === 'CONTRADICTED') return undefined;
  if (workOrder.status === 'NEEDS_EVIDENCE' && requirements.some((r) => r.status === 'UNCERTAIN')) return undefined;
  return 'Only contradicted work orders, or ones with an uncertain requirement, can be submitted for review.';
}

export function permissionsFor(
  workOrder: WorkOrder,
  user: AuthUser,
  requirements: Pick<Requirement, 'status'>[],
  reviews: Review[],
): WorkOrderPermissions {
  const reasons: WorkOrderPermissions['reasons'] = {};
  const pending = pendingReview(reviews);
  const archived = workOrder.archivedAt !== null;

  const manageReason = manageBlocker(workOrder, user);
  if (manageReason) reasons.manage = manageReason;

  reasons.upload =
    manageReason ??
    (archived
      ? 'This work order is archived.'
      : workOrder.status === 'IN_REVIEW'
        ? 'This work order is with a reviewer. Uploads resume after their decision.'
        : undefined);

  reasons.submitForReview =
    manageReason ??
    (archived ? 'This work order is archived.' : pending ? 'A review is already pending.' : reviewEligibility(workOrder, requirements));

  reasons.review =
    user.role !== 'reviewer'
      ? 'Only reviewers can decide reviews.'
      : !pending
        ? 'There is no pending review.'
        : pending.submittedBy === user.id
          ? 'You cannot review a work order you submitted.'
          : archived
            ? 'This work order is archived.'
            : undefined;

  for (const key of Object.keys(reasons) as (keyof typeof reasons)[]) {
    if (reasons[key] === undefined) delete reasons[key];
  }
  return {
    manage: !reasons.manage,
    upload: !reasons.upload,
    submitForReview: !reasons.submitForReview,
    review: !reasons.review,
    reasons,
  };
}

export async function listWorkOrderSummaries(db: Db, user: AuthUser): Promise<WorkOrderSummary[]> {
  const workOrders =
    user.role === 'reviewer'
      ? await db.list('work_orders', {}, 'createdAt')
      : await db.list('work_orders', { ownerId: user.id }, 'createdAt');
  const summaries = await Promise.all(
    workOrders.map(async (workOrder) => {
      const [requirements, openRequests] = await Promise.all([
        db.list('requirements', { workOrderId: workOrder.id }, 'position'),
        db.list('evidence_requests', { workOrderId: workOrder.id, status: 'OPEN' }),
      ]);
      return {
        ...normalize(workOrder),
        requirementStatuses: requirements.map((requirement) => requirement.status),
        openRequestCount: openRequests.length,
      };
    }),
  );
  return summaries.reverse(); // newest first
}

export async function getWorkOrderDetail(
  db: Db,
  files: FileStore,
  workOrder: WorkOrder,
  user: AuthUser,
): Promise<WorkOrderDetail> {
  const where = { workOrderId: workOrder.id };
  const [requirements, evidence, assessments, requests, runs, audit, reviews] = await Promise.all([
    db.list('requirements', where, 'position'),
    db.list('evidence', where, 'createdAt'),
    db.list('assessments', where),
    db.list('evidence_requests', where, 'createdAt'),
    db.list('analysis_runs', where, 'startedAt'),
    db.list('audit_events', where, 'createdAt'),
    db.list('reviews', where, 'submittedAt'),
  ]);
  const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const current = normalize(workOrder);

  return {
    workOrder: current,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      assessment: assessmentById.get(requirement.currentAssessmentId ?? '') ?? null,
    })),
    evidence: await Promise.all(
      evidence.map(async (item) => ({ ...item, url: await files.url(item.storagePath) })),
    ),
    requests: requests.map((request) => ({ ...request, requestedBy: request.requestedBy ?? 'agent' })),
    runs,
    audit,
    reviews,
    permissions: permissionsFor(current, user, requirements, reviews),
  };
}
