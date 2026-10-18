/** A determinate progress bar; `value` is a fraction 0–1. */
export function ProgressBar({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
    </div>
  );
}
