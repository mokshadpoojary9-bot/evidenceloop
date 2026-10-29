import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createEngine, INTERRUPTED_RUN, recoverInterruptedRuns } from '../agent/engine.js';
import type { AiProvider } from '../ai/provider.js';
import { LOCAL_DEV_USER } from '../middleware/auth.js';
import { TEMPLATES } from '../templates.js';
import { LocalFileStore, SupabaseFileStore } from './fileStore.js';
import { LocalDb } from './localDb.js';
import { selectStores } from './select.js';
import { SupabaseDb } from './supabaseDb.js';
import { createWorkOrder } from './writes.js';

describe('selectStores', () => {
  // Constructing a client makes no network call; the values are placeholders, not credentials.
  const client = createClient('https://placeholder.supabase.co', 'placeholder-key', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it('never uses the local store in production', () => {
    expect(() => selectStores({ nodeEnv: 'production', supabase: null, bucket: 'evidence', localDataDir: '.data' })).toThrow(
      /Production requires Supabase/,
    );
    const stores = selectStores({ nodeEnv: 'production', supabase: client, bucket: 'evidence', localDataDir: '.data' });
    expect(stores.persistence).toBe('supabase');
    expect(stores.db).toBeInstanceOf(SupabaseDb);
    expect(stores.files).toBeInstanceOf(SupabaseFileStore);
  });

  it('uses Supabase whenever it is configured, and the local store only in development without it', () => {
    expect(selectStores({ nodeEnv: 'development', supabase: client, bucket: 'evidence', localDataDir: '.data' }).db).toBeInstanceOf(SupabaseDb);
    const local = selectStores({ nodeEnv: 'development', supabase: null, bucket: 'evidence', localDataDir: '.data-test-unused' });
    expect(local.persistence).toBe('local');
    expect(local.db).toBeInstanceOf(LocalDb);
    expect(local.files).toBeInstanceOf(LocalFileStore);
  });
});

describe('recoverInterruptedRuns', () => {
  it('fails a run cut off by a restart, so the work order is not stuck in ANALYZING', async () => {
    const db = new LocalDb();
    // A provider that never answers stands in for a run in flight when the server stopped.
    const hanging: AiProvider = {
      id: 'dev-fixture',
      model: null,
      simulated: true,
      assess: () => new Promise(() => {}),
      draftRequirements: async () => [],
    };
    const template = TEMPLATES[0]!;
    const workOrder = await createWorkOrder(db, LOCAL_DEV_USER, {
      title: template.name,
      description: '',
      location: 'Room 204',
      templateId: template.id,
      requirements: template.requirements,
    });
    await db.insert('evidence', {
      id: '33333333-3333-4333-8333-333333333333',
      workOrderId: workOrder.id,
      kind: 'after_photo',
      fileName: 'after.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      sha256: '0',
      storagePath: `${workOrder.id}/after.jpg`,
      note: '',
      requestId: null,
      uploadedBy: LOCAL_DEV_USER.id,
      createdAt: new Date().toISOString(),
    });
    await createEngine(db, hanging).start(workOrder.id, { type: 'manual', actor: 'user:test' });
    expect((await db.get('work_orders', workOrder.id))!.status).toBe('ANALYZING');

    // After the restart: a fresh process, the same database.
    expect(await recoverInterruptedRuns(db)).toBe(1);
    expect((await db.get('work_orders', workOrder.id))!.status).toBe('AWAITING_EVIDENCE');
    const requirements = await db.list('requirements', { workOrderId: workOrder.id });
    expect(requirements.every((requirement) => requirement.status === 'NOT_PROVEN')).toBe(true);
    const [run] = await db.list('analysis_runs', { workOrderId: workOrder.id });
    expect(run).toMatchObject({ status: 'FAILED', error: INTERRUPTED_RUN });
    const audit = await db.list('audit_events', { workOrderId: workOrder.id, type: 'ANALYSIS_FAILED' });
    expect(audit).toHaveLength(1);
    expect(await recoverInterruptedRuns(db)).toBe(0);
  });
});
