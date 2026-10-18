import { CANNOT_VERIFY, EVIDENCE_KIND_LABELS, type Evidence } from '../types.js';
import type { AiProvider, AssessInput, DraftInput, RawAssessment } from './provider.js';

/**
 * ============================== DEV ONLY ==============================
 * Deterministic stand-in used while the Nebius API key is unavailable, so the
 * rest of the verification loop can be built and demonstrated.
 *
 * THIS IS NOT AI INFERENCE. It never opens, views, or interprets a file. It
 * only checks which *kinds* of evidence have been uploaded:
 *
 *   - every kind a requirement needs is present  → simulated PROVEN
 *   - some are present                           → simulated UNCERTAIN
 *   - none are present                           → NOT_PROVEN
 *   - a relevant file's note contains `#contradict` → simulated CONTRADICTED
 *
 * Everything it produces is flagged `simulated` and labelled in the UI and the
 * audit trail. It is refused when NODE_ENV=production (see config/env.ts) and
 * reports no confidence, because there is nothing to be confident about.
 * =======================================================================
 */

export const DEV_FIXTURE_LABEL = '[DEV FIXTURE — simulated, not AI inference]';

/** Lines that look like SOP steps: numbered, bulleted or "Step n". */
const STEP_LINE = /^\s*(?:\d+[.)]|[-*•]|step\s+\d+[:.]?)\s+(.+)$/i;
/** Fallback when the SOP has no step list: statements of duty. */
const DUTY_LINE = /\b(must|shall|ensure|verify|confirm|check|install|test|record)\b/i;
const MAX_FIXTURE_PROPOSALS = 10;
export const CONTRADICT_TAG = '#contradict';

export class DevFixtureProvider implements AiProvider {
  readonly id = 'dev-fixture' as const;
  readonly model = null;
  readonly simulated = true;

  /** `delayMs` only makes the ANALYZING state visible in the UI during development. */
  constructor(private readonly delayMs = 1200) {}

  /**
   * DEV ONLY: picks step-like lines out of the SOP verbatim. No AI reads the
   * document; the evidence kinds are a keyword guess, labelled as simulated.
   */
  async draftRequirements({ sopText }: DraftInput): Promise<unknown[]> {
    if (this.delayMs > 0) await new Promise((done) => setTimeout(done, this.delayMs));
    const lines = sopText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const steps = lines.flatMap((line) => {
      const match = line.match(STEP_LINE);
      return match ? [{ quote: line, text: match[1]!.trim() }] : [];
    });
    const candidates =
      steps.length > 0
        ? steps
        : lines.filter((line) => DUTY_LINE.test(line)).map((line) => ({ quote: line, text: line }));

    return candidates
      .filter((step) => step.text.length >= 4)
      .slice(0, MAX_FIXTURE_PROPOSALS)
      .map(({ quote, text }) => {
        const title = text.replace(/[.;:]+$/, '').slice(0, 120);
        const kind = /\b(test|function|illuminat|alarm|operat)/i.test(text)
          ? 'video'
          : /\b(wir|connect|terminal|mount|fix|bracket)/i.test(text)
            ? 'additional_photo'
            : 'after_photo';
        return {
          title,
          description: `${DEV_FIXTURE_LABEL} Copied verbatim from the SOP; no AI interpreted it.`,
          mandatory: steps.length > 0 || /\b(must|shall|required)\b/i.test(text),
          evidenceNeeds: [{ kind, instruction: `Upload evidence that shows: ${title}.` }],
          sourceQuote: quote,
        };
      });
  }
  async assess({ requirements, evidence }: AssessInput): Promise<RawAssessment[]> {
    if (this.delayMs > 0) await new Promise((done) => setTimeout(done, this.delayMs));

    return requirements.map((requirement) => {
      const neededKinds = [...new Set(requirement.evidenceNeeds.map((need) => need.kind))];
      const relevant = evidence.filter((item) => neededKinds.includes(item.kind));
      const presentKinds = new Set(relevant.map((item) => item.kind));
      const missingEvidence = requirement.evidenceNeeds.filter(
        (need) => !presentKinds.has(need.kind),
      );
      const contradicting = relevant.filter((item) => item.note.includes(CONTRADICT_TAG));

      const observe = (item: Evidence, text: string) => ({
        evidenceId: item.id,
        kind: 'direct' as const,
        text: `${DEV_FIXTURE_LABEL} ${text}`,
        startSec: null,
        endSec: null,
      });
      // Simulated inferences, so the UI's inferred links can be exercised: an attached
      // SOP/manual this requirement doesn't ask for is treated as indirect, background
      // support. Status is never based on these — only on the direct kinds above.
      const background = evidence.filter((item) => item.kind === 'document' && !neededKinds.includes(item.kind));
      const observations = [
        ...relevant.map((item) =>
          observe(
            item,
            `A file of kind "${EVIDENCE_KIND_LABELS[item.kind]}" is attached. Its content was not inspected.`,
          ),
        ),
        ...background.map((item) => ({
          ...observe(
            item,
            `Inferred, simulated: an ${EVIDENCE_KIND_LABELS[item.kind]} is attached and is assumed to describe this step. It was not read.`,
          ),
          kind: 'inferred' as const,
        })),
      ];
      const base = { requirementId: requirement.id, confidence: null };

      if (contradicting.length > 0) {
        return {
          ...base,
          status: 'CONTRADICTED',
          reasoning: `${DEV_FIXTURE_LABEL} A relevant file is tagged ${CONTRADICT_TAG}, so a contradiction is simulated.`,
          observations: contradicting.map((item) =>
            observe(item, `The uploader's note contains ${CONTRADICT_TAG}.`),
          ),
          missingEvidence: [],
        };
      }

      if (neededKinds.length > 0 && missingEvidence.length === 0) {
        return {
          ...base,
          status: 'PROVEN',
          reasoning: `${DEV_FIXTURE_LABEL} Every kind of evidence this requirement asks for is attached, so PROVEN is simulated. No model has examined the files.`,
          observations,
          missingEvidence: [],
        };
      }

      const missingLabels = missingEvidence.map((need) => EVIDENCE_KIND_LABELS[need.kind]);
      return {
        ...base,
        status: relevant.length > 0 ? 'UNCERTAIN' : 'NOT_PROVEN',
        reasoning: `${CANNOT_VERIFY} ${DEV_FIXTURE_LABEL} ${
          missingLabels.length > 0
            ? `Evidence of these kinds is not attached: ${missingLabels.join(', ')}.`
            : 'This requirement does not say what evidence would prove it.'
        }`,
        observations,
        missingEvidence,
      };
    });
  }
}
