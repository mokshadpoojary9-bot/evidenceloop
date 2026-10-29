import type { AuthUser } from '../middleware/auth.js';
import type { QueueReason, ReviewQueueItem, WorkOrderSummary } from '../types.js';
import type { Db } from './db.js';
import type { People } from './people.js';
import { listWorkOrderSummaries, pendingReview, permissionsFor, reviewEligibility } from './workOrders.js';

export function queueReason(workOrder: WorkOrderSummary): QueueReason | null {
  if (workOrder.archivedAt !== null) return null;
  if (workOrder.status === 'IN_REVIEW') return 'IN_REVIEW';
  if (reviewEligibility(workOrder, workOrder.requirementStatuses.map((status) => ({ status })))) return null;
  return workOrder.status === 'CONTRADICTED' ? 'CONTRADICTED' : 'UNCERTAIN';
}

/**
 * The reviewer's queue: in-review, contradicted and uncertain work orders from every
 * technician. Submitted ones first (oldest submission first), then the rest, newest change first.
 */
export async function getReviewQueue(db: Db, user: AuthUser, people: People): Promise<ReviewQueueItem[]> {
  const summaries = await listWorkOrderSummaries(db, user);
  const items = await Promise.all(
    summaries.flatMap((workOrder) => {
      const reason = queueReason(workOrder);
      if (!reason) return [];
      return [
        (async (): Promise<ReviewQueueItem> => {
          const reviews = await db.list('reviews', { workOrderId: workOrder.id }, 'submittedAt');
          const pending = pendingReview(reviews);
          const permissions = permissionsFor(workOrder, user, workOrder.requirementStatuses.map((status) => ({ status })), reviews);
          return {
            workOrderId: workOrder.id,
            title: workOrder.title,
            location: workOrder.location,
            status: workOrder.status,
            reason,
            simulated: workOrder.simulated,
            technician: (await people.get(workOrder.ownerId)).name,
            submittedAt: pending?.submittedAt ?? null,
            submissionNote: pending?.submissionNote || null,
            requirementStatuses: workOrder.requirementStatuses,
            canDecide: permissions.review,
            blocker: permissions.reasons.review ?? null,
            updatedAt: workOrder.updatedAt,
          };
        })(),
      ];
    }),
  );
  items.sort((a, b) => {
    if (a.submittedAt && b.submittedAt) return a.submittedAt < b.submittedAt ? -1 : 1;
    if (a.submittedAt || b.submittedAt) return a.submittedAt ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
  return items;
}
