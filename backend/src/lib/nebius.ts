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
}

export class NebiusError extends Error {}

export async function chatCompletion(
  config: NebiusConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
  });

  if (!response.ok) {
    // The response body is safe to surface; the request (which carries the key) is not logged.
    const detail = await response.text();
    throw new NebiusError(`Nebius request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new NebiusError('Nebius returned an empty completion');
  return content;
}
