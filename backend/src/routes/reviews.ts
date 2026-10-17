import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { audit, now } from '../agent/audit.js';
import { overallStatus } from '../agent/policy.js';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type { Db } from '../stores/db.js';
import type { FileStore } from '../stores/fileStore.js';
import {
  getAccessibleWorkOrder,
  getManagedWorkOrder,
  getWorkOrderDetail,
  pendingReview,
  permissionsFor,
} from '../stores/workOrders.js';
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  REVIEW_DECISIONS,
  type EvidenceRequest,
  type Review,
  type WorkOrderStatus,
} from '../types.js';

const idParam = (value: unknown) => {
  const id = z.uuid().safeParse(value);
  if (!id.success) throw new HttpError(404, 'Work order not found');
  return id.data;
};

const submitSchema = z.object({ note: z.string().trim().max(2000).default('') });

const decisionSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    note: z.string().trim().min(3, 'Explain the decision in a note').max(2000),
    request: z
      .object({
        kind: z.enum(EVIDENCE_KINDS),
        instruction: z.string().trim().min(5, 'Say exactly what evidence is needed').max(500),
      })
      .optional(),
  })
  .refine((body) => body.decision !== 'request_evidence' || body.request, {
    message: 'Say which evidence is needed',
    path: ['request'],
  });

/**
 * Reviewer sign-off for work orders the evidence could not settle.
 *
 *   technician:  CONTRADICTED / NEEDS_EVIDENCE with an UNCERTAIN requirement → submit → IN_REVIEW
 *   reviewer:    approve (with note) → APPROVED · reject → REJECTED · request evidence → back to the technician
 *
 * APPROVED is a human decision and is labelled as such; it is never shown as VERIFIED.
 * Every step is in the audit trail. Roles are enforced here, and again in the
 * database by a trigger on public.reviews (see supabase/schema.sql).
 */
export function createReviewsRouter({ db, files }: { db: Db; files: FileStore }) {
  const router = Router();

  router.post('/:id/reviews', async (req, res) => {
    const user = currentUser(res);
    const workOrder = await getManagedWorkOrder(db, idParam(req.params.id), user);
    const { note } = submitSchema.parse(req.body ?? {});
    const [requirements, reviews] = await Promise.all([
      db.list('requirements', { workOrderId: workOrder.id }),
      db.list('reviews', { workOrderId: workOrder.id }),
    ]);
    const permissions = permissionsFor(workOrder, user, requirements, reviews);
    if (!permissions.submitForReview) throw new HttpError(409, permissions.reasons.submitForReview!, 'NOT_REVIEWABLE');

    const review: Review = {
      id: randomUUID(),
      workOrderId: workOrder.id,
      status: 'PENDING',
      statusAtSubmission: workOrder.status,
      submittedBy: user.id,
      submissionNote: note,
      submittedAt: now(),
      reviewerId: null,
      decisionNote: null,
      decidedAt: null,
    };
    await db.insert('reviews', review);
    await db.update('work_orders', workOrder.id, { status: 'IN_REVIEW', updatedAt: now() });
    const unresolved = requirements.filter((r) => r.status === 'CONTRADICTED' || r.status === 'UNCERTAIN');
    await audit(db, {
      workOrderId: workOrder.id,
      actor: `user:${user.id}`,
      type: 'REVIEW_REQUESTED',
      summary:
        `Submitted for review (${workOrder.status}): ${unresolved.length} requirement(s) contradicted or uncertain.` +
        (note ? ` Note: ${note}` : ''),
      data: { reviewId: review.id, actorRole: user.role, from: workOrder.status, requirementIds: unresolved.map((r) => r.id) },
    });

    res.status(201).json(await getWorkOrderDetail(db, files, (await db.get('work_orders', workOrder.id))!, user));
  });

  router.post('/:id/reviews/decision', async (req, res) => {
    const user = currentUser(res);
    const workOrder = await getAccessibleWorkOrder(db, idParam(req.params.id), user);
    const body = decisionSchema.parse(req.body);
    const [requirements, reviews] = await Promise.all([
      db.list('requirements', { workOrderId: workOrder.id }, 'position'),
      db.list('reviews', { workOrderId: workOrder.id }),
    ]);
    const permissions = permissionsFor(workOrder, user, requirements, reviews);
    if (!permissions.review) {
      throw new HttpError(user.role === 'reviewer' ? 409 : 403, permissions.reasons.review!, 'CANNOT_REVIEW');
    }
    const review = pendingReview(reviews)!;
    const unproven = requirements.filter((r) => r.mandatory && r.status !== 'PROVEN');
    const timestamp = now();

    let status: WorkOrderStatus;
    let reviewStatus: Review['status'];
    let summary: string;
    let requestId: string | null = null;

    switch (body.decision) {
      case 'approve':
        status = 'APPROVED';
        reviewStatus = 'APPROVED';
        summary =
          `Approved by reviewer. This is a human decision, not AI verification: ${unproven.length} mandatory ` +
          `requirement(s) were not proven by the evidence (${unproven.map((r) => `#${r.position}`).join(', ') || 'none'}). ` +
          `Note: ${body.note}`;
        break;
      case 'reject':
        status = 'REJECTED';
        reviewStatus = 'REJECTED';
        summary = `Rejected by reviewer. Note: ${body.note}`;
        break;
      case 'request_evidence': {
        // Back to the technician: the work order returns to its evidence-driven status.
        status = overallStatus(requirements);
        reviewStatus = 'EVIDENCE_REQUESTED';
        const request: EvidenceRequest = {
          id: randomUUID(),
          workOrderId: workOrder.id,
          runId: null,
          requestedBy: `user:${user.id}`,
          requirementIds: requirements.filter((r) => r.status !== 'PROVEN').map((r) => r.id),
          kind: body.request!.kind,
          instruction: body.request!.instruction,
          status: 'OPEN',
          fulfilledByEvidenceId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.insert('evidence_requests', request);
        requestId = request.id;
        summary =
          `Reviewer requested more evidence (${EVIDENCE_KIND_LABELS[request.kind]}): ${request.instruction} ` +
          `Note: ${body.note}`;
        break;
      }
    }

    await db.update('reviews', review.id, {
      status: reviewStatus,
      reviewerId: user.id,
      decisionNote: body.note,
      decidedAt: timestamp,
    });
    await db.update('work_orders', workOrder.id, { status, updatedAt: now() });
    await audit(db, {
      workOrderId: workOrder.id,
      actor: `user:${user.id}`,
      type: body.decision === 'approve' ? 'REVIEW_APPROVED' : body.decision === 'reject' ? 'REVIEW_REJECTED' : 'REVIEW_EVIDENCE_REQUESTED',
      summary,
      data: {
        reviewId: review.id,
        actorRole: user.role,
        decision: body.decision,
        note: body.note,
        from: workOrder.status,
        to: status,
        requestId,
        unprovenRequirementIds: unproven.map((r) => r.id),
      },
    });

    res.json(await getWorkOrderDetail(db, files, (await db.get('work_orders', workOrder.id))!, user));
  });

  return router;
}
