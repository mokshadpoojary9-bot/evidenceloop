/** 75.5 → "1:15.5" — used to label video frames for the model. */
export function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round((seconds - minutes * 60) * 10) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}
