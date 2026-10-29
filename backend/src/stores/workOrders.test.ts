import { describe, expect, it } from 'vitest';
import { LOCAL_DEV_USER, LOCAL_REVIEWER, type AuthUser } from '../middleware/auth.js';
import type { Review, WorkOrder } from '../types.js';
import { LocalDb } from './localDb.js';
import { getAccessibleWorkOrder, getManagedWorkOrder, permissionsFor } from './workOrders.js';

// Roles come only from the server (public.user_roles); these rules decide what each may do.

const owner = LOCAL_DEV_USER;
const otherTechnician: AuthUser = { ...LOCAL_DEV_USER, id: '00000000-0000-4000-8000-0000000000aa', email: null };

const workOrder: WorkOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: owner.id,
  title: 'Replace emergency light',
  description: '',
  location: 'Room 204',
  templateId: null,
  status: 'IN_REVIEW',
  simulated: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const pending: Review = {
  id: '22222222-2222-4222-8222-222222222222',
  workOrderId: workOrder.id,
  status: 'PENDING',
  statusAtSubmission: 'CONTRADICTED',
  submittedBy: owner.id,
  submissionNote: '',
  submittedAt: '2026-10-02T00:00:00.000Z',
  reviewerId: null,
  decisionNote: null,
  decidedAt: null,
};
const requirements = [{ status: 'CONTRADICTED' as const }];

describe('work order permissions', () => {
  it('never lets a technician decide a review, even on their own work order', () => {
    const permissions = permissionsFor(workOrder, owner, requirements, [pending]);
    expect(permissions.review).toBe(false);
    expect(permissions.reasons.review).toBe('Only reviewers can decide reviews.');
  });

  it('never lets a reviewer upload, analyze or submit, but lets them decide', () => {
    const contradicted = { ...workOrder, status: 'CONTRADICTED' as const };
    const permissions = permissionsFor(contradicted, LOCAL_REVIEWER, requirements, []);
    expect(permissions).toMatchObject({ manage: false, upload: false, submitForReview: false });
    expect(permissionsFor(workOrder, LOCAL_REVIEWER, requirements, [pending]).review).toBe(true);
  });

  it("hides another technician's work order and refuses changes to it", async () => {
    const db = new LocalDb();
    await db.insert('work_orders', workOrder);
    await expect(getAccessibleWorkOrder(db, workOrder.id, otherTechnician)).rejects.toMatchObject({ status: 404 });
    await expect(getManagedWorkOrder(db, workOrder.id, otherTechnician)).rejects.toMatchObject({ status: 404 });
    await expect(getManagedWorkOrder(db, workOrder.id, LOCAL_REVIEWER)).rejects.toMatchObject({ status: 403 });
    await expect(getManagedWorkOrder(db, workOrder.id, owner)).resolves.toMatchObject({ id: workOrder.id });

    const asOther = permissionsFor({ ...workOrder, status: 'CONTRADICTED' }, otherTechnician, requirements, []);
    expect(asOther).toMatchObject({ manage: false, upload: false, submitForReview: false, review: false });
  });
});
