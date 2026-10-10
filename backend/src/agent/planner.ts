import type { Evidence, EvidenceKind, EvidenceNeed, Requirement } from '../types.js';

export interface PlannedRequest {
  kind: EvidenceKind;
  instruction: string;
  requirementIds: string[];
}

export interface UnresolvedRequirement {
  requirement: Requirement;
  /** What the latest assessment said is missing; may be empty. */
  missingEvidence: EvidenceNeed[];
}

/**
 * Plans the minimum set of evidence requests.
 *
 * Only mandatory requirements that are NOT_PROVEN or UNCERTAIN generate requests
 * (optional ones do not block verification; contradictions need a person, not
 * more uploads). Needs of the same kind are merged, so one upload — e.g. a single
 * functional-test video — can settle several requirements at once.
 */
export function planEvidenceRequests(
  unresolved: UnresolvedRequirement[],
  evidence: Pick<Evidence, 'kind'>[],
): PlannedRequest[] {
  const present = new Set(evidence.map((item) => item.kind));
  const byKind = new Map<EvidenceKind, { instructions: string[]; requirementIds: string[] }>();

  for (const { requirement, missingEvidence } of unresolved) {
    if (!requirement.mandatory) continue;
    if (requirement.status !== 'NOT_PROVEN' && requirement.status !== 'UNCERTAIN') continue;

    for (const need of needsFor(requirement, missingEvidence, present)) {
      const group = byKind.get(need.kind) ?? { instructions: [], requirementIds: [] };
      if (!group.instructions.includes(need.instruction)) group.instructions.push(need.instruction);
      if (!group.requirementIds.includes(requirement.id)) group.requirementIds.push(requirement.id);
      byKind.set(need.kind, group);
    }
  }

  return [...byKind].map(([kind, group]) => ({
    kind,
    instruction: group.instructions.join(' '),
    requirementIds: group.requirementIds,
  }));
}

function needsFor(
  requirement: Requirement,
  missingEvidence: EvidenceNeed[],
  present: ReadonlySet<EvidenceKind>,
): EvidenceNeed[] {
  // 1. Prefer what the assessment itself identified as missing.
  if (missingEvidence.length > 0) return missingEvidence;
  // 2. Otherwise, the kinds this requirement asks for that nobody has uploaded yet.
  const absent = requirement.evidenceNeeds.filter((need) => !present.has(need.kind));
  if (absent.length > 0) return absent;
  // 3. Everything was uploaded and it still was not enough: ask again, more specifically.
  if (requirement.evidenceNeeds.length > 0) return requirement.evidenceNeeds;
  return [
    {
      kind: 'additional_photo',
      instruction: `Upload a clear photo that demonstrates: ${requirement.title}.`,
    },
  ];
}
