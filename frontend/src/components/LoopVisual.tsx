import { Component, lazy, Suspense, useMemo, type ReactNode } from 'react';
import type { RequirementStatus } from '../types';
import { REQUIREMENT_STATUS } from './labels';

const LoopScene = lazy(() => import('./LoopScene'));

interface Props {
  statuses: RequirementStatus[];
  coreHex: string;
  className?: string;
}

const supportsWebGL2 = (() => {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
})();

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** 3D view of the verification loop, with a flat fallback where WebGL 2 is unavailable. */
export function LoopVisual({ statuses, coreHex, className = '' }: Props) {
  const nodes = useMemo(
    () => statuses.map((status) => ({ hex: REQUIREMENT_STATUS[status].hex, pulsing: status === 'ANALYZING' })),
    [statuses],
  );
  const label = `Verification loop: ${statuses.map((s, i) => `requirement ${i + 1} ${REQUIREMENT_STATUS[s].label}`).join(', ')}`;
  const fallback = <FlatLoop statuses={statuses} />;

  return (
    <div className={className} role="img" aria-label={label}>
      {supportsWebGL2 ? (
        <SceneBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <LoopScene nodes={nodes} coreHex={coreHex} animate={!reducedMotion} />
          </Suspense>
        </SceneBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}

function FlatLoop({ statuses }: { statuses: RequirementStatus[] }) {
  return (
    <div className="flex h-full items-center justify-center gap-2">
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

/** If the 3D scene throws (e.g. a lost WebGL context), fall back instead of breaking the page. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
