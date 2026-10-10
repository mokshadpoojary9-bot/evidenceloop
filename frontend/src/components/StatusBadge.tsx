import type { StatusMeta } from './labels';

interface Props {
  meta: StatusMeta;
  size?: 'sm' | 'lg';
  /** Marks a status produced by the DEV ONLY fixture rather than real AI inference. */
  simulated?: boolean;
}

export function StatusBadge({ meta, size = 'sm', simulated = false }: Props) {
  const Icon = meta.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap ${meta.chip} ${
          size === 'lg' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'
        }`}
      >
        <Icon className={`${size === 'lg' ? 'size-4' : 'size-3.5'} ${meta.spin ? 'animate-spin' : ''}`} aria-hidden />
        {meta.label}
      </span>
      {simulated && <SimulatedTag />}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <span
      className="dev-stripe rounded-full border border-fuchsia-400/50 px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap text-fuchsia-200 uppercase"
      title="Produced by the DEV ONLY fixture. No AI model examined the evidence."
    >
      Simulated · dev fixture
    </span>
  );
}
