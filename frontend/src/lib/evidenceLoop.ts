// The landing hero's model of the evidence loop: six stations on a ring, and evidence
// cards that travel through them. Pure functions, shared by the 3D scene and its 2D
// fallback. It illustrates the loop; it is not the output of any analysis.

export const STATIONS = [
  { label: 'Upload', caption: 'Photos, video and documents arrive as evidence for each requirement.' },
  { label: 'Analyze', caption: 'NVIDIA Nemotron inspects every file and records what it directly observes.' },
  { label: 'Map to requirement', caption: 'Each observation is tied to the requirement it can, or cannot, prove.' },
  { label: 'Decide', caption: 'Proven only when the evidence is sufficient. Anything less is said plainly.' },
  { label: 'Request more', caption: 'It asks for the minimum missing evidence, such as a 5–10 second test video.' },
  { label: 'Re-analyze', caption: 'New evidence re-checks only the requirements it affects.' },
] as const;

export const STATION_COUNT = STATIONS.length;

/** Shared, mutable motion input for the hero scene (written by DOM events, read per frame). */
export interface HeroMotion {
  /** Scroll progress through the hero, 0–1. */
  progress: number;
  /** Pointer position, -1–1 on each axis. */
  pointerX: number;
  pointerY: number;
}

export type CardPhase = 'pending' | 'proven' | 'needs' | 'recheck';

export interface CardFrame {
  /** Position on the ring in station units, 0 ≤ u < 6 (station k sits at u = k). */
  u: number;
  /** 0 = outer lane, 1 = inner lane (the loop back after a request for more evidence). */
  lane: number;
  /** Height above the ring, used when a proven card leaves the loop. */
  lift: number;
  scale: number;
  phase: CardPhase;
}

/** One card's lifecycle length, in station units. Every card shares it, so spacing never drifts. */
export const CYCLE = 10;

const DECIDE = 3;
const REANALYZE = 5;
/** Re-analyzed evidence reaches Decide again after a full lap. */
const SECOND_DECIDE = DECIDE + STATION_COUNT;
const EXIT = 0.8;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 0→1 between edge0 and edge1, with zero slope at both ends. */
export function smootherstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Turns linear time (station units) into station-to-station travel that eases out of
 * each station, eases into the next, and rests there for `dwell` of the interval.
 */
export function easeStations(linear: number, dwell = 0.3) {
  const whole = Math.floor(linear);
  return whole + smootherstep(dwell, 1, linear - whole);
}

/**
 * Where a card is at eased lifecycle position `s` (0 ≤ s < CYCLE), or null while it is
 * hidden. Every card is uploaded and judged at Decide. Sufficient evidence turns it green
 * and it leaves the loop. Otherwise it turns amber, goes to Request more, is re-analyzed,
 * and loops back on the inner lane to be decided again.
 */
export function cardFrame(s: number, needsMore: boolean): CardFrame | null {
  const appear = smootherstep(0, 0.4, s);
  const decidedAt = needsMore ? SECOND_DECIDE : DECIDE;
  if (s >= decidedAt + EXIT) return null;

  const leaving = smootherstep(decidedAt + 0.3, decidedAt + EXIT, s);
  const travelled = Math.min(s, decidedAt + 0.25);
  let phase: CardPhase = 'pending';
  if (s >= decidedAt) phase = 'proven';
  else if (needsMore && s >= REANALYZE) phase = 'recheck';
  else if (needsMore && s >= DECIDE) phase = 'needs';

  return {
    u: travelled % STATION_COUNT,
    lane: needsMore ? smootherstep(REANALYZE - 0.4, REANALYZE + 0.6, s) : 0,
    lift: leaving * 0.9,
    scale: appear * (1 - leaving),
    phase,
  };
}

/** Which station a scroll progress (0–1) is explaining. */
export const stationAt = (progress: number) => Math.min(STATION_COUNT - 1, Math.floor(clamp01(progress) * STATION_COUNT));

export const CARD_COUNT = 5;
const CARD_SPACING = CYCLE / CARD_COUNT;
export const EVIDENCE_KINDS = ['photo', 'video', 'document'] as const;

/**
 * Card `index` at `time` (station units): evenly spaced, with outcome and evidence kind
 * alternating from lap to lap, deterministically.
 */
export function cardAt(time: number, index: number) {
  const raw = time - index * CARD_SPACING;
  const lap = Math.floor(raw / CYCLE);
  const needsMore = (((index + lap) % 2) + 2) % 2 === 0;
  const kind = EVIDENCE_KINDS[(((index + lap) % 3) + 3) % 3]!;
  return { frame: cardFrame(easeStations(raw - lap * CYCLE), needsMore), needsMore, kind };
}
