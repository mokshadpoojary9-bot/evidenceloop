import { motion } from 'framer-motion';
import { ClipboardList, MessageSquareWarning, RefreshCw, ScanSearch, ShieldCheck, ShieldHalf, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

interface Step {
  title: string;
  icon: LucideIcon;
  body: string;
  /** A real moment from the Room 204 demo work order. */
  example: string;
}

export const LOOP_CARDS: Step[] = [
  {
    title: 'Plan',
    icon: ClipboardList,
    body: 'The work order’s requirements become a checklist, each with the evidence that would prove it.',
    example: 'Room 204: six requirements, from “Correct emergency light installed” to “Functional test completed”.',
  },
  {
    title: 'Analyze',
    icon: ScanSearch,
    body: 'NVIDIA Nemotron inspects photos, video frames and document text, and records what it directly observes.',
    example: 'Room 204: the after photo and install sheet prove four of the six requirements.',
  },
  {
    title: 'Guard',
    icon: ShieldHalf,
    body: 'A policy checks every answer. Guesses are not proof: anything not shown in the evidence stays unproven.',
    example: 'Room 204: “Indicator functioning” stays uncertain; the photo does not clearly show it lit.',
  },
  {
    title: 'Request',
    icon: MessageSquareWarning,
    body: 'When proof is missing, it asks for the smallest piece of evidence that would settle it.',
    example: 'Room 204: “Upload a 5–10 second video showing the emergency light functional test.”',
  },
  {
    title: 'Re-analyze',
    icon: RefreshCw,
    body: 'New evidence re-checks only the requirements it affects. Earlier conclusions are not trusted blindly.',
    example: 'Room 204: the test video shows TEST pressed and the unit lit on battery.',
  },
  {
    title: 'Verify',
    icon: ShieldCheck,
    body: 'Verified only when every mandatory requirement is proven, with the full chain in the audit trail.',
    example: 'Room 204: six of six proven → Verified, exportable as a PDF report.',
  },
];

/**
 * The verification loop as six flip cards: a 3×2 grid on larger screens, a swipeable row on
 * phones. Each card is a button: hover (with a mouse), tap, Enter or Space shows its back.
 */
export function LoopFlashcards() {
  return (
    <ul
      aria-label="The verification loop, in six steps"
      className="theme-dark -mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
    >
      {LOOP_CARDS.map((step, index) => (
        <motion.li
          key={step.title}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ delay: index * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-[78%] shrink-0 snap-center sm:w-auto"
        >
          <Flashcard step={step} number={index + 1} />
        </motion.li>
      ))}
    </ul>
  );
}

function Flashcard({ step, number }: { step: Step; number: number }) {
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const showBack = flipped || hovered;
  const Icon = step.icon;
  const face = 'absolute inset-0 flex flex-col rounded-2xl border p-4 [backface-visibility:hidden]';

  return (
    <button
      type="button"
      aria-pressed={showBack}
      aria-label={`Step ${number}: ${step.title}. ${showBack ? '' : 'Show details.'}`}
      onClick={() => setFlipped((value) => !value)}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setHovered(false)}
      className="block h-48 w-full rounded-2xl text-left [perspective:1000px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a3e635]"
    >
      <span
        className="relative block size-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none"
        style={{ transform: showBack ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        <span aria-hidden={showBack} className={`${face} justify-between border-white/10 bg-[#0a0f17]`}>
          <span className="flex items-center justify-between">
            <span className="font-mono text-xs text-[#a3e635]">{String(number).padStart(2, '0')}</span>
            <span className="flex size-9 items-center justify-center rounded-xl border border-[#76b900]/40 bg-[#76b900]/10">
              <Icon className="size-4.5 text-[#a3e635]" aria-hidden />
            </span>
          </span>
          <span>
            <span className="block text-lg font-semibold text-fg">{step.title}</span>
            <span className="mt-0.5 block text-xs text-fg-faint">Hover or tap to flip</span>
          </span>
        </span>
        <span
          aria-hidden={!showBack}
          className={`${face} gap-2 border-[#76b900]/40 bg-[#0d1508] shadow-[0_0_28px_-12px_#76b900] [transform:rotateY(180deg)]`}
        >
          <span className="text-sm text-fg-muted">{step.body}</span>
          <span className="mt-auto text-xs text-[#a3e635]">{step.example}</span>
        </span>
      </span>
    </button>
  );
}
