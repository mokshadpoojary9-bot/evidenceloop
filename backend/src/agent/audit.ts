import { randomUUID } from 'node:crypto';
import type { Db } from '../stores/db.js';
import type { AuditEvent } from '../types.js';

let lastTimestamp = 0;

/** ISO timestamp that is strictly increasing within this process, so ordering is stable. */
export function now(): string {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  return new Date(lastTimestamp).toISOString();
}

export type AuditInput = Pick<AuditEvent, 'workOrderId' | 'actor' | 'type' | 'summary'> &
  Partial<Pick<AuditEvent, 'runId' | 'data'>>;

/** Appends to the audit trail. Events are never updated or deleted. */
export async function audit(db: Db, event: AuditInput): Promise<void> {
  await db.insert('audit_events', {
    id: randomUUID(),
    runId: null,
    data: {},
    ...event,
    createdAt: now(),
  });
}
