import { Router } from 'express';
import { TEMPLATES } from '../templates.js';
import type { SystemStatus } from '../types.js';

/** Public, unauthenticated routes: liveness, system status and the requirement library. */
export function createSystemRouter(status: SystemStatus) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'evidenceloop-api', time: new Date().toISOString() });
  });

  // Reports what is configured as booleans/labels only — never configuration values.
  router.get('/system', (_req, res) => {
    res.json(status);
  });

  router.get('/templates', (_req, res) => {
    res.json({ templates: TEMPLATES });
  });

  return router;
}
