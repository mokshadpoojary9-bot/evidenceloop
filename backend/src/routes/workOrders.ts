import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { audit, now } from '../agent/audit.js';
import type { Engine } from '../agent/engine.js';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type { Db } from '../stores/db.js';
import type { FileStore } from '../stores/fileStore.js';
import {
  getOwnedWorkOrder,
  getWorkOrderDetail,
  listWorkOrderSummaries,
} from '../stores/workOrders.js';
import { TEMPLATES } from '../templates.js';
import {
  CANNOT_VERIFY,
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KIND_MIME,
  type Evidence,
  type ReanalysisOutcome,
  type Requirement,
  type UploadEvidenceResponse,
  type WorkOrder,
} from '../types.js';

export interface WorkOrderRouteDeps {
  db: Db;
  files: FileStore;
  engine: Engine;
  maxUploadMb: number;
}

const requirementSchema = z.object({
  title: z.string().trim().min(1, 'Requirement title is required').max(200),
  description: z.string().trim().max(2000).default(''),
  mandatory: z.boolean().default(true),
  evidenceNeeds: z
    .array(
      z.object({
        kind: z.enum(EVIDENCE_KINDS),
        instruction: z.string().trim().min(1).max(500),
      }),
    )
    .max(10)
    .default([]),
});

const newWorkOrderSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).default(''),
  location: z.string().trim().max(200).default(''),
  templateId: z.string().nullish(),
  requirements: z.array(requirementSchema).max(50).default([]),
});

const uploadFieldsSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  note: z.string().trim().max(1000).default(''),
  requestId: z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional()),
});

const idParam = (value: unknown) => {
  const id = z.uuid().safeParse(value);
  if (!id.success) throw new HttpError(404, 'Work order not found');
  return id.data;
};

const safeFileName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';

export function createWorkOrdersRouter({ db, files, engine, maxUploadMb }: WorkOrderRouteDeps) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
  });

  router.get('/', async (_req, res) => {
    res.json({ workOrders: await listWorkOrderSummaries(db, currentUser(res).id) });
  });

  router.post('/', async (req, res) => {
    const user = currentUser(res);
    const input = newWorkOrderSchema.parse(req.body);

    const template = input.templateId
      ? TEMPLATES.find((candidate) => candidate.id === input.templateId)
      : undefined;
    if (input.templateId && !template) throw new HttpError(400, 'Unknown template');

    // Retrieve requirements: explicit ones win, otherwise the template's library entry.
    const source = input.requirements.length > 0 ? input.requirements : (template?.requirements ?? []);
    if (!source.some((requirement) => requirement.mandatory)) {
      throw new HttpError(400, 'A work order needs at least one mandatory requirement');
    }

    const timestamp = now();
    const workOrder: WorkOrder = {
      id: randomUUID(),
      ownerId: user.id,
      title: input.title,
      description: input.description,
      location: input.location,
      templateId: template?.id ?? null,
      status: 'AWAITING_EVIDENCE',
      simulated: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    // Build the checklist. Nothing is proven until evidence says so.
    const requirements: Requirement[] = source.map((requirement, index) => ({
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

    res.status(201).json(await getWorkOrderDetail(db, files, workOrder));
  });

  router.get('/:id', async (req, res) => {
    const workOrder = await getOwnedWorkOrder(db, idParam(req.params.id), currentUser(res).id);
    res.json(await getWorkOrderDetail(db, files, workOrder));
  });

  router.post('/:id/analyze', async (req, res) => {
    const user = currentUser(res);
    const workOrder = await getOwnedWorkOrder(db, idParam(req.params.id), user.id);
    const result = await engine.start(workOrder.id, { type: 'manual', actor: `user:${user.id}` });
    res.status(202).json(result);
  });

  router.post('/:id/evidence', upload.single('file'), async (req, res) => {
    const user = currentUser(res);
    const workOrder = await getOwnedWorkOrder(db, idParam(req.params.id), user.id);
    const fields = uploadFieldsSchema.parse(req.body);
    const file = req.file;
    if (!file) throw new HttpError(400, 'A file is required');
    if (file.size === 0) throw new HttpError(400, 'The file is empty');

    const allowed = EVIDENCE_KIND_MIME[fields.kind];
    if (!allowed.some((prefix) => file.mimetype.startsWith(prefix))) {
      throw new HttpError(
        400,
        `A ${EVIDENCE_KIND_LABELS[fields.kind].toLowerCase()} must be one of: ${allowed.join(', ')}* (received ${file.mimetype})`,
      );
    }

    // Link the upload to the request it answers: the one named, or an open one for this kind.
    const openRequests = await db.list('evidence_requests', {
      workOrderId: workOrder.id,
      status: 'OPEN',
    });
    const request = fields.requestId
      ? openRequests.find((candidate) => candidate.id === fields.requestId)
      : openRequests.find((candidate) => candidate.kind === fields.kind);
    if (fields.requestId && !request) throw new HttpError(400, 'That evidence request is not open');
    if (request && request.kind !== fields.kind) {
      throw new HttpError(
        400,
        `That request asks for a ${EVIDENCE_KIND_LABELS[request.kind].toLowerCase()}`,
      );
    }

    const id = randomUUID();
    // multer decodes the filename as latin1; restore UTF-8 names.
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const evidence: Evidence = {
      id,
      workOrderId: workOrder.id,
      kind: fields.kind,
      fileName: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      storagePath: `${workOrder.id}/${id}/${safeFileName(originalName)}`,
      note: fields.note,
      requestId: request?.id ?? null,
      uploadedBy: user.id,
      createdAt: now(),
    };

    await files.put(evidence.storagePath, file.buffer, file.mimetype);
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

    // New evidence triggers re-evaluation once a first verification run has happened.
    const reanalysis = await triggerReanalysis(workOrder, evidence, user.id);
    res.status(201).json({ evidence, reanalysis } satisfies UploadEvidenceResponse);
  });

  async function triggerReanalysis(
    workOrder: WorkOrder,
    evidence: Evidence,
    userId: string,
  ): Promise<ReanalysisOutcome> {
    const runs = await db.list('analysis_runs', { workOrderId: workOrder.id });
    if (runs.length === 0) return 'skipped_no_prior_run';

    if (!engine.available) {
      await audit(db, {
        workOrderId: workOrder.id,
        actor: 'system',
        type: 'ANALYSIS_SKIPPED',
        summary: 'Re-analysis skipped: production AI is not configured.',
        data: { evidenceId: evidence.id },
      });
      return 'skipped_ai_not_configured';
    }

    const { queued } = await engine.start(workOrder.id, {
      type: 'new_evidence',
      actor: `user:${userId}`,
      evidenceId: evidence.id,
    });
    return queued ? 'queued' : 'started';
  }

  return router;
}
