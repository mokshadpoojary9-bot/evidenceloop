import { chatCompletion, NebiusError, type ChatMessage, type ContentPart, type NebiusConfig } from '../lib/nebius.js';
import { extractPdfText, MAX_TEXT_CHARS } from '../media/pdfText.js';
import { sampleVideoFrames } from '../media/videoFrames.js';
import type { FileStore } from '../stores/fileStore.js';
import { CANNOT_VERIFY, EVIDENCE_KINDS, EVIDENCE_KIND_LABELS, type Evidence } from '../types.js';
import { formatTimestamp } from './format.js';
import { parseModelJson } from './modelJson.js';
import type { AiProvider, AssessInput, DraftInput } from './provider.js';

/**
 * Production AI provider: NVIDIA Nemotron served by Nebius Token Factory.
 *
 * Uses Nebius's OpenAI-compatible chat API; verified live with
 * nvidia/Nemotron-3.5-Super-VL (npm run check:nebius). It is only constructed
 * when NEBIUS_API_KEY and NEBIUS_MODEL are both set (see ai/index.ts), and each
 * backend proves its own connection with a startup live test (ai/liveCheck.ts).
 *
 * What the model can inspect:
 *   - images          → sent inline (needs a vision-capable Nemotron model)
 *   - text/transcript → sent inline, capped at MAX_TEXT_CHARS
 *   - PDF             → text layer extracted on the backend, capped at MAX_TEXT_CHARS.
 *                       Scans without a text layer are "attached but not inspected".
 *   - video           → up to 8 still frames (about one every 2 s), labelled with timestamps
 *   - audio (and video soundtracks) → NOT inspected; there is no transcription.
 * Anything not inspected is listed to the model as such, so it cannot claim to have seen it.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
- A video is shown to you as still frames, each labelled with its timestamp. Cite the video's evidenceId (not a frame) and give startSec/endSec from the frame timestamps you relied on. You have NOT seen what happens between frames and have NOT heard any audio; do not describe either.
- For audio, give startSec/endSec when you can; otherwise null.
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

const DRAFT_PROMPT = `You are EvidenceLoop. From an SOP or equipment manual, you propose the requirements a technician must prove with evidence for a work order. A person will review, edit and confirm your list before anything is saved.

Rules you must follow:
- Only propose requirements the SOP text actually states. Never invent steps, values, models or tolerances.
- For each requirement, copy the exact SOP sentence it comes from into "sourceQuote", verbatim (you may shorten it with "..." between verbatim fragments). Proposals whose quote is not in the SOP are discarded.
- Each requirement must be something evidence can prove or disprove: an observable state or an action that can be recorded.
- "mandatory" is true when the SOP says must, shall or required; false for should, may or recommended.
- For each requirement, list the evidence that would prove it, as specific instructions a technician can follow on site. Allowed kinds: ${EVIDENCE_KINDS.map((kind) => `"${kind}"`).join(', ')}.
- Prefer a few precise requirements over many vague ones. At most 20.
- Never state or imply that following the SOP guarantees safety.

Respond with a single JSON object and nothing else:
{
  "requirements": [
    {
      "title": "<short, checkable statement>",
      "description": "<what must be true, in the SOP's terms>",
      "mandatory": true | false,
      "evidenceNeeds": [ { "kind": "<kind>", "instruction": "<specific request>" } ],
      "sourceQuote": "<verbatim SOP text>"
    }
  ]
}`;

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

    const parsed = parseModelJson(await this.complete(messages));
    const assessments = (parsed as { assessments?: unknown })?.assessments;
    // Anything malformed is handed to the policy as "no valid assessment" → NOT_PROVEN.
    return Array.isArray(assessments) ? assessments : [];
  }

  async draftRequirements({ sopText, truncated, context }: DraftInput): Promise<unknown[]> {
    const messages: ChatMessage[] = [
      { role: 'system', content: DRAFT_PROMPT },
      {
        role: 'user',
        content: [
          ...(context.title ? [`WORK ORDER: ${context.title}`] : []),
          ...(context.location ? [`LOCATION: ${context.location}`] : []),
          ...(context.description ? [`DESCRIPTION: ${context.description}`] : []),
          '',
          `SOP / MANUAL TEXT${truncated ? ` (first ${MAX_TEXT_CHARS} characters only; the rest was not supplied)` : ''}:`,
          '"""',
          sopText,
          '"""',
        ].join('\n'),
      },
    ];
    const parsed = parseModelJson(await this.complete(messages));
    const requirements = parsed?.requirements;
    return Array.isArray(requirements) ? requirements : [];
  }

  /** JSON-mode completion, retried without response_format for models that reject it. */
  private async complete(messages: ChatMessage[]): Promise<string> {
    try {
      return await chatCompletion(this.config, messages, { jsonMode: true });
    } catch (error) {
      if (!(error instanceof NebiusError && error.code === 'BAD_REQUEST' && /response_format|json/i.test(error.message))) {
        throw error;
      }
      return chatCompletion(this.config, messages);
    }
  }

  private async describeEvidence(item: Evidence): Promise<ContentPart[]> {
    const header =
      `evidenceId=${item.id} | kind=${EVIDENCE_KIND_LABELS[item.kind]} | file=${item.fileName}` +
      (item.note ? ` | uploader note (unverified claim): ${item.note}` : '');
    const notInspected = (reason: string): ContentPart[] => [
      {
        type: 'text',
        text: `${header} | attached but NOT inspected (${reason}) — you have not seen its content and must not describe it.`,
      },
    ];

    if (item.mimeType.startsWith('image/')) {
      if (item.sizeBytes > MAX_IMAGE_BYTES) return notInspected('image larger than 5 MB');
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
          text: `${header} | text content follows${text.length > MAX_TEXT_CHARS ? ` (first ${MAX_TEXT_CHARS} characters only)` : ''}:
"""
${text.slice(0, MAX_TEXT_CHARS)}
"""`,
        },
      ];
    }

    if (item.mimeType === 'application/pdf') {
      const pdf = await extractPdfText(await this.files.read(item.storagePath));
      if (!pdf.ok) return notInspected(`PDF ${pdf.reason}`);
      return [
        {
          type: 'text',
          text:
            `${header} | PDF, ${pdf.pages} page(s). Extracted text layer follows` +
            `${pdf.truncated ? ` (first ${MAX_TEXT_CHARS} characters only; the rest was NOT inspected)` : ''}. ` +
            `Images and drawings inside the PDF were NOT inspected:
"""
${pdf.text}
"""`,
        },
      ];
    }

    if (item.mimeType.startsWith('video/')) {
      const video = await sampleVideoFrames(await this.files.read(item.storagePath));
      if (!video.ok) return notInspected(`video ${video.reason}`);
      const parts: ContentPart[] = [
        {
          type: 'text',
          text:
            `${header} | video${video.durationSec !== null ? ` of ${video.durationSec.toFixed(1)} s` : ''}, shown as ` +
            `${video.frames.length} still frame(s) at the timestamps below. Nothing between frames was inspected.` +
            (video.hasAudio ? ' The soundtrack was NOT inspected.' : ''),
        },
      ];
      for (const frame of video.frames) {
        parts.push(
          { type: 'text', text: `evidenceId=${item.id} frame at t=${formatTimestamp(frame.timeSec)} (${frame.timeSec} s):` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}` } },
        );
      }
      return parts;
    }

    if (item.mimeType.startsWith('audio/')) return notInspected('audio transcription is not available');
    return notInspected('unsupported file type');
  }
}
