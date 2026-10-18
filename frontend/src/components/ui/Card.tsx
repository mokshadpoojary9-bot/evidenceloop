import type { HTMLAttributes } from 'react';

const PADDING = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' };

interface Props extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'header';
  /** Inner padding; 'none' for cards that manage their own sections. */
  padding?: keyof typeof PADDING;
}

/** A surface: bordered, softly elevated, themed. */
export function Card({ as: Tag = 'div', padding = 'md', className = '', ...props }: Props) {
  return <Tag className={`card ${PADDING[padding]} ${className}`} {...props} />;
}
