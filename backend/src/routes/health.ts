import { Router } from 'express';
import { TEMPLATES } from '../templates.js';
import type { ReadinessReport, SystemStatus } from '../types.js';

/** Public, unauthenticated routes: liveness, readiness, system status and the requirement library. */
export function createSystemRouter(status: SystemStatus, readiness?: () => Promise<ReadinessReport>) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'evidenceloop-api', time: new Date().toISOString() });
  });

  // Database, storage bucket, ffmpeg and PDF extraction, as pass/fail with short reasons.
  if (readiness) {
    router.get('/health/ready', async (_req, res) => {
      const report = await readiness();
      res.status(report.ready ? 200 : 503).json(report);
    });
  }

  // Reports what is configured as booleans/labels only — never configuration values.
  router.get('/system', (_req, res) => {
    res.json(status);
  });

  router.get('/templates', (_req, res) => {
    res.json({ templates: TEMPLATES });
  });

  return router;
}
