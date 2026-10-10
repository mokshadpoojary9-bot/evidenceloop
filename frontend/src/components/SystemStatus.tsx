import { Cpu, FlaskConical, TriangleAlert } from 'lucide-react';
import type { SystemStatus } from '../types';

/** Compact AI-mode indicator for the header. */
export function AiPill({ system, error }: { system: SystemStatus | null; error: string | null }) {
  if (error) return <Pill className="border-rose-400/40 text-rose-300">API offline</Pill>;
  if (!system) return <Pill className="border-line text-slate-400">Connecting…</Pill>;

  switch (system.ai.mode) {
    case 'nebius':
      return (
        <Pill className="border-emerald-400/30 text-emerald-300" title={system.ai.message}>
          <Cpu className="size-3.5" aria-hidden /> Nemotron · Nebius
        </Pill>
      );
    case 'dev-fixture':
      return (
        <Pill className="dev-stripe border-fuchsia-400/50 text-fuchsia-200" title={system.ai.message}>
          <FlaskConical className="size-3.5" aria-hidden /> DEV fixture · not AI
        </Pill>
      );
    case 'unconfigured':
      return (
        <Pill className="border-amber-400/40 text-amber-300" title={system.ai.message}>
          <TriangleAlert className="size-3.5" aria-hidden /> Production AI not configured
        </Pill>
      );
  }
}

function Pill({ className, title, children }: { className: string; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-ink-900 px-3 py-1 text-xs font-semibold whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** Full-width explanation of the AI mode. Renders nothing when production AI is live. */
export function AiBanner({ system }: { system: SystemStatus | null }) {
  if (!system || system.ai.mode === 'nebius') return null;

  if (system.ai.mode === 'dev-fixture') {
    return (
      <div role="note" className="dev-stripe rounded-xl border border-fuchsia-400/50 px-4 py-3 text-sm text-fuchsia-100">
        <p className="flex items-center gap-2 font-bold">
          <FlaskConical className="size-4 shrink-0" aria-hidden /> DEV ONLY — results on this page are simulated
        </p>
        <p className="mt-1 text-fuchsia-100/80">
          Production AI (Nebius Token Factory + NVIDIA Nemotron) is not configured. A deterministic fixture is standing
          in so the verification loop can be exercised. It does not open or interpret any file — it only checks which
          kinds of evidence are attached. Nothing it reports is AI inference or a real verification.
        </p>
      </div>
    );
  }

  return (
    <div role="note" className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <p className="flex items-center gap-2 font-bold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden /> Production AI is not configured
      </p>
      <p className="mt-1 text-amber-100/80">
        Verification is disabled until <code className="font-mono">NEBIUS_API_KEY</code> and{' '}
        <code className="font-mono">NEBIUS_MODEL</code> are set on the backend (Nebius Token Factory + NVIDIA
        Nemotron). You can still create work orders and upload evidence; no requirement will be marked proven.
      </p>
    </div>
  );
}
