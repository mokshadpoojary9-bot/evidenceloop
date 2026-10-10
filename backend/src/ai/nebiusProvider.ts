import { chatCompletion, type ChatMessage, type ContentPart, type NebiusConfig } from '../lib/nebius.js';
import type { FileStore } from '../stores/fileStore.js';
import { CANNOT_VERIFY, EVIDENCE_KINDS, EVIDENCE_KIND_LABELS, type Evidence } from '../types.js';
import type { AiProvider, AssessInput } from './provider.js';

/**
 * Production AI provider: NVIDIA Nemotron served by Nebius Token Factory.
 *
 * STATUS: written against Nebius's OpenAI-compatible chat API but NOT yet run
 * against the live service — no API key is available. It is only constructed
 * when NEBIUS_API_KEY and NEBIUS_MODEL are both set (see ai/index.ts).
 *
 * What the model can currently inspect:
 *   - images          → sent inline
 *   - text/transcript → sent inline
 *   - PDF, video, audio → NOT yet inspectable. They are listed to the model as
 *     "attached but not inspected" so it cannot claim to have seen them.
 *     (Next stage: PDF text extraction, video frame sampling, audio transcription.)
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

const SYSTEM_PROMPT = `You are EvidenceLoop, an evidence-verification agent. You decide whether the supplied evidence PROVES that each requirement of a real-world work order was met. You are not classifying images; you are judging proof.

Rules you must follow:
- Never invent evidence. Never describe anything that is not present in the supplied evidence.
- Evidence listed as "attached but NOT inspected" has not been shown to you. You must not make any observation about its content.
- Separate what you directly observe ("direct") from what you conclude from it ("inferred").
- PROVEN requires at least one direct observation that is sufficient on its own terms. If you would have to guess, the requirement is not proven.
- Use NOT_PROVEN when the evidence does not address the requirement, UNCERTAIN when it addresses it but is ambiguous or incomplete, and CONTRADICTED when evidence conflicts with the requirement or with other evidence.
- For NOT_PROVEN and UNCERTAIN, the reasoning must begin with exactly: "${CANNOT_VERIFY}"
- For every requirement that is not PROVEN, list the minimum additional evidence that would settle it, as specific, actionable instructions a technician can follow.
- "confidence" is your own calibrated probability (0 to 1) that the status is correct. Use null if you cannot estimate it. Do not inflate it.
- For video or audio, give startSec/endSec for each observation when you can; otherwise null.
- Never state or imply that physical safety is guaranteed.

Respond with a single JSON object and nothing else:
{
  "assessments": [
    {
      "requirementId": "<id>",
      "status": "PROVEN" | "NOT_PROVEN" | "UNCERTAIN" | "CONTRADICTED",
      "observations": [
        { "evidenceId": "<id>", "kind": "direct" | "inferred", "text": "<what is observed>", "startSec": <number|null>, "endSec": <number|null> }
      ],
      "reasoning": "<how the observations do or do not prove the requirement>",
      "confidence": <number between 0 and 1, or null>,
      "missingEvidence": [
        { "kind": ${EVIDENCE_KINDS.map((kind) => `"${kind}"`).join(' | ')}, "instruction": "<specific request>" }
      ]
    }
  ]
}
Return exactly one assessment for every requirement you are given.`;

export class NebiusNemotronProvider implements AiProvider {
  readonly id = 'nebius-nemotron' as const;
  readonly simulated = false;

  constructor(
    private readonly config: NebiusConfig,
    private readonly files: FileStore,
  ) {}

  get model() {
    return this.config.model;
  }

  async assess({ workOrder, requirements, evidence }: AssessInput): Promise<unknown[]> {
    const parts: ContentPart[] = [
      {
        type: 'text',
        text: [
          `WORK ORDER: ${workOrder.title}`,
          ...(workOrder.location ? [`LOCATION: ${workOrder.location}`] : []),
          ...(workOrder.description ? [`DESCRIPTION: ${workOrder.description}`] : []),
          '',
          'REQUIREMENTS TO ASSESS:',
          ...requirements.map(
            (r) =>
              `- requirementId=${r.id} | ${r.mandatory ? 'mandatory' : 'optional'} | ${r.title}: ${r.description}`,
          ),
          '',
          'EVIDENCE:',
        ].join('\n'),
      },
    ];

    for (const item of evidence) {
      parts.push(...(await this.describeEvidence(item)));
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ];

    const completion = await chatCompletion(this.config, messages, { jsonMode: true });
    const parsed = parseJsonObject(completion);
    const assessments = (parsed as { assessments?: unknown })?.assessments;
    // Anything malformed is handed to the policy as "no valid assessment" → NOT_PROVEN.
    return Array.isArray(assessments) ? assessments : [];
  }

  private async describeEvidence(item: Evidence): Promise<ContentPart[]> {
    const header =
      `evidenceId=${item.id} | kind=${EVIDENCE_KIND_LABELS[item.kind]} | file=${item.fileName}` +
      (item.note ? ` | uploader note (unverified claim): ${item.note}` : '');

    if (item.mimeType.startsWith('image/') && item.sizeBytes <= MAX_IMAGE_BYTES) {
      const data = await this.files.read(item.storagePath);
      return [
        { type: 'text', text: `${header} | image follows:` },
        {
          type: 'image_url',
          image_url: { url: `data:${item.mimeType};base64,${data.toString('base64')}` },
        },
      ];
    }

    if (item.mimeType.startsWith('text/')) {
      const text = (await this.files.read(item.storagePath)).toString('utf8');
      return [
        {
          type: 'text',
          text: `${header} | text content follows:\n"""\n${text.slice(0, MAX_TEXT_CHARS)}\n"""`,
        },
      ];
    }

    return [
      {
        type: 'text',
        text: `${header} | attached but NOT inspected — you have not seen its content and must not describe it.`,
      },
    ];
  }
}

/** Models sometimes wrap JSON in prose or code fences; take the outermost object. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
