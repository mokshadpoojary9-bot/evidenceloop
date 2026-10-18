import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEngine } from '../agent/engine.js';
import { DevFixtureProvider } from '../ai/devFixtureProvider.js';
import type { AuthUser } from '../middleware/auth.js';
import type { Db } from '../stores/db.js';
import type { FileStore } from '../stores/fileStore.js';
import { attachEvidence, createWorkOrder, deleteWorkOrder } from '../stores/writes.js';
import { TEMPLATES } from '../templates.js';
import type { EvidenceKind, EvidenceNeed, TemplateRequirement, WorkOrder, WorkOrderStatus } from '../types.js';

/**
 * Demo data for judges: three work orders built through the same writes and the same
 * verification engine as the API, with the DEV ONLY fixture standing in for AI.
 * Every result it produces is flagged `simulated` and labelled "Simulated · dev fixture"
 * in the UI — no Nemotron result is faked.
 *
 * The work orders have fixed ids, so seeding twice creates nothing new and a reset
 * removes exactly these three and nothing else.
 */
export const DEMO_IDS = {
  room204: 'dec0de00-0000-4000-8000-000000000204',
  corridorB: 'dec0de00-0000-4000-8000-00000000000b',
  lab3: 'dec0de00-0000-4000-8000-000000000003',
} as const;

export const DEMO_WORK_ORDER_IDS: string[] = Object.values(DEMO_IDS);

const need = (kind: EvidenceKind, instruction: string): EvidenceNeed => ({ kind, instruction });

