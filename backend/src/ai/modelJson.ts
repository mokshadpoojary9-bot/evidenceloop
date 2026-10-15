/**
 * Extracts the JSON object from a model completion.
 *
 * Nemotron models may emit reasoning before the answer (`<think>…</think>` or plain prose),
 * wrap the answer in ``` fences, or add a sentence afterwards. This finds the first
 * candidate that parses as a JSON object, preferring fenced blocks and text after any
 * reasoning block. It never repairs or guesses at malformed JSON: if nothing parses, it
 * returns null and the verification policy treats every requirement as NOT_PROVEN.
 */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const withoutReasoning = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '');

  const candidates: string[] = [];
  for (const match of withoutReasoning.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) {
    candidates.push(match[1]!);
  }
  candidates.push(withoutReasoning);

  for (const candidate of candidates) {
    for (const object of balancedObjects(candidate)) {
      try {
        const value: unknown = JSON.parse(object);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // not valid JSON; try the next candidate
      }
    }
  }
  return null;
}

/** Yields each top-level `{…}` span, respecting strings and escapes. */
function* balancedObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth > 0) inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0) yield text.slice(start, i + 1);
    }
  }
}
