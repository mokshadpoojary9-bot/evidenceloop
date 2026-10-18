// The verification state of one work order as a graph: requirements on an outer ring,
// evidence on an inner ring, and a link wherever an observation ties the two together.
// Pure data and layout; drawn by the 3D scene and by its 2D fallback.
import { EVIDENCE_KIND_LABELS, REQUIREMENT_STATUS_LABELS, type EvidenceKind, type RequirementStatus, type WorkOrderDetail } from '../types';

export type EvidenceIcon = 'photo' | 'video' | 'document' | 'audio';

export interface GraphRequirement {
  id: string;
  position: number;
  title: string;
  status: RequirementStatus;
  /** Being re-checked by the run in progress. */
  pulsing: boolean;
  /** An open evidence request names this requirement. */
  requested: boolean;
}

export interface GraphEvidence {
  id: string;
  icon: EvidenceIcon;
  label: string;
}

export interface GraphLink {
  evidenceId: string;
  requirementId: string;
  /** At least one direct observation; otherwise the link is only inferred. */
  direct: boolean;
}

export interface VerificationGraph {
  requirements: GraphRequirement[];
  evidence: GraphEvidence[];
  links: GraphLink[];
}

const ICONS: Record<EvidenceKind, EvidenceIcon> = {
  before_photo: 'photo',
  after_photo: 'photo',
  additional_photo: 'photo',
  video: 'video',
  document: 'document',
  transcript: 'document',
  audio: 'audio',
};

export function buildGraph(detail: Pick<WorkOrderDetail, 'requirements' | 'evidence' | 'requests' | 'runs'>): VerificationGraph {
  const running = new Set(detail.runs.filter((run) => run.status === 'RUNNING').flatMap((run) => run.requirementIds));
  const requested = new Set(detail.requests.filter((r) => r.status === 'OPEN').flatMap((r) => r.requirementIds));
  const evidenceIds = new Set(detail.evidence.map((item) => item.id));

  const links: GraphLink[] = [];
  for (const requirement of detail.requirements) {
    const direct = new Map<string, boolean>();
    for (const observation of requirement.assessment?.observations ?? []) {
      if (!evidenceIds.has(observation.evidenceId)) continue;
      direct.set(observation.evidenceId, (direct.get(observation.evidenceId) ?? false) || observation.kind === 'direct');
    }
    for (const [evidenceId, isDirect] of direct) links.push({ evidenceId, requirementId: requirement.id, direct: isDirect });
  }

  return {
    requirements: [...detail.requirements]
      .sort((a, b) => a.position - b.position)
      .map((r) => ({
        id: r.id,
        position: r.position,
        title: r.title,
        status: r.status,
        pulsing: r.status === 'ANALYZING' || running.has(r.id),
        requested: requested.has(r.id),
      })),
    evidence: detail.evidence.map((item) => ({
      id: item.id,
      icon: ICONS[item.kind],
      label: `${EVIDENCE_KIND_LABELS[item.kind]}: ${item.fileName}`,
    })),
    links,
  };
}

const SUMMARY_ORDER: RequirementStatus[] = ['ANALYZING', 'CONTRADICTED', 'UNCERTAIN', 'NOT_PROVEN'];

/** "4 of 6 proven · 1 uncertain · 1 not proven" */
export function summarize(statuses: RequirementStatus[]): string {
  if (statuses.length === 0) return 'No requirements yet';
  const count = (status: RequirementStatus) => statuses.filter((s) => s === status).length;
  const parts = [`${count('PROVEN')} of ${statuses.length} proven`];
  for (const status of SUMMARY_ORDER) {
    const n = count(status);
    if (n > 0) parts.push(`${n} ${REQUIREMENT_STATUS_LABELS[status].toLowerCase()}`);
  }
  return parts.join(' · ');
}

/** What the canvas shows, for screen readers. */
export function describeGraph(graph: VerificationGraph): string {
  const requirements = graph.requirements
    .map((r) => `${r.position} ${r.title}: ${REQUIREMENT_STATUS_LABELS[r.status]}${r.requested ? ', evidence requested' : ''}`)
    .join('; ');
  const direct = graph.links.filter((l) => l.direct).length;
  return (
    `Verification graph: ${summarize(graph.requirements.map((r) => r.status))}. ${requirements}. ` +
    `${graph.evidence.length} evidence ${graph.evidence.length === 1 ? 'file' : 'files'}, ` +
    `${direct} direct and ${graph.links.length - direct} inferred links to requirements.`
  );
}

/**
 * Even spacing on a ring, starting at the far side and running clockwise as seen from
 * above. Node size shrinks with the count so neighbours never touch (1 to 30+ nodes).
 */
export function ringLayout(count: number, radius: number, maxSize: number) {
  const chord = count > 1 ? 2 * radius * Math.sin(Math.PI / count) : Infinity;
  return {
    size: Math.min(maxSize, chord / 2.6),
    angle: (index: number) => (count > 0 ? (index / count) * Math.PI * 2 : 0),
  };
}
