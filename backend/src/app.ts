import type { SupabaseClient } from '@supabase/supabase-js';
import cors from 'cors';
import express from 'express';
import type { Engine } from './agent/engine.js';
import type { AiProvider } from './ai/provider.js';
import { createAuth, currentUser } from './middleware/auth.js';
import { errorHandler, HttpError, notFound } from './middleware/errors.js';
import { createSystemRouter } from './routes/health.js';
import { createRequirementsRouter } from './routes/requirements.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createWorkOrdersRouter } from './routes/workOrders.js';
import type { Db } from './stores/db.js';
import { LocalFileStore, type FileStore } from './stores/fileStore.js';
import type { SystemStatus, Viewer } from './types.js';

export interface AppDeps {
  db: Db;
  files: FileStore;
  engine: Engine;
  /** The same provider the engine uses; null when AI is not configured. */
  ai: AiProvider | null;
  /** Null in local development, which runs without authentication. */
  supabase: SupabaseClient | null;
  system: SystemStatus;
  corsOrigins: string[];
}

export function createApp({ db, files, engine, ai, supabase, system, corsOrigins }: AppDeps) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createSystemRouter(system));

  // Local development only: serve evidence files from disk. With Supabase the
  // browser gets short-lived signed URLs to a private bucket instead.
  if (files instanceof LocalFileStore) {
    app.get('/api/files/*path', (req, res) => {
      const segments = (req.params as { path: string[] }).path;
      const absolute = files.absolutePath(segments.join('/'));
      if (!absolute) throw new HttpError(404, 'File not found');
      // The local data directory is `.data/`, which `send` would otherwise refuse as a dotfile.
      res.sendFile(absolute, { dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) res.status(404).json({ error: 'File not found' });
      });
    });
  }

  const auth = createAuth(supabase, db);

  // Who is signed in and in which role. The role decides what the API allows.
  app.get('/api/me', auth, (_req, res) => {
    const { id, email, role, roleSource } = currentUser(res);
    res.json({ id, email, role, roleSource } satisfies Viewer);
  });

  app.use(
    '/api/work-orders',
    auth,
    createWorkOrdersRouter({ db, files, engine, maxUploadMb: system.maxUploadMb }),
    createReviewsRouter({ db, files }),
  );

  app.use(
    '/api/requirements',
    auth,
    createRequirementsRouter({ ai, maxUploadMb: system.maxUploadMb }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
