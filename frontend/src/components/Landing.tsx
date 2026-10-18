import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ArrowRight, Eye, MessageSquareWarning, ScanSearch, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSystem } from '../hooks';
import { type HeroMotion, STATIONS, stationAt } from '../lib/evidenceLoop';
import { LoopVisual } from './LoopVisual';
import { AiBanner } from './SystemStatus';

const LOOP_STEPS = [
  'Work order',
  'Retrieve requirements',
  'Build checklist',
  'Analyze multimodal evidence',
  'Map evidence to requirements',
  'Check proof',
  'Detect uncertainty',
  'Detect contradictions',
  'Identify missing evidence',
  'Plan minimum request',
  'Request evidence',
  'New evidence',
  'Re-analyze',
  'Final verification',
  'Audit trail',
];

const PRINCIPLES = [
  {
    icon: ScanSearch,
    title: 'Proof, not classification',
    body: 'Every requirement gets an explicit status: proven, not proven, uncertain or contradicted. Insufficient evidence is never rounded up to a pass.',
  },
  {
    icon: Eye,
    title: 'Observation is not inference',
    body: 'Each decision traces requirement → evidence → observation → reasoning → decision, with what was directly seen kept apart from what was concluded.',
  },
  {
    icon: MessageSquareWarning,
    title: 'Asks for the minimum',
    body: 'When proof is missing, the agent names exactly what is missing and requests the smallest additional evidence that would settle it.',
  },
  {
    icon: ShieldCheck,
    title: 'Guardrails in code',
    body: 'A verification policy checks every model answer. A claim that cites no real evidence is downgraded, and confidence is never invented.',
  },
];

export function Landing() {
  const { system } = useSystem();

  return (
    <div className="space-y-14 pt-2">
      <Hero />

      <AiBanner system={system} />

      <section aria-labelledby="loop-heading">
        <h2 id="loop-heading" className="eyebrow">
          The verification loop
        </h2>
        <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
          {LOOP_STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="rounded-lg border border-line bg-surface px-2.5 py-1 font-medium text-fg">
                {label}
              </span>
              {index < LOOP_STEPS.length - 1 && <ArrowRight className="size-3.5 text-fg-faint" aria-hidden />}
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRINCIPLES.map(({ icon: Icon, title, body }, index) => (
          <motion.article
            key={title}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.06 }}
            className="card p-5"
          >
            <Icon className="size-6 text-accent-fg" aria-hidden />
            <h3 className="mt-3 font-semibold text-fg">{title}</h3>
            <p className="mt-1.5 text-sm text-fg-subtle">{body}</p>
          </motion.article>
        ))}
      </section>
    </div>
  );
}

/** Scroll distance, in viewport heights, that the hero holds still for each station. */
const SCROLL_PER_STATION = 0.42;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The landing hero. The scene stays pinned while the visitor scrolls through the section;
 * scroll turns the camera around the loop and the caption explains one station at a time.
 */
