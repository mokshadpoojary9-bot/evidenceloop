import { motion } from 'framer-motion';
import { ArrowRight, Eye, MessageSquareWarning, ScanSearch, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSystem } from '../hooks';
import type { RequirementStatus } from '../types';
import { REQUIREMENT_STATUS } from './labels';
import { LoopVisual } from './LoopVisual';
import { AiBanner } from './SystemStatus';

// A scripted walk through the demo scenario, used only to animate the hero.
// It is an illustration of the loop, not the output of any analysis.
const P: RequirementStatus = 'PROVEN';
const N: RequirementStatus = 'NOT_PROVEN';
const A: RequirementStatus = 'ANALYZING';
const ILLUSTRATION: { caption: string; statuses: RequirementStatus[]; hex: string }[] = [
  { caption: 'Checklist built — nothing is proven yet', statuses: [N, N, N, N, N, N], hex: REQUIREMENT_STATUS.NOT_PROVEN.hex },
  { caption: 'Analyzing photos and the manual', statuses: [A, A, A, A, A, A], hex: REQUIREMENT_STATUS.ANALYZING.hex },
  { caption: 'Four proven. The functional test is not', statuses: [P, P, P, P, 'UNCERTAIN', N], hex: REQUIREMENT_STATUS.UNCERTAIN.hex },
  { caption: 'Requested: a 5–10 second test video', statuses: [P, P, P, P, 'UNCERTAIN', N], hex: REQUIREMENT_STATUS.UNCERTAIN.hex },
  { caption: 'New evidence — re-analyzing what it affects', statuses: [P, P, P, P, A, A], hex: REQUIREMENT_STATUS.ANALYZING.hex },
  { caption: 'Every mandatory requirement supported', statuses: [P, P, P, P, P, P], hex: REQUIREMENT_STATUS.PROVEN.hex },
];

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
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((value) => (value + 1) % ILLUSTRATION.length), 2600);
    return () => clearInterval(timer);
  }, []);

  const frame = ILLUSTRATION[step]!;

  return (
    <div className="space-y-14 pt-4">
      <section className="grid items-center gap-8 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="eyebrow text-accent">Agentic multimodal evidence verification</p>
          <h1 className="mt-3 text-4xl leading-[1.08] font-bold tracking-tight text-white sm:text-6xl">
            Prove the work.
            <br />
            <span className="text-slate-400">Don't just trust the photo.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-300">
            EvidenceLoop checks whether the photos, videos and documents for a job actually prove each requirement was
            met — and when they don't, it asks for exactly the evidence that is missing.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/work-orders/new" className="btn btn-primary px-5 py-2.5 text-base">
              Start the demo work order <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/work-orders" className="btn px-5 py-2.5 text-base">
              Open dashboard
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="card overflow-hidden"
        >
          <LoopVisual className="h-80" statuses={frame.statuses} coreHex={frame.hex} />
          <div className="border-t border-line px-5 py-3">
            <p className="eyebrow">Illustration · “Replace emergency light in Room 204”</p>
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-1 font-medium text-white"
            >
              {frame.caption}
            </motion.p>
          </div>
        </motion.div>
      </section>

      <AiBanner system={system} />

      <section aria-labelledby="loop-heading">
        <h2 id="loop-heading" className="eyebrow">
          The verification loop
        </h2>
        <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
          {LOOP_STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className="rounded-lg border border-line bg-ink-900 px-2.5 py-1 font-medium text-slate-200">
                {label}
              </span>
              {index < LOOP_STEPS.length - 1 && <ArrowRight className="size-3.5 text-slate-600" aria-hidden />}
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
            <Icon className="size-6 text-accent" aria-hidden />
            <h3 className="mt-3 font-semibold text-white">{title}</h3>
            <p className="mt-1.5 text-sm text-slate-400">{body}</p>
          </motion.article>
        ))}
      </section>
    </div>
  );
}
