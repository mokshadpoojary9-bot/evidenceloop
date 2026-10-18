import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { type HeroMotion, STATIONS } from '../lib/evidenceLoop';
import type { RequirementStatus } from '../types';
import { REQUIREMENT_STATUS } from './labels';

// The 3D code (three, R3F, drei, postprocessing) is a separate chunk, fetched only
// where it will actually be shown.
const LoopScene = lazy(() => import('./LoopScene'));

type Props = { className?: string } & (
  | { variant: 'status'; statuses: RequirementStatus[]; coreHex: string }
  | { variant: 'hero'; motion: RefObject<HeroMotion>; activeStation: number }
);

export const HERO_LABEL =
  'Animated diagram of the evidence loop: evidence cards for photos, video and documents travel around a ring ' +
  'through six stations — Upload, Analyze, Map to requirement, Decide, Request more, Re-analyze. At Decide a card ' +
  'turns green when the evidence proves the requirement, or amber when more is needed; amber cards go to Request ' +
  'more and loop back to be re-analyzed.';

/**
 * The verification loop, in 3D where the device can afford it, otherwise as a 2D drawing
 * of the same loop. Renders nothing while off-screen or in a hidden tab, holds still under
 * prefers-reduced-motion, and falls back to 2D if the WebGL context is lost.
 */
export function LoopVisual(props: Props) {
  const { className = '' } = props;
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const [capable] = useState(canRender3D);
  const [lost, setLost] = useState(false);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const active = useOnScreen(container);

  const statusLabel =
    props.variant === 'status'
      ? `Verification loop: ${props.statuses.map((s, i) => `requirement ${i + 1} ${REQUIREMENT_STATUS[s].label}`).join(', ')}`
      : HERO_LABEL;
  const statuses = props.variant === 'status' ? props.statuses : null;
  const nodes = useMemo(
    () => (statuses ?? []).map((status) => ({ hex: REQUIREMENT_STATUS[status].hex, pulsing: status === 'ANALYZING' })),
    [statuses],
  );

  const flat =
    props.variant === 'hero' ? (
      <HeroLoop2D activeStation={props.activeStation} />
    ) : (
      <FlatLoop statuses={props.statuses} label={statusLabel} />
    );
  const show3D = capable && !lost;
  const common = { animate: !reducedMotion, active, label: statusLabel, onContextLost: () => setLost(true) };

  return (
    <div ref={container} className={className}>
      {show3D ? (
        <SceneBoundary fallback={flat}>
          {/* While the 3D chunk loads, the hero shows its static gradient; a work order shows the flat loop. */}
          <Suspense fallback={props.variant === 'hero' ? null : flat}>
            {props.variant === 'hero' ? (
              <LoopScene
                {...common}
                variant="hero"
                motion={props.motion}
                activeStation={props.activeStation}
                labels={labels}
              />
            ) : (
              <LoopScene {...common} variant="status" nodes={nodes} coreHex={props.coreHex} />
            )}
          </Suspense>
        </SceneBoundary>
      ) : (
        flat
      )}

      {show3D && props.variant === 'hero' && (
        // Station names, positioned over the canvas by the scene each frame. They repeat the
        // step list beside the hero, so assistive technology skips them.
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {STATIONS.map((station, k) => (
            <span
              key={station.label}
              ref={(el) => void (labels.current[k] = el)}
              style={{ opacity: 0 }}
              className={`absolute top-0 left-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide whitespace-nowrap backdrop-blur-sm transition-colors duration-500 ${
                k === props.activeStation
                  ? 'border-[#76b900]/60 bg-[#76b900]/15 text-white'
                  : 'border-white/10 bg-black/40 text-slate-300 max-sm:hidden'
              }`}
            >
              {station.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** WebGL 2, and not a low-end phone (little memory or few cores) or a data-saver connection. */
function canRender3D(): boolean {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return false;
  } catch {
    return false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory < 4;
  const fewCores = nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4;
  return !(touch && (lowMemory || fewCores));
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** True while the element is (nearly) in view and the tab is visible. */
function useOnScreen(target: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    const el = target.current;
    let observer: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true), { rootMargin: '120px' });
      observer.observe(el);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [target]);
  return inView && visible;
}

// ---------------------------------------------------------------- 2D fallbacks

const NV_GREEN = '#76b900';
const AMBER = '#f5a524';

/** The hero's loop in 2D: the same ring, six stations and example cards, as SVG. */
function HeroLoop2D({ activeStation }: { activeStation: number }) {
  const cx = 200;
  const cy = 150;
  const rx = 150;
  const ry = 72;
  const at = (k: number, scale = 1) => {
    const angle = (k / STATIONS.length) * Math.PI * 2;
    return { x: cx + Math.sin(angle) * rx * scale, y: cy + Math.cos(angle) * ry * scale };
  };
  // Example cards: arriving, analyzing, decided green, needing more (amber), re-analyzing.
  const cards = [
    { k: 0.15, hex: '#cbd5e1' },
    { k: 1, hex: '#cbd5e1' },
    { k: 3, hex: NV_GREEN },
    { k: 4, hex: AMBER },
    { k: 5.2, hex: '#7dd3fc', inner: true },
  ];

  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label={HERO_LABEL} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="loop2d-glow">
          <stop offset="0" stopColor={NV_GREEN} stopOpacity="0.25" />
          <stop offset="1" stopColor={NV_GREEN} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy + 14} rx={190} ry={100} fill="url(#loop2d-glow)" />
      <ellipse cx={cx} cy={cy} rx={rx * 0.82} ry={ry * 0.82} fill="none" stroke={AMBER} strokeOpacity="0.4" strokeDasharray="3 5" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={NV_GREEN} strokeOpacity="0.25" strokeWidth="8" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={NV_GREEN} strokeWidth="1.6" />
      {STATIONS.map((station, k) => {
        const { x, y } = at(k);
        const activeHere = k === activeStation;
        const hex = k === 4 ? AMBER : NV_GREEN;
        return (
          <g key={station.label}>
            <circle cx={x} cy={y} r={activeHere ? 6 : 4} fill={hex} />
            <circle cx={x} cy={y} r={activeHere ? 11 : 8} fill="none" stroke={hex} strokeOpacity={activeHere ? 0.9 : 0.4} />
            <text
              x={x}
              y={y + (y > cy ? 24 : -14)}
              textAnchor="middle"
              fontSize="11"
              fontWeight={activeHere ? 700 : 500}
              fill={activeHere ? '#ffffff' : '#94a3b8'}
            >
              {station.label}
            </text>
          </g>
        );
      })}
      {cards.map(({ k, hex, inner }, index) => {
        // Cards sit just inside the ring, so the station names outside it stay readable.
        const { x, y } = at(k, inner ? 0.7 : 0.86);
        return (
          <rect key={index} x={x - 13} y={y - 9.5} width={26} height={19} rx={4} fill="#0b111c" stroke={hex} strokeWidth="1.5" />
        );
      })}
    </svg>
  );
}

function FlatLoop({ statuses, label }: { statuses: RequirementStatus[]; label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2" role="img" aria-label={label}>
      {statuses.map((status, index) => (
        <span
          key={index}
          className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-ink-950"
          style={{ backgroundColor: REQUIREMENT_STATUS[status].hex }}
        >
          {index + 1}
        </span>
      ))}
    </div>
  );
}

/** If the 3D scene throws, fall back instead of breaking the page. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