const MIME: Record<string, string> = { jpg: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4' };

interface DemoUpload {
  /** Path inside demo/. */
  file: string;
  kind: EvidenceKind;
  note: string;
}

interface DemoOrder {
  id: string;
  title: string;
  description: string;
  location: string;
  templateId: string | null;
  requirements: TemplateRequirement[];
  /** Uploaded before the first verification run. */
  uploads: DemoUpload[];
  /** Uploaded afterwards, each answering the open request for its kind and triggering re-analysis. */
  followUps: DemoUpload[];
  expected: WorkOrderStatus;
}

const emergencyLight = TEMPLATES.find((template) => template.id === 'emergency-light-replacement')!;

const BRACKET_AFTER = need('after_photo', 'Upload an after photo showing the extinguisher seated in the bracket, the sign above it, and the CORRIDOR B sign.');
const BRACKET_BEFORE = need('before_photo', 'Upload a before photo of the marked position with the CORRIDOR B sign visible.');
const BRACKET_CLOSE_UP = need('additional_photo', 'Upload a close-up photo of the bracket fixings with a tape measure showing the handle height above the floor.');
const BRACKET_SOP = need('document', 'Upload the SOP page that specifies the bracket model and mounting height.');

const FAN_AFTER = need('after_photo', 'Upload an after photo of the installed fan with the model label on the motor housing readable.');
const FAN_BEFORE = need('before_photo', 'Upload a before photo of the existing fan with the LAB 3 sign visible.');
const FAN_CLOSE_UP = need('additional_photo', 'Upload a close-up photo of the canopy fixings and the terminal block.');
const FAN_SOP = need('document', 'Upload the SOP page that specifies the approved fan model.');
const FAN_VIDEO = need('video', 'Upload a short video of the fan running at every speed setting.');

/** In seeding order: the main live demo is created last, so it is the newest. */
export const DEMO_ORDERS: DemoOrder[] = [
  {
    id: DEMO_IDS.lab3,
    title: 'Replace ceiling fan, Lab 3',
    description: 'Replace the failed ceiling fan in Lab 3 with the model approved for laboratories in SOP CF-12.',
    location: 'Lab 3',
    templateId: null,
    requirements: [
      { title: 'Approved fan model installed', description: 'The installed fan is the model SOP CF-12 specifies for laboratories (Aerivo CF-52).', mandatory: true, evidenceNeeds: [FAN_AFTER, FAN_SOP] },
      { title: 'Work location is Lab 3', description: 'The work was carried out on the fan in Lab 3.', mandatory: true, evidenceNeeds: [FAN_BEFORE] },
      { title: 'Fan securely mounted', description: 'The canopy bracket is fixed to the ceiling box with both fixings.', mandatory: true, evidenceNeeds: [FAN_CLOSE_UP] },
      { title: 'Electrical connection completed', description: 'Line, neutral and earth are terminated and the canopy is closed.', mandatory: true, evidenceNeeds: [FAN_CLOSE_UP] },
      { title: 'Fan runs at every speed', description: 'The fan runs at each speed setting after the supply is restored.', mandatory: true, evidenceNeeds: [FAN_VIDEO] },
    ],
    uploads: [
      { file: 'lab-3/before.jpg', kind: 'before_photo', note: 'Old fan before removal, LAB 3 sign in frame.' },
      // The DEV fixture cannot see images; this tag is how it is told to simulate the contradiction.
      { file: 'lab-3/after.jpg', kind: 'after_photo', note: 'Label on the motor housing reads Aerivo CF-48; SOP CF-12 requires the CF-52. #contradict' },
      { file: 'lab-3/closeup.jpg', kind: 'additional_photo', note: 'Canopy fixings and terminal block.' },
      { file: 'lab-3/sop-ceiling-fan.pdf', kind: 'document', note: 'SOP CF-12 (fictional sample).' },
    ],
    followUps: [],
    expected: 'CONTRADICTED',
  },
  {
    id: DEMO_IDS.corridorB,
    title: 'Install fire extinguisher bracket, Corridor B',
    description: 'Install a wall bracket for the 6 kg extinguisher at the marked position in Corridor B, per SOP FX-03.',
    location: 'Corridor B',
    templateId: null,
    requirements: [
      { title: 'Correct bracket installed', description: 'The bracket is the model SOP FX-03 specifies (Brackwell BX-6).', mandatory: true, evidenceNeeds: [BRACKET_AFTER, BRACKET_SOP] },
      { title: 'Correct location', description: 'The bracket is at the marked position in Corridor B.', mandatory: true, evidenceNeeds: [BRACKET_BEFORE, BRACKET_AFTER] },
      { title: 'Bracket securely fixed', description: 'All four fixings are in place.', mandatory: true, evidenceNeeds: [BRACKET_CLOSE_UP] },
      { title: 'Mounting height within SOP range', description: 'The extinguisher handle is between 1.0 m and 1.2 m above the floor.', mandatory: true, evidenceNeeds: [BRACKET_CLOSE_UP] },
      { title: 'Extinguisher seated and sign fitted', description: 'The extinguisher sits in both cradles and the sign is directly above it.', mandatory: true, evidenceNeeds: [BRACKET_AFTER] },
    ],
    uploads: [
      { file: 'corridor-b/before.jpg', kind: 'before_photo', note: 'Marked position before installation.' },
      { file: 'corridor-b/after.jpg', kind: 'after_photo', note: 'Bracket installed, extinguisher seated, sign fitted.' },
      { file: 'corridor-b/sop-extinguisher-bracket.pdf', kind: 'document', note: 'SOP FX-03 (fictional sample).' },
    ],
    followUps: [
      { file: 'corridor-b/closeup.jpg', kind: 'additional_photo', note: 'Fixings close-up with tape measure: handle at 1.10 m.' },
    ],
    expected: 'VERIFIED',
  },
  {
    id: DEMO_IDS.room204,
    title: emergencyLight.title,
    description: emergencyLight.description,
    location: emergencyLight.location,
    templateId: emergencyLight.id,
    requirements: emergencyLight.requirements,
    uploads: [
      { file: 'room-204/before.jpg', kind: 'before_photo', note: 'Failed unit above the door, FAULT indicator on.' },
      { file: 'room-204/after.jpg', kind: 'after_photo', note: 'Replacement installed, same position.' },
      { file: 'room-204/closeup.jpg', kind: 'additional_photo', note: 'Fixings and conduit gland.' },
      { file: 'room-204/sop-emergency-light.pdf', kind: 'document', note: 'SOP EL-07 (fictional sample).' },
    ],
    // The functional-test video is left for the live demo.
    followUps: [],
    expected: 'NEEDS_EVIDENCE',
  },
];

export interface SeedDeps {
  db: Db;
  files: FileStore;
  /** The technician who owns the demo work orders. */
  owner: AuthUser;
  /** The repository's demo/ directory. */
  demoDir: string;
  log?: (line: string) => void;
}

export interface SeedResult {
  created: WorkOrder[];
  /** Demo work orders that already existed and were left untouched. */
  skipped: WorkOrder[];
}

export async function seedDemo({ db, files, owner, demoDir, log = () => {} }: SeedDeps): Promise<SeedResult> {
  if (owner.role !== 'technician') throw new Error('Demo work orders must be owned by a technician.');
  // DEV ONLY fixture, never Nemotron: the seed must not spend tokens or pretend to be AI.
  const engine = createEngine(db, new DevFixtureProvider(0));
  const actor = `user:${owner.id}`;
  const result: SeedResult = { created: [], skipped: [] };

  for (const order of DEMO_ORDERS) {
    const existing = await db.get('work_orders', order.id);
    if (existing) {
      log(`  = ${order.title} — already seeded (${existing.status}), left as is`);
      result.skipped.push(existing);
      continue;
    }

    const upload = async (workOrder: WorkOrder, item: DemoUpload) =>
      attachEvidence(db, files, workOrder, owner, {
        kind: item.kind,
        note: item.note,
        fileName: item.file.split('/').pop()!,
        mimeType: MIME[item.file.split('.').pop()!]!,
        data: await readFile(join(demoDir, item.file)),
      });

    try {
      const workOrder = await createWorkOrder(db, owner, order);
      for (const item of order.uploads) await upload(workOrder, item);
      await engine.start(workOrder.id, { type: 'manual', actor });
      await engine.whenIdle(workOrder.id);

      for (const item of order.followUps) {
        // Answers the open request of the same kind, then re-analyzes like an upload through the API.
        const evidence = await upload(workOrder, item);
        await engine.start(workOrder.id, { type: 'new_evidence', actor, evidenceId: evidence.id });
        await engine.whenIdle(workOrder.id);
      }

      const final = (await db.get('work_orders', workOrder.id))!;
      if (final.status !== order.expected) {
        throw new Error(`expected ${order.expected}, got ${final.status}`);
      }
      log(`  + ${order.title} — ${final.status} (simulated · dev fixture)`);
      result.created.push(final);
    } catch (error) {
      // Leave nothing half-built behind, so the next run starts clean.
      await deleteWorkOrder(db, files, order.id).catch(() => {});
      throw new Error(`Seeding "${order.title}" failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }
  return result;
}

/** Removes the three demo work orders (and their files, runs and audit trail). Nothing else. */
export async function resetDemo({ db, files, log = () => {} }: Pick<SeedDeps, 'db' | 'files' | 'log'>): Promise<string[]> {
  const removed: string[] = [];
  for (const id of DEMO_WORK_ORDER_IDS) {
    const workOrder = await db.get('work_orders', id);
    if (!workOrder) continue;
    await deleteWorkOrder(db, files, id);
    log(`  - ${workOrder.title} — removed`);
    removed.push(id);
  }
  return removed;
}
