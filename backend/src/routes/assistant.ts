import { Router } from 'express';
import { z } from 'zod';
import { buildAssistantContext } from '../assistant/context.js';
import type { RateLimiter } from '../assistant/rateLimit.js';
import { systemPrompt, type AssistantChat } from '../assistant/verity.js';
import { NebiusError } from '../lib/nebius.js';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type { Db } from '../stores/db.js';

/** How much of the conversation is sent back to the model. */
const MAX_TURNS = 8;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40)
    .refine((turns) => turns.at(-1)?.role === 'user', 'The last message must be the question'),
  workOrderId: z.uuid().nullish(),
});

/** Plain-language reasons for Nebius failures; the upstream detail is logged, not shown. */
function upstreamError(error: NebiusError): HttpError {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return new HttpError(
        502,
        'Verity is unavailable: the AI service rejected the server key (401). An administrator needs to check NEBIUS_API_KEY.',
        'ASSISTANT_UNAUTHORIZED',
      );
    case 'RATE_LIMITED':
      return new HttpError(429, 'Verity is busy right now: the AI service is rate-limited (429). Try again in a minute.', 'ASSISTANT_RATE_LIMITED');
    case 'MODEL_NOT_FOUND':
      return new HttpError(502, 'Verity is unavailable: the assistant model is not configured correctly.', 'ASSISTANT_MODEL');
    case 'TIMEOUT':
      return new HttpError(504, 'Verity took too long to answer. Try again.', 'ASSISTANT_TIMEOUT');
    default:
      return new HttpError(502, 'Verity could not reach the AI service. Try again shortly.', 'ASSISTANT_UPSTREAM');
  }
}

/**
 * POST /api/assistant: Verity, read-only. The backend loads the user's own data (by role),
 * sends it with the question to Nemotron, and streams the answer back as NDJSON lines:
 * {"type":"delta","text":"…"} … {"type":"done"}, or {"type":"error","message":"…"}.
 */
export function createAssistantRouter({ db, chat, limiter }: { db: Db; chat: AssistantChat | null; limiter: RateLimiter }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const user = currentUser(res);
    const body = bodySchema.parse(req.body);
    if (!chat) {
      throw new HttpError(503, 'Verity is not configured on this server: NVIDIA Nemotron on Nebius is not set up.', 'ASSISTANT_NOT_CONFIGURED');
    }
    const waitMs = limiter.take(user.id);
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      res.set('Retry-After', String(seconds));
      throw new HttpError(429, `You are asking Verity a lot at once. Try again in ${seconds} s.`, 'ASSISTANT_LIMIT');
    }

    const turns = body.messages.slice(-MAX_TURNS);
    const context = await buildAssistantContext(db, user, { question: turns.at(-1)!.content, workOrderId: body.workOrderId ?? null });
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const stream = chat([{ role: 'system', content: systemPrompt(context.text) }, ...turns], abort.signal)[Symbol.asyncIterator]();
    // Wait for the first piece, so a 401 / 429 from Nebius is still a proper HTTP error.
    let first: IteratorResult<string>;
    try {
      first = await stream.next();
    } catch (error) {
      if (!(error instanceof NebiusError)) throw error;
      console.error(`Verity: ${error.code}${error.status ? ` (${error.status})` : ''}`);
      throw upstreamError(error);
    }

    // no-transform keeps compression from buffering the stream.
    res.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (line: object) => res.write(`${JSON.stringify(line)}\n`);
    try {
      for (let next = first; !next.done; next = await stream.next()) send({ type: 'delta', text: next.value });
      send({ type: 'done' });
    } catch (error) {
      if (!abort.signal.aborted) {
        console.error('Verity stream failed:', error instanceof NebiusError ? error.code : (error as Error).message);
        send({ type: 'error', message: error instanceof NebiusError ? upstreamError(error).message : 'Verity stopped unexpectedly. Try again.' });
      }
    }
    res.end();
  });

  return router;
}
