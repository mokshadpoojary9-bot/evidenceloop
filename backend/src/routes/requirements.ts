import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AI_NOT_CONFIGURED } from '../agent/engine.js';
import { validateProposals } from '../agent/sopDraft.js';
import type { AiProvider } from '../ai/provider.js';
import { extractDocumentText } from '../media/documentText.js';
import { HttpError } from '../middleware/errors.js';
import type { RequirementDraftResponse } from '../types.js';

const contextSchema = z.object({
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(5000).default(''),
  location: z.string().trim().max(200).default(''),
});

/**
 * POST /api/requirements/draft — proposes requirements from an uploaded SOP/manual.
 * Stateless on purpose: nothing is stored. The caller shows the proposals for
 * review and saves only what a person confirms.
 */
export function createRequirementsRouter({ ai, maxUploadMb }: { ai: AiProvider | null; maxUploadMb: number }) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
  });

  router.post('/draft', upload.single('file'), async (req, res) => {
    if (!ai) throw new HttpError(503, AI_NOT_CONFIGURED, 'AI_NOT_CONFIGURED');
    const context = contextSchema.parse(req.body ?? {});
    const file = req.file;
    if (!file || file.size === 0) throw new HttpError(400, 'Upload the SOP or manual as a PDF or text file');
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const document = await extractDocumentText(file.buffer, file.mimetype);
    if (!document.ok) {
      throw new HttpError(422, `${document.reason} Requirements cannot be drafted from it.`, 'NO_TEXT');
    }

    const raw = await ai.draftRequirements({ sopText: document.text, truncated: document.truncated, context });
    const { proposals, dropped } = validateProposals(raw, document.text);

    res.json({
      proposals,
      simulated: ai.simulated,
      provider: ai.id,
      model: ai.model,
      source: { fileName, pages: document.pages, chars: document.text.length, truncated: document.truncated },
      dropped,
    } satisfies RequirementDraftResponse);
  });

  return router;
}
