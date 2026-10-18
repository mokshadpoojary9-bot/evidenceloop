import { FileText, Film, Image, Mic, type LucideIcon } from 'lucide-react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { type EvidenceIcon, ringLayout, type VerificationGraph } from '../lib/verificationGraph';
import type { GraphHover } from './GraphScene';
import { REQUIREMENT_STATUS } from './labels';

// The work-order graph in 2D: shown without WebGL, when the context is lost, or when the
// device measured too slow. Same data, same layout, same actions as the 3D scene, and
// every node is a keyboard-reachable button.

const ICONS: Record<EvidenceIcon, LucideIcon> = { photo: Image, video: Film, document: FileText, audio: Mic };
const AMBER = '#f5a524';
const CX = 200;
const CY = 130;
const OUTER = { rx: 170, ry: 96 };
const INNER = { rx: 84, ry: 46 };

interface Props {
  graph: VerificationGraph;
  label: string;
  animate: boolean;
  onHover: (hover: GraphHover | null) => void;
  onSelectRequirement: (id: string) => void;
  onOpenEvidence: (id: string) => void;
}

export function GraphView2D({ graph, label, animate, onHover, onSelectRequirement, onOpenEvidence }: Props) {
  // Sizes come from the short axis of each ellipse, so neighbours never overlap.
  const outer = ringLayout(graph.requirements.length, OUTER.ry, 14);
  const inner = ringLayout(graph.evidence.length, INNER.ry, 11);
  const at = (angle: number, ring: { rx: number; ry: number }) => ({
    x: CX + Math.sin(angle) * ring.rx,
    y: CY - Math.cos(angle) * ring.ry,
  });
  const requirementAt = new Map(graph.requirements.map((r, i) => [r.id, { ...at(outer.angle(i), OUTER), angle: outer.angle(i), node: r }]));
  const evidenceAt = new Map(graph.evidence.map((e, i) => [e.id, at(inner.angle(i), INNER)]));

  const hover = (kind: GraphHover['kind'], id: string) => (event: MouseEvent<SVGGElement> | FocusEvent<SVGGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const frame = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
    if (!frame) return;
    onHover({ kind, id, x: box.left + box.width / 2 - frame.left, y: box.top - frame.top });
  };
  const activate = (action: () => void) => ({
    onClick: () => {
      onHover(null);
      action();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onHover(null);
        action();
      }
    },
  });

  return (
    <svg viewBox="0 0 400 260" className="h-full w-full" role="group" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <ellipse cx={CX} cy={CY} rx={OUTER.rx} ry={OUTER.ry} fill="none" stroke="#3b4a69" />
      <ellipse cx={CX} cy={CY} rx={INNER.rx} ry={INNER.ry} fill="none" stroke="#2a3550" />

      {graph.links.map((link) => {
        const from = evidenceAt.get(link.evidenceId);
        const to = requirementAt.get(link.requirementId);
        if (!from || !to) return null;
        return (
          <line
            key={`${link.evidenceId}|${link.requirementId}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={REQUIREMENT_STATUS[to.node.status].hex}
            strokeOpacity={link.direct ? 0.85 : 0.35}
            strokeWidth={link.direct ? 1.5 : 1}
            strokeDasharray={link.direct ? undefined : '3 3'}
          />
        );
      })}

      {[...requirementAt.values()].map(({ x, y, angle, node }) => {
        const meta = REQUIREMENT_STATUS[node.status];
        const r = outer.size;
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`Requirement ${node.position}, ${node.title}: ${meta.label}${node.requested ? ', evidence requested' : ''}. Show it in the checklist.`}
            className="cursor-pointer"
            onMouseEnter={hover('requirement', node.id)}
            onFocus={hover('requirement', node.id)}
            onMouseLeave={() => onHover(null)}
            onBlur={() => onHover(null)}
            {...activate(() => onSelectRequirement(node.id))}
          >
            <circle cx={x} cy={y} r={r} fill={meta.hex} className={node.pulsing && animate ? 'animate-pulse' : undefined} />
            <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={Math.max(8, r * 1.05)} fontWeight={700} fill="#0b111c">
              {node.position}
            </text>
            {node.requested && (
              <rect
                x={x + Math.sin(angle) * (r + 7) - 3.5}
                y={y - Math.cos(angle) * (r + 7) - 3.5}
                width={7}
                height={7}
                fill={AMBER}
                transform={`rotate(45 ${x + Math.sin(angle) * (r + 7)} ${y - Math.cos(angle) * (r + 7)})`}
              />
            )}
          </g>
        );
      })}

      {graph.evidence.map((item) => {
        const { x, y } = evidenceAt.get(item.id)!;
        const r = inner.size;
        const Icon = ICONS[item.icon];
        return (
          <g
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${item.label}`}
            className="cursor-pointer"
            onMouseEnter={hover('evidence', item.id)}
            onFocus={hover('evidence', item.id)}
            onMouseLeave={() => onHover(null)}
            onBlur={() => onHover(null)}
            {...activate(() => onOpenEvidence(item.id))}
          >
            <circle cx={x} cy={y} r={r} fill="#0b111c" stroke="#94a3b8" />
            <Icon x={x - r * 0.55} y={y - r * 0.55} width={r * 1.1} height={r * 1.1} color="#e2e8f0" aria-hidden />
          </g>
        );
      })}
    </svg>
  );
}

/** Title and status of the hovered node, over the scene (3D or 2D). */
export function GraphTooltip({ graph, hover, width }: { graph: VerificationGraph; hover: GraphHover | null; width: number }) {
  if (!hover) return null;
  let title: string;
  let detail: string;
  if (hover.kind === 'requirement') {
    const node = graph.requirements.find((r) => r.id === hover.id);
    if (!node) return null;
    title = `${node.position}. ${node.title}`;
    detail = REQUIREMENT_STATUS[node.status].label + (node.requested ? ' · evidence requested' : '');
  } else {
    const item = graph.evidence.find((e) => e.id === hover.id);
    if (!item) return null;
    const links = graph.links.filter((l) => l.evidenceId === item.id);
    const direct = links.filter((l) => l.direct).length;
    title = item.label;
    detail =
      links.length === 0
        ? 'Not cited by any assessment yet'
        : `Cited for ${links.length} requirement${links.length === 1 ? '' : 's'} · ${direct} direct`;
  }
  // Kept inside the frame: half the tooltip's max width (14rem) from either edge.
  const x = Math.min(Math.max(hover.x, 112), Math.max(width - 112, 112));
  // Near the top edge it opens below the node instead.
  const below = hover.y < 64;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-surface/95 px-2.5 py-1.5 text-xs shadow-lg ${below ? '' : '-translate-y-full'}`}
      style={{ left: x, top: below ? hover.y + 28 : hover.y - 10 }}
    >
      <p className="font-semibold text-fg">{title}</p>
      <p className="text-fg-subtle">{detail}</p>
    </div>
  );
}
