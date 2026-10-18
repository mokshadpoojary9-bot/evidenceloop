import { Cpu, Database, FlaskConical, HardDrive, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useServerWaking } from '../hooks';
import type { SystemStatus } from '../types';
import { Badge } from './ui';

/** Compact AI-mode indicator for the header. */
export function AiPill({ system, error }: { system: SystemStatus | null; error: string | null }) {
  const waking = useServerWaking();
  if (error) return <Pill className="border-contradicted/40 text-contradicted-fg">API offline</Pill>;
  if (!system) return <Pill className="border-line text-fg-subtle">{waking ? 'Waking up server…' : 'Connecting…'}</Pill>;

  switch (system.ai.mode) {
    case 'nebius':
      // "Connected" is only claimed after the backend's live text + image test passed.
      if (system.ai.live.state === 'connected') {
        return (
          <Pill className="border-proven/30 text-proven-fg" title={system.ai.message}>
            <Cpu className="size-3.5" aria-hidden />
            {/* The full sentence is ~560px wide and cannot wrap; phones show a short label instead. */}
            <span aria-hidden className="sm:hidden">
              Nemotron · connected
            </span>
            <span className="max-sm:sr-only">
              Production AI: NVIDIA Nemotron via Nebius — connected ·{' '}
              <span className="font-mono">{system.ai.model}</span>
            </span>
          </Pill>
        );
      }
      if (system.ai.live.state === 'checking') {
        return (
          <Pill className="border-analyzing/30 text-analyzing-fg" title={system.ai.message}>
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Nemotron configured · testing connection
          </Pill>
        );
      }
      return (
        <Pill className="border-uncertain/40 text-uncertain-fg" title={system.ai.message}>
          <TriangleAlert className="size-3.5" aria-hidden /> Nemotron configured · not verified
        </Pill>
      );
    case 'dev-fixture':
      return (
        <Pill className="dev-stripe border-dev/50 text-dev-fg" title={system.ai.message}>
          <FlaskConical className="size-3.5" aria-hidden /> DEV fixture · not AI
        </Pill>
      );
    case 'unconfigured':
      return (
        <Pill className="border-uncertain/40 text-uncertain-fg" title={system.ai.message}>
          <TriangleAlert className="size-3.5" aria-hidden /> Production AI not configured
        </Pill>
      );
  }
}

function Pill({ className, title, children }: { className: string; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-semibold whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** Full-width explanation of the AI mode. Renders nothing when production AI is live. */
export function AiBanner({ system }: { system: SystemStatus | null }) {
  if (!system) return null;

  if (system.ai.mode === 'nebius') {
    if (system.ai.live.state !== 'failed') return null;
    return (
      <div role="note" className="rounded-xl border border-uncertain/40 bg-uncertain/10 px-4 py-3 text-sm text-uncertain-fg">
        <p className="flex items-center gap-2 font-bold">
          <TriangleAlert className="size-4 shrink-0" aria-hidden /> NVIDIA Nemotron is configured but not verified
        </p>
        <p className="mt-1 text-uncertain-fg/80">
          The live connection test failed: {system.ai.live.detail} Run <code className="font-mono">npm run check:nebius</code>{' '}
          on the backend for details.
        </p>
      </div>
    );
  }

  if (system.ai.mode === 'dev-fixture') {
    return (
      <div role="note" className="dev-stripe rounded-xl border border-dev/50 px-4 py-3 text-sm text-dev-fg">
        <p className="flex items-center gap-2 font-bold">
          <FlaskConical className="size-4 shrink-0" aria-hidden /> DEV ONLY — results on this page are simulated
        </p>
        <p className="mt-1 text-dev-fg/80">
          Production AI (Nebius Token Factory + NVIDIA Nemotron) is not configured. A deterministic fixture is standing
          in so the verification loop can be exercised. It does not open or interpret any file — it only checks which
          kinds of evidence are attached. Nothing it reports is AI inference or a real verification.
        </p>
      </div>
    );
  }

  return (
    <div role="note" className="rounded-xl border border-uncertain/40 bg-uncertain/10 px-4 py-3 text-sm text-uncertain-fg">
      <p className="flex items-center gap-2 font-bold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden /> Production AI is not configured
      </p>
      <p className="mt-1 text-uncertain-fg/80">
        Verification is disabled until <code className="font-mono">NEBIUS_API_KEY</code> and{' '}
        <code className="font-mono">NEBIUS_MODEL</code> are set on the backend (Nebius Token Factory + NVIDIA
        Nemotron). You can still create work orders and upload evidence; no requirement will be marked proven.
      </p>
    </div>
  );
}

/**
 * The system at a glance: the AI connection and where data lives. "Nemotron connected" only
 * after the backend's live test passed; the DEV fixture is always called simulated.
 */
export function SystemChips({ system, error }: { system: SystemStatus | null; error: string | null }) {
  if (error) return <Badge tone="contradicted">API offline</Badge>;
  if (!system) return <Badge>Connecting…</Badge>;

  const ai = (() => {
    switch (system.ai.mode) {
      case 'nebius':
        if (system.ai.live.state === 'connected') {
          return (
            <Badge tone="accent" title={system.ai.model ?? undefined}>
              <Cpu className="size-3.5" aria-hidden /> Nemotron connected
            </Badge>
          );
        }
        if (system.ai.live.state === 'checking') {
          return (
            <Badge tone="analyzing">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Testing Nemotron…
            </Badge>
          );
        }
        return (
          <Badge tone="uncertain" title={system.ai.message}>
            <TriangleAlert className="size-3.5" aria-hidden /> Nemotron not verified
          </Badge>
        );
      case 'dev-fixture':
        return (
          <Badge tone="dev" title={system.ai.message}>
            <FlaskConical className="size-3.5" aria-hidden /> Simulated · dev fixture
          </Badge>
        );
      case 'unconfigured':
        return (
          <Badge tone="uncertain" title={system.ai.message}>
            <TriangleAlert className="size-3.5" aria-hidden /> AI not configured
          </Badge>
        );
    }
  })();

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {ai}
      {system.persistence === 'supabase' ? (
        <Badge tone="proven">
          <Database className="size-3.5" aria-hidden /> Supabase connected
        </Badge>
      ) : (
        <Badge title="Local development: data on this machine, no sign-in">
          <HardDrive className="size-3.5" aria-hidden /> Local data · dev
        </Badge>
      )}
    </span>
  );
}

/**
 * Shown while the API server wakes from sleep (Render free tier, up to about a minute).
 * Requests are retried automatically meanwhile, so there is nothing for the user to do.
 */
export function WakingBanner() {
  const waking = useServerWaking();
  if (!waking) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-3 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-analyzing/30 bg-surface px-4 py-2 text-sm font-semibold text-analyzing-fg shadow-lg"
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
      Waking up server… this can take up to a minute.
    </div>
  );
}
