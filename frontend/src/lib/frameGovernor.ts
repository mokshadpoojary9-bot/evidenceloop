// Decides from measured frame rates, not from device specs, whether the 3D scene can run
// and at what quality. Pure logic; LoopScene feeds it frame deltas.

/** Length of the start-up probe: if the scene can't hold MIN_FPS over it, show 2D instead. */
export const PROBE_SECONDS = 2;
export const MIN_FPS = 30;
/** While running, a window below this rate steps quality down one level. */
export const STEP_DOWN_FPS = 45;
const WINDOW_SECONDS = 1;
/** Frames ignored after start and after each step (shader compilation, resize). */
const WARMUP_FRAMES = 8;
/** A delta this long is a pause (hidden tab, scrolled away), not a slow frame. */
const GAP_SECONDS = 0.5;

export type GovernorVerdict = 'fallback' | 'degrade' | null;

/**
 * Feed it every frame's delta. It answers 'fallback' at most once (after the probe, when
 * the scene is too slow even to start) and 'degrade' when quality should drop one level.
 * Quality only ever goes down, so it can't oscillate between levels.
 */
export class FrameGovernor {
  private probing = true;
  private warmup = WARMUP_FRAMES;
  private frames = 0;
  private elapsed = 0;
  private longFrames = 0;
  private level: number;

  /** maxLevel: how many times quality can step down. */
  constructor(
    private readonly maxLevel: number,
    startLevel = 0,
  ) {
    this.level = Math.min(startLevel, maxLevel);
  }

  get quality() {
    return this.level;
  }

  /** True once there is nothing left to decide. */
  get settled() {
    return !this.probing && this.level >= this.maxLevel;
  }

  tick(delta: number): GovernorVerdict {
    if (this.settled) return null;
    // One long frame is a resume after a pause; several in a row is a device that is just slow.
    if (delta > GAP_SECONDS) {
      if (++this.longFrames <= 1) {
        this.restartWindow();
        return null;
      }
    } else {
      this.longFrames = 0;
    }
    if (this.warmup > 0) {
      this.warmup--;
      return null;
    }
    this.frames++;
    this.elapsed += delta;
    if (this.elapsed < (this.probing ? PROBE_SECONDS : WINDOW_SECONDS)) return null;

    const fps = this.frames / this.elapsed;
    const wasProbe = this.probing;
    this.probing = false;
    this.frames = 0;
    this.elapsed = 0;
    if (wasProbe && fps < MIN_FPS) {
      this.level = this.maxLevel; // nothing more to measure
      return 'fallback';
    }
    if (fps < STEP_DOWN_FPS && this.level < this.maxLevel) {
      this.level++;
      this.warmup = WARMUP_FRAMES;
      return 'degrade';
    }
    return null;
  }

  private restartWindow() {
    this.frames = 0;
    this.elapsed = 0;
    this.warmup = WARMUP_FRAMES;
  }
}
