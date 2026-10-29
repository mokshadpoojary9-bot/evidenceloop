import type { AuthUser } from '../middleware/auth.js';
import type { Db } from '../stores/db.js';
import { queueReason } from '../stores/reviewQueue.js';
import { listWorkOrderSummaries } from '../stores/workOrders.js';
import { EVIDENCE_KIND_LABELS, type AuditEvent, type WorkOrderSummary } from '../types.js';

// What Verity may see. Built by the backend from the database for the signed-in user only,
// with the same access rules as the API:
//   * a technician: their own work orders, nothing else;
//   * a reviewer: the review queue (in review, contradicted, uncertain), plus the work order
//     they are looking at, which a reviewer may read anyway.
// No names, emails or ids of other people are included.

/** Overall budget for the data part of the prompt. */
export const MAX_CONTEXT_CHARS = 20_000;
const DETAILED = 4;
const LISTED = 40;
const ACTIVITY = 15;
const EVENTS_PER_ORDER = 8;

export interface AssistantContext {
  /** The data block for the prompt. */
  text: string;
  /** Work orders described in detail (for tests and logging). */
  detailedIds: string[];
  /** Every work order the context mentions at all. */
  scopeIds: string[];
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

function relevance(workOrder: WorkOrderSummary, question: Set<string>): number {
  let score = 0;
  for (const word of words(`${workOrder.title} ${workOrder.location} ${workOrder.description}`)) if (question.has(word)) score++;
  return score;
}

function actorLabel(event: AuditEvent, user: AuthUser): string {
  if (event.actor === 'agent') return 'Agent';
  if (event.actor === 'system') return 'System';
  if (event.actor === `user:${user.id}`) return 'You';
  const role = event.data.actorRole;
  return role === 'reviewer' ? 'A reviewer' : role === 'technician' ? 'A technician' : 'Another user';
}

const proven = (workOrder: WorkOrderSummary) =>
  `${workOrder.requirementStatuses.filter((status) => status === 'PROVEN').length}/${workOrder.requirementStatuses.length} proven`;

/** The work orders this user may ask about, by the API's own rules. */
async function scopeFor(db: Db, user: AuthUser, focusId: string | null): Promise<WorkOrderSummary[]> {
  const visible = await listWorkOrderSummaries(db, user);
  if (user.role !== 'reviewer') return visible.filter((workOrder) => workOrder.ownerId === user.id);
  return visible.filter((workOrder) => queueReason(workOrder) !== null || workOrder.id === focusId);
}

async function describe(db: Db, workOrder: WorkOrderSummary, user: AuthUser): Promise<string> {
  const where = { workOrderId: workOrder.id };
  const [requirements, assessments, evidence, requests, audit] = await Promise.all([
    db.list('requirements', where, 'position'),
    db.list('assessments', where),
    db.list('evidence', where, 'createdAt'),
    db.list('evidence_requests', { ...where, status: 'OPEN' }, 'createdAt'),
    db.list('audit_events', where, 'createdAt'),
  ]);
  const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const evidenceName = new Map(evidence.map((item) => [item.id, `${EVIDENCE_KIND_LABELS[item.kind]} "${item.fileName}"`]));
  const titleById = new Map(requirements.map((requirement) => [requirement.id, `#${requirement.position} ${requirement.title}`]));

  const lines = [
    `## Work order "${workOrder.title}"${workOrder.location ? ` — ${workOrder.location}` : ''}`,
    `Status: ${workOrder.status}${workOrder.simulated ? ' (DEV fixture, simulated — not AI inference)' : ''} · ${proven(workOrder)}${workOrder.archivedAt ? ' · archived' : ''} · updated ${workOrder.updatedAt}`,
    'Requirements:',
  ];
  for (const requirement of requirements) {
    lines.push(`- #${requirement.position} ${requirement.title}${requirement.mandatory ? '' : ' (optional)'}: ${requirement.status}`);
    const assessment = requirement.currentAssessmentId ? assessmentById.get(requirement.currentAssessmentId) : undefined;
    if (!assessment) {
      lines.push('  (not assessed yet)');
      continue;
    }
    lines.push(`  Reasoning: ${clip(assessment.reasoning, 400)}`);
    for (const observation of assessment.observations.slice(0, 4)) {
      lines.push(
        `  Observation (${observation.kind}) in ${evidenceName.get(observation.evidenceId) ?? 'evidence'}: ${clip(observation.text, 200)}`,
      );
    }
    for (const need of assessment.missingEvidence.slice(0, 3)) {
      lines.push(`  Missing: ${EVIDENCE_KIND_LABELS[need.kind]} — ${clip(need.instruction, 200)}`);
    }
  }
  lines.push(
    evidence.length === 0
      ? 'Evidence: none uploaded.'
      : `Evidence (${evidence.length}): ${evidence.map((item) => `${evidenceName.get(item.id)} at ${item.createdAt}`).join('; ')}`,
  );
  lines.push(
    requests.length === 0
      ? 'Open evidence requests: none.'
      : `Open evidence requests:\n${requests
          .map(
            (request) =>
              `- ${EVIDENCE_KIND_LABELS[request.kind]}: ${clip(request.instruction, 300)} (affects ${
                request.requirementIds.map((id) => titleById.get(id)).filter(Boolean).join(', ') || 'unspecified'
              })`,
          )
          .join('\n')}`,
  );
  const recent = audit.slice(-EVENTS_PER_ORDER).reverse();
  if (recent.length > 0) {
    lines.push(`Latest events:\n${recent.map((event) => `- ${event.createdAt} · ${actorLabel(event, user)}: ${clip(event.summary, 200)}`).join('\n')}`);
  }
  return lines.join('\n');
}

/**
 * The data Verity answers from. Picks the work order being viewed first, then those the
 * question mentions, then the most recently changed; the rest are listed in one line each.
 */
export async function buildAssistantContext(
  db: Db,
  user: AuthUser,
  { question, workOrderId = null, now = new Date() }: { question: string; workOrderId?: string | null; now?: Date },
): Promise<AssistantContext> {
  const scope = await scopeFor(db, user, workOrderId);
  const asked = words(question);
  const ranked = [...scope].sort((a, b) => {
    if (a.id === workOrderId) return -1;
    if (b.id === workOrderId) return 1;
    const byRelevance = relevance(b, asked) - relevance(a, asked);
    if (byRelevance !== 0) return byRelevance;
    if ((a.archivedAt === null) !== (b.archivedAt === null)) return a.archivedAt === null ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });

  const header = [
    `Current time: ${now.toISOString()}`,
    `Signed-in user: a ${user.role}.`,
    user.role === 'reviewer'
      ? `Scope: the review queue (${scope.length} work order(s) in review, contradicted or uncertain).`
      : `Scope: this technician's own work orders (${scope.length}).`,
  ];
  if (scope.length === 0) header.push('There are no work orders in scope.');

  const sections: string[] = [header.join('\n')];
  let used = sections[0]!.length;
  const detailedIds: string[] = [];
  for (const workOrder of ranked.slice(0, DETAILED)) {
    const block = await describe(db, workOrder, user);
    if (used + block.length > MAX_CONTEXT_CHARS * 0.75) break;
    sections.push(block);
    used += block.length;
    detailedIds.push(workOrder.id);
  }

  const others = ranked.filter((workOrder) => !detailedIds.includes(workOrder.id)).slice(0, LISTED);
  if (others.length > 0) {
    sections.push(
      `## Other work orders (summary only)\n${others
        .map(
          (workOrder) =>
            `- "${workOrder.title}"${workOrder.location ? ` (${workOrder.location})` : ''}: ${workOrder.status}, ${proven(workOrder)}, ${workOrder.openRequestCount} open request(s)${workOrder.archivedAt ? ', archived' : ''}`,
        )
        .join('\n')}`,
    );
  }

  const titles = new Map(scope.map((workOrder) => [workOrder.id, workOrder.title]));
  const activity = (await Promise.all(scope.map((workOrder) => db.list('audit_events', { workOrderId: workOrder.id }, 'createdAt'))))
    .flat()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, ACTIVITY);
  if (activity.length > 0) {
    sections.push(
      `## Recent activity (newest first)\n${activity
        .map((event) => `- ${event.createdAt} · "${titles.get(event.workOrderId)}" · ${actorLabel(event, user)}: ${clip(event.summary, 160)}`)
        .join('\n')}`,
    );
  }

  return {
    text: clip(sections.join('\n\n'), MAX_CONTEXT_CHARS),
    detailedIds,
    scopeIds: [...detailedIds, ...others.map((workOrder) => workOrder.id)],
  };
}
