import { z } from 'zod';
import { EVIDENCE_KINDS, type RequirementProposal } from '../types.js';

/**
 * Guard for requirements proposed from an SOP, applied to every provider answer.
 * A proposal survives only if it is well-formed and its `sourceQuote` really
 * appears in the SOP text, so the model cannot invent requirements the
 * document does not state. Proposals are never saved here — a person reviews,
 * edits and confirms them first.
 */

export const MAX_PROPOSALS = 25;

const proposalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  mandatory: z.boolean().default(true),
  evidenceNeeds: z
    .array(z.object({ kind: z.enum(EVIDENCE_KINDS), instruction: z.string().trim().min(1).max(500) }))
    .max(10)
    .catch([]),
  sourceQuote: z.string().trim().min(1).max(1000),
});

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

export function validateProposals(
  raw: unknown,
  sopText: string,
): { proposals: RequirementProposal[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const haystack = normalize(sopText);
  const seen = new Set<string>();
  const proposals: RequirementProposal[] = [];
  let dropped = 0;

  for (const candidate of list) {
    const parsed = proposalSchema.safeParse(candidate);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const proposal = parsed.data;
    // A quote may elide text with "..."; every fragment must be present.
    const fragments = normalize(proposal.sourceQuote)
      .split(/\.{3}|…/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);
    const grounded = fragments.length > 0 && fragments.every((fragment) => haystack.includes(fragment));
    const key = normalize(proposal.title);
    if (!grounded || seen.has(key) || proposals.length >= MAX_PROPOSALS) {
      dropped++;
      continue;
    }
    seen.add(key);
    // One need per kind, matching how the planner merges requests.
    const kinds = new Set<string>();
    proposal.evidenceNeeds = proposal.evidenceNeeds.filter((need) => !kinds.has(need.kind) && kinds.add(need.kind));
    proposals.push(proposal);
  }

  return { proposals, dropped };
}
