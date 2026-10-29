/** Verity's avatar: a glowing NVIDIA-green orb (styles in styles.css, calm under reduced motion). */
export function VerityOrb({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dimension = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-9' : 'size-6';
  return <span aria-hidden className={`verity-orb inline-block shrink-0 rounded-full ${dimension}`} />;
}