function Hero() {
  const section = useRef<HTMLElement>(null);
  const pinned = useRef<HTMLDivElement>(null);
  const motionInput = useRef<HeroMotion>({ progress: 0, pointerX: 0, pointerY: 0 });
  const [station, setStation] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const outer = section.current;
      const inner = pinned.current;
      if (!outer || !inner) return;
      const rect = outer.getBoundingClientRect();
      const travel = Math.max(rect.height - inner.offsetHeight, 1);
      const stickTop = parseFloat(getComputedStyle(inner).top) || 0;
      const progress = Math.min(1, Math.max(0, (stickTop - rect.top) / travel));
      motionInput.current.progress = progress;
      setStation(stationAt(progress));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onPointer = (event: PointerEvent) => {
      motionInput.current.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      motionInput.current.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  const current = STATIONS[station]!;

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={section}
        aria-labelledby="hero-heading"
        className="relative"
        style={{ height: `calc(100svh - 6rem + ${Math.round(STATIONS.length * SCROLL_PER_STATION * 100)}svh)` }}
      >
        <div
          ref={pinned}
          className="theme-dark sticky top-3 h-[calc(100svh-6rem)] min-h-[560px] overflow-hidden rounded-3xl border border-white/10 bg-[#05070c] shadow-2xl shadow-black/50"
        >
          {/* Static backdrop: shown at once while the 3D code loads. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(60%_55%_at_65%_60%,rgb(118_185_0/0.16),transparent_70%),radial-gradient(40%_40%_at_10%_0%,rgb(56_189_248/0.07),transparent_70%)]"
          />
          {/* The scene's edges are faded into the backdrop, so the canvas never shows as a box. */}
          <LoopVisual
            variant="hero"
            motion={motionInput}
            activeStation={station}
            className="absolute inset-0 max-sm:top-[50%] max-sm:bottom-[15%] sm:max-lg:top-[40%] sm:max-lg:bottom-[16%] lg:left-[24%] max-lg:[mask-image:linear-gradient(to_bottom,transparent,#000_22%,#000_80%,transparent)] lg:[mask-image:linear-gradient(to_right,transparent,#000_18%)]"
          />
          {/* Scrims keep the copy readable over the scene. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#05070c] from-15% via-[#05070c]/40 via-40% to-transparent to-60% lg:bg-gradient-to-r lg:from-[#05070c] lg:from-20% lg:via-[#05070c]/60 lg:via-38% lg:to-transparent lg:to-60%"
          />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#05070c] to-transparent" />

          <div className="pointer-events-none relative flex h-full flex-col justify-between p-5 sm:p-8 lg:p-12">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              className="pointer-events-auto max-w-xl lg:mt-[5vh]"
            >
              <p className="inline-flex items-center gap-2 rounded-full border border-[#76b900]/40 bg-[#76b900]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[#a3e635]">
                <span className="size-1.5 rounded-full bg-[#76b900] shadow-[0_0_8px_#76b900]" aria-hidden />
                <span aria-hidden className="sm:hidden">
                  Evidence verification · Nemotron
                </span>
                <span className="max-sm:sr-only">Agentic evidence verification · NVIDIA Nemotron</span>
              </p>
              <h1
                id="hero-heading"
                className="mt-4 text-[2.25rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance text-fg [text-shadow:0_2px_24px_rgb(0_0_0/0.6)] sm:text-6xl lg:text-7xl"
              >
                Prove the work.{' '}
                <span className="bg-gradient-to-r from-slate-200 to-slate-500 bg-clip-text text-transparent">
                  Don't just trust the photo.
                </span>
              </h1>
              <p className="mt-3 max-w-md text-[15px] text-fg-muted sm:mt-4 sm:text-lg">
                EvidenceLoop checks whether photos, video and documents actually prove each requirement, and asks for
                exactly what is missing.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
                <Link
                  to="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-xl bg-[#76b900] px-5 py-3 text-sm font-semibold text-accent-ink shadow-[0_0_32px_-6px_#76b900] transition hover:brightness-110 focus-visible:outline-[#a3e635]"
                >
                  Open dashboard
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <Link
                  to="/work-orders/new"
                  className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-fg backdrop-blur transition hover:border-white/30"
                >
                  Start the demo work order
                </Link>
              </div>
            </motion.div>

            <div className="pointer-events-auto max-w-xl">
              <ol className="flex gap-1.5" aria-label="Stations of the evidence loop">
                {STATIONS.map((item, k) => (
                  <li key={item.label} className="flex-1" aria-current={k === station ? 'step' : undefined}>
                    <span
                      aria-hidden
                      className={`block h-1 rounded-full transition-colors duration-500 ${
                        k < station ? 'bg-[#76b900]/50' : k === station ? 'bg-[#76b900]' : 'bg-white/10'
                      }`}
                    />
                    <span className="sr-only">{item.label}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 min-h-[3.5rem]" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={station}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="text-sm text-fg-muted sm:text-base"
                  >
                    <span className="mr-2 font-mono text-xs text-[#a3e635]">
                      {String(station + 1).padStart(2, '0')} / {String(STATIONS.length).padStart(2, '0')}
                    </span>
                    <strong className="font-semibold text-fg">{current.label}.</strong> {current.caption}
                  </motion.p>
                </AnimatePresence>
              </div>
              <p
                className={`mt-1 text-xs text-fg-faint transition-opacity duration-500 ${station === 0 ? 'opacity-100' : 'opacity-0'}`}
              >
                Scroll to follow the evidence around the loop.
              </p>
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
