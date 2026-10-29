// Minimal HTTP client for Nebius Token Factory's OpenAI-compatible chat API.
// Plain fetch — no third-party AI SDK. Nebius is the only inference provider.

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface NebiusConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts after a 429, a 5xx, a timeout or a network error. */
  retries?: number;
}

/** Injection points for tests. */
export interface ChatDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type NebiusErrorCode =
  | 'UNAUTHORIZED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'EMPTY';

export class NebiusError extends Error {
  constructor(
    message: string,
    public readonly code: NebiusErrorCode,
    public readonly status: number | null = null,
    /** From a 429's Retry-After header. */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 20_000;

const retryable = (error: NebiusError) =>
  ['RATE_LIMITED', 'UPSTREAM', 'TIMEOUT', 'NETWORK'].includes(error.code);

export async function chatCompletion(
  config: NebiusConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
  deps: ChatDeps = {},
): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptCompletion(doFetch, config, messages, options);
    } catch (error) {
      if (!(error instanceof NebiusError) || !retryable(error) || attempt >= retries) throw error;
      const backoff = Math.min(MAX_BACKOFF_MS, error.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt);
      await sleep(backoff);
    }
  }
}

async function attemptCompletion(
  doFetch: typeof fetch,
  config: NebiusConfig,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<string> {
  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens,
        response_format: options.jsonMode ? { type: 'json_object' } : undefined,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error | undefined)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new NebiusError('Nebius request timed out', 'TIMEOUT');
    }
    throw new NebiusError(`Could not reach Nebius: ${(error as Error)?.message ?? error}`, 'NETWORK');
  }

  if (!response.ok) throw await httpError(response, config.model);

  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new NebiusError('Nebius returned an empty completion', 'EMPTY');
  return content;
}

async function httpError(response: Response, model: string): Promise<NebiusError> {
  // The response body is safe to surface; the request (which carries the key) is never logged.
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  const status = response.status;
  const suffix = detail ? `: ${detail}` : '';

  if (status === 401 || status === 403) {
    return new NebiusError(
      `Nebius rejected the API key (${status}). Check NEBIUS_API_KEY in the backend environment${suffix}`,
      'UNAUTHORIZED',
      status,
    );
  }
  if (status === 404 || (status === 400 && /model/i.test(detail) && /not (found|exist)|unknown|invalid/i.test(detail))) {
    return new NebiusError(
      `Nebius does not know the model "${model}" (${status}). Copy the exact model id from the Token Factory console into NEBIUS_MODEL${suffix}`,
      'MODEL_NOT_FOUND',
      status,
    );
  }
  if (status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
    return new NebiusError(`Nebius rate limit reached (429)${suffix}`, 'RATE_LIMITED', status, retryAfterMs);
  }
  if (status >= 500) return new NebiusError(`Nebius server error (${status})${suffix}`, 'UPSTREAM', status);
  return new NebiusError(`Nebius request failed (${status})${suffix}`, 'BAD_REQUEST', status);
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  /** Time to the first byte; the stream itself may take longer. */
  timeoutMs?: number;
  /** Ends the request early (e.g. the browser went away). */
  signal?: AbortSignal;
  /** Nemotron's reasoning trace; off for fast chat. */
  thinking?: boolean;
}

/**
 * Streams a chat completion as text deltas (OpenAI-compatible server-sent events). Not
 * retried: a failure before the first delta surfaces as a NebiusError, so the caller can
 * report 401 / 429 clearly. Reasoning output, if a model sends any, is dropped.
 */
export async function* chatStream(
  config: NebiusConfig,
  messages: ChatMessage[],
  options: StreamOptions = {},
  deps: ChatDeps = {},
): AsyncGenerator<string> {
  const doFetch = deps.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens,
        stream: true,
        chat_template_kwargs: { enable_thinking: options.thinking ?? false },
      }),
      signal,
    });
  } catch (error) {
    const name = (error as Error | undefined)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new NebiusError('Nebius request timed out', 'TIMEOUT');
    throw new NebiusError(`Could not reach Nebius: ${(error as Error)?.message ?? error}`, 'NETWORK');
  }
  if (!response.ok) throw await httpError(response, config.model);
  if (!response.body) throw new NebiusError('Nebius returned an empty stream', 'EMPTY');

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let inThink = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let delta: string | undefined;
        try {
          delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content ?? undefined;
        } catch {
          continue;
        }
        if (!delta) continue;
        // Some deployments inline the reasoning trace as <think>…</think>; never show it.
        let text = '';
        for (const part of delta.split(/(<\/?think>)/)) {
          if (part === '<think>') inThink = true;
          else if (part === '</think>') inThink = false;
          else if (!inThink) text += part;
        }
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
