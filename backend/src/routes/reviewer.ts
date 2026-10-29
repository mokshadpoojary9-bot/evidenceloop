import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type { Db } from '../stores/db.js';
import type { People } from '../stores/people.js';
import { getReviewQueue } from '../stores/reviewQueue.js';
import { listWorkOrderSummaries } from '../stores/workOrders.js';
import type { AuditEvent, AuditLogEntry } from '../types.js';

const AUDIT_LIMIT_DEFAULT = 100;

const auditQuerySchema = z.object({
  type: z.string().trim().max(64).optional(),
  workOrderId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(AUDIT_LIMIT_DEFAULT),
});

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/**
 * The reviewer (admin) console: the queue of work orders the evidence could not settle,
 * across every technician, and the audit log across every work order. Reviewers only.
 * Mounted at /api/reviewer. Decisions themselves go through POST /api/work-orders/:id/reviews/decision.
 */
export function createReviewerRouter({ db, people }: { db: Db; people: People }) {
  const router = Router();

  router.use((_req, res, next) => {
    if (currentUser(res).role !== 'reviewer') throw new HttpError(403, 'Only reviewers can open the reviewer console.', 'FORBIDDEN');
    next();
  });

  router.get('/queue', async (_req, res) => {
    res.json({ items: await getReviewQueue(db, currentUser(res), people) });
  });

  router.get('/audit-log', async (req, res) => {
    const query = auditQuerySchema.parse(req.query);
    const summaries = await listWorkOrderSummaries(db, currentUser(res));
    const titles = new Map(summaries.map((workOrder) => [workOrder.id, workOrder.title]));
    const scope = query.workOrderId ? summaries.filter((workOrder) => workOrder.id === query.workOrderId) : summaries;

    const events = (await Promise.all(scope.map((workOrder) => db.list('audit_events', { workOrderId: workOrder.id }, 'createdAt'))))
      .flat()
      .filter((event) => !query.type || event.type === query.type)
      .sort(newestFirst)
      .slice(0, query.limit);

    const entries: AuditLogEntry[] = [];
    for (const event of events) {
      entries.push({
        id: event.id,
        workOrderId: event.workOrderId,
        workOrderTitle: titles.get(event.workOrderId) ?? 'Work order',
        type: event.type,
        summary: event.summary,
        ...(await actorOf(event, people)),
        createdAt: event.createdAt,
      });
    }
    res.json({ entries });
  });

  return router;
}

async function actorOf(event: AuditEvent, people: People): Promise<Pick<AuditLogEntry, 'actor' | 'actorRole'>> {
  if (event.actor === 'agent') return { actor: 'Agent', actorRole: 'agent' };
  if (!event.actor.startsWith('user:')) return { actor: 'System', actorRole: 'system' };
  const person = await people.get(event.actor.slice(5));
  return { actor: person.name, actorRole: person.role };
}
