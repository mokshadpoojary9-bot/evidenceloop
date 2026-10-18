import { createHash, randomUUID } from 'node:crypto';
import { audit, now } from '../agent/audit.js';
import { extractPdfText } from '../media/pdfText.js';
import type { AuthUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import {
  CANNOT_VERIFY,
  EVIDENCE_KIND_LABELS,
  type Evidence,
  type EvidenceKind,
  type Requirement,
  type TemplateRequirement,
  type WorkOrder,
} from '../types.js';
import type { Db } from './db.js';
import type { FileStore } from './fileStore.js';

// The writes behind "create a work order" and "upload evidence", shared by the API
// routes and the demo seed so both produce identical rows and audit events.
// Input validation and access checks stay with the callers.

export interface CreateWorkOrderInput {
  /** Defaults to a random id; the demo seed passes fixed ids so it can find its own rows. */
  id?: string;
  title: string;
  description: string;
  location: string;
  templateId: string | null;
  requirements: TemplateRequirement[];
}

export async function createWorkOrder(db: Db, user: AuthUser, input: CreateWorkOrderInput): Promise<WorkOrder> {
  const timestamp = now();
  const workOrder: WorkOrder = {
    id: input.id ?? randomUUID(),
    ownerId: user.id,
    title: input.title,
    description: input.description,
    location: input.location,
    templateId: input.templateId,
    status: 'AWAITING_EVIDENCE',
    simulated: false,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  // Build the checklist. Nothing is proven until evidence says so.
  const requirements: Requirement[] = input.requirements.map((requirement, index) => ({
    id: randomUUID(),
    workOrderId: workOrder.id,
    position: index + 1,
    ...requirement,
    status: 'NOT_PROVEN',
    currentAssessmentId: null,
    updatedAt: timestamp,
  }));

  await db.insert('work_orders', workOrder);
  await db.insert('requirements', requirements);
  await audit(db, {
    workOrderId: workOrder.id,
    actor: `user:${user.id}`,
    type: 'WORK_ORDER_CREATED',
    summary: `Work order created: "${workOrder.title}"`,
    data: { templateId: workOrder.templateId },
  });
  await audit(db, {
    workOrderId: workOrder.id,
    actor: 'system',
    type: 'CHECKLIST_BUILT',
    summary: `Checklist built with ${requirements.length} requirement(s) (${requirements.filter((r) => r.mandatory).length} mandatory). ${CANNOT_VERIFY}`,
    data: { requirements: requirements.map((r) => ({ id: r.id, title: r.title, mandatory: r.mandatory })) },
  });
  return workOrder;
}

export interface AttachEvidenceInput {
  kind: EvidenceKind;
  note: string;
  /** The request this upload answers; when omitted, an open request for the same kind is used. */
  requestId?: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export const safeFileName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';

/** Stores the file, records it, and marks the request it answers as fulfilled. */
export async function attachEvidence(
  db: Db,
  files: FileStore,
  workOrder: WorkOrder,
  user: AuthUser,
  input: AttachEvidenceInput,
): Promise<Evidence> {
  // Link the upload to the request it answers: the one named, or an open one for this kind.
  const openRequests = await db.list('evidence_requests', {
    workOrderId: workOrder.id,
    status: 'OPEN',
  });
  const request = input.requestId
    ? openRequests.find((candidate) => candidate.id === input.requestId)
    : openRequests.find((candidate) => candidate.kind === input.kind);
  if (input.requestId && !request) throw new HttpError(400, 'That evidence request is not open');
  if (request && request.kind !== input.kind) {
    throw new HttpError(
      400,
      `That request asks for a ${EVIDENCE_KIND_LABELS[request.kind].toLowerCase()}`,
    );
  }

  const id = randomUUID();
  const evidence: Evidence = {
    id,
    workOrderId: workOrder.id,
    kind: input.kind,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.data.length,
    sha256: createHash('sha256').update(input.data).digest('hex'),
    storagePath: `${workOrder.id}/${id}/${safeFileName(input.fileName)}`,
    note: input.note,
    requestId: request?.id ?? null,
    uploadedBy: user.id,
    createdAt: now(),
  };

  // A PDF without a text layer (a scan) is attached but the AI cannot read it; record that up front.
  const pdf = evidence.mimeType === 'application/pdf' ? await extractPdfText(input.data, 1) : null;

  await files.put(evidence.storagePath, input.data, input.mimeType);
  await db.insert('evidence', evidence);
  await audit(db, {
    workOrderId: workOrder.id,
    actor: `user:${user.id}`,
    type: 'EVIDENCE_UPLOADED',
    summary: `Evidence uploaded: ${EVIDENCE_KIND_LABELS[evidence.kind]} "${evidence.fileName}"`,
    data: {
      evidenceId: id,
      kind: evidence.kind,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
      sha256: evidence.sha256,
      requestId: evidence.requestId,
      ...(pdf ? { pdf: { pages: pdf.pages, textLayer: pdf.ok } } : {}),
    },
  });

  if (request) {
    await db.update('evidence_requests', request.id, {
      status: 'FULFILLED',
      fulfilledByEvidenceId: id,
      updatedAt: now(),
    });
    await audit(db, {
      workOrderId: workOrder.id,
      actor: `user:${user.id}`,
      type: 'EVIDENCE_REQUEST_FULFILLED',
      summary: `Evidence request answered with "${evidence.fileName}". Whether it is sufficient is decided by re-analysis.`,
      data: { requestId: request.id, evidenceId: id },
    });
  }
  return evidence;
}

/** Deletes a work order, its evidence files and its audit trail. */
export async function deleteWorkOrder(db: Db, files: FileStore, workOrderId: string): Promise<void> {
  const evidence = await db.list('evidence', { workOrderId });
  await files.remove(evidence.map((item) => item.storagePath));
  // Children first, so the local store matches Postgres' ON DELETE CASCADE.
  for (const table of ['audit_events', 'reviews', 'evidence_requests', 'assessments', 'analysis_runs', 'evidence', 'requirements'] as const) {
    await db.delete(table, { workOrderId });
  }
  await db.delete('work_orders', { id: workOrderId });
}
