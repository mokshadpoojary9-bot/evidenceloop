import { HttpError } from '../middleware/errors.js';
import type { WorkOrder, WorkOrderDetail, WorkOrderSummary } from '../types.js';
import type { Db } from './db.js';
import type { FileStore } from './fileStore.js';

// Read models for the work-order API, composed from the generic Db interface.

/** Loads a work order, answering 404 for both "missing" and "not yours". */
export async function getOwnedWorkOrder(db: Db, id: string, ownerId: string): Promise<WorkOrder> {
  const workOrder = await db.get('work_orders', id);
  if (!workOrder || workOrder.ownerId !== ownerId) throw new HttpError(404, 'Work order not found');
  return workOrder;
}

export async function listWorkOrderSummaries(db: Db, ownerId: string): Promise<WorkOrderSummary[]> {
  const workOrders = await db.list('work_orders', { ownerId }, 'createdAt');
  const summaries = await Promise.all(
    workOrders.map(async (workOrder) => {
      const [requirements, openRequests] = await Promise.all([
        db.list('requirements', { workOrderId: workOrder.id }, 'position'),
        db.list('evidence_requests', { workOrderId: workOrder.id, status: 'OPEN' }),
      ]);
      return {
        ...workOrder,
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
): Promise<WorkOrderDetail> {
  const where = { workOrderId: workOrder.id };
  const [requirements, evidence, assessments, requests, runs, audit] = await Promise.all([
    db.list('requirements', where, 'position'),
    db.list('evidence', where, 'createdAt'),
    db.list('assessments', where),
    db.list('evidence_requests', where, 'createdAt'),
    db.list('analysis_runs', where, 'startedAt'),
    db.list('audit_events', where, 'createdAt'),
  ]);
  const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));

  return {
    workOrder,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      assessment: assessmentById.get(requirement.currentAssessmentId ?? '') ?? null,
    })),
    evidence: await Promise.all(
      evidence.map(async (item) => ({ ...item, url: await files.url(item.storagePath) })),
    ),
    requests,
    runs,
    audit,
  };
}
