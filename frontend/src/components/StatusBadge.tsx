import type { StatusMeta } from './labels';
import { Badge } from './ui';

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
      <Badge tone={meta.tone} size={size}>
        <Icon className={`${size === 'lg' ? 'size-4' : 'size-3.5'} ${meta.spin ? 'animate-spin' : ''}`} aria-hidden />
        {meta.label}
      </Badge>
      {simulated && <SimulatedTag />}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <Badge
      tone="dev"
      className="px-2 text-[10px] font-bold tracking-wider uppercase"
      title="Produced by the DEV ONLY fixture. No AI model examined the evidence."
    >
      Simulated · dev fixture
    </Badge>
  );
}
