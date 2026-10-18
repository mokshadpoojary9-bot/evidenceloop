import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'accent' | 'proven' | 'not-proven' | 'uncertain' | 'contradicted' | 'analyzing' | 'review' | 'dev';

/** Tinted chip classes per tone; status tones match the 3D scenes. */
export const TONE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-fg-subtle',
  accent: 'border-accent/40 bg-accent/10 text-accent-fg',
  proven: 'border-proven/30 bg-proven/10 text-proven-fg',
  'not-proven': 'border-not-proven/40 bg-not-proven/10 text-not-proven-fg',
  uncertain: 'border-uncertain/35 bg-uncertain/10 text-uncertain-fg',
  contradicted: 'border-contradicted/40 bg-contradicted/10 text-contradicted-fg',
  analyzing: 'border-analyzing/35 bg-analyzing/10 text-analyzing-fg',
  review: 'border-review/40 bg-review/10 text-review-fg',
  dev: 'dev-stripe border-dev/50 text-dev-fg',
};

interface Props {
  tone?: Tone;
  size?: 'sm' | 'lg';
  className?: string;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', size = 'sm', className = '', title, children }: Props) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap ${TONE[tone]} ${
        size === 'lg' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'
      } ${className}`}
    >
      {children}
    </span>
  );
}
