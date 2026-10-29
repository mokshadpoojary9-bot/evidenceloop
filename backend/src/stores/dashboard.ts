import { type AuthUser, LOCAL_REVIEWER } from '../middleware/auth.js';
import { DASHBOARD_BUCKETS, type DashboardBucket, type DashboardData } from '../types.js';
import type { Db } from './db.js';
import { listWorkOrderSummaries, pendingReview, reviewEligibility } from './workOrders.js';

const ACTIVITY_LIMIT = 10;

/**
 * Everything the dashboard home shows, for the work orders this user may see (their own,
 * or all of them for a reviewer — the same rule as the work order list).
 */
export async function getDashboard(db: Db, user: AuthUser): Promise<DashboardData> {
  const summaries = await listWorkOrderSummaries(db, user);
  const active = summaries.filter((workOrder) => workOrder.archivedAt === null);
  const titles = new Map(summaries.map((workOrder) => [workOrder.id, workOrder.title]));

  const counts = Object.fromEntries(DASHBOARD_BUCKETS.map((bucket) => [bucket, 0])) as Record<DashboardBucket, number>;
  for (const workOrder of active) {
    if (workOrder.status in counts) counts[workOrder.status as DashboardBucket]++;
  }

  const [requestGroups, reviewGroups, auditGroups] = await Promise.all([
    Promise.all(
      active
        .filter((workOrder) => workOrder.openRequestCount > 0)
        .map(async (workOrder) => {
          const [requests, requirements] = await Promise.all([
            db.list('evidence_requests', { workOrderId: workOrder.id, status: 'OPEN' }, 'createdAt'),
            db.list('requirements', { workOrderId: workOrder.id }, 'position'),
          ]);
          const requirementTitle = new Map(requirements.map((r) => [r.id, r.title]));
          return requests.map((request) => ({
            id: request.id,
            workOrderId: workOrder.id,
            workOrderTitle: workOrder.title,
            kind: request.kind,
            instruction: request.instruction,
            requirementTitles: request.requirementIds.flatMap((id) => requirementTitle.get(id) ?? []),
            createdAt: request.createdAt,
          }));
        }),
    ),
    Promise.all(
      active
        .filter((workOrder) => workOrder.status === 'IN_REVIEW')
        .map(async (workOrder) => {
          const review = pendingReview(await db.list('reviews', { workOrderId: workOrder.id }, 'submittedAt'));
          return {
            workOrderId: workOrder.id,
            title: workOrder.title,
            location: workOrder.location,
            submittedAt: review?.submittedAt ?? workOrder.updatedAt,
          };
        }),
    ),
    Promise.all(summaries.map((workOrder) => db.list('audit_events', { workOrderId: workOrder.id }, 'createdAt'))),
  ]);

  const latest = auditGroups
    .flat()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, ACTIVITY_LIMIT);
  const actors = new Map<string, string>();
  for (const event of latest) {
    if (!actors.has(event.actor)) actors.set(event.actor, await actorLabel(db, event.actor, user));
  }

  return {
    counts,
    drafts:
      user.role === 'technician'
        ? active
            .filter((workOrder) => workOrder.status === 'AWAITING_EVIDENCE')
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .map(({ id, title, location, updatedAt }) => ({ workOrderId: id, title, location, updatedAt }))
        : [],
    readyForReview:
      user.role === 'technician'
        ? active
            .filter((workOrder) => !reviewEligibility(workOrder, workOrder.requirementStatuses.map((status) => ({ status }))))
            .map(({ id, title, status }) => ({ workOrderId: id, title, status }))
        : [],
    openRequests: requestGroups.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    awaitingReview: reviewGroups.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1)),
    activity: latest.map((event) => ({
      id: event.id,
      workOrderId: event.workOrderId,
      workOrderTitle: titles.get(event.workOrderId) ?? 'Work order',
      type: event.type,
      summary: event.summary,
      actor: actors.get(event.actor) ?? 'Someone',
      createdAt: event.createdAt,
    })),
  };
}

/** A readable actor, without exposing anyone's id or email. */
async function actorLabel(db: Db, actor: string, user: AuthUser): Promise<string> {
  if (actor === 'agent') return 'Agent';
  if (actor === 'system') return 'System';
  const id = actor.startsWith('user:') ? actor.slice(5) : null;
  if (!id) return 'Someone';
  if (id === user.id) return 'You';
  const role = await db.get('user_roles', id);
  return role?.role === 'reviewer' || id === LOCAL_REVIEWER.id ? 'Reviewer' : 'Technician';
}
