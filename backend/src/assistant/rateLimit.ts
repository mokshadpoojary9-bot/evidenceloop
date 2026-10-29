// Per-user limits for the assistant, in memory (a restart resets them, which is fine for a
// cost guard). A sliding window: at most `perMinute` questions a minute and `perDay` a day.

export interface RateLimiter {
  /** Records a question; returns how long to wait (ms) when over the limit, or 0. */
  take(userId: string, now?: number): number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function createRateLimiter({ perMinute = 8, perDay = 150 } = {}): RateLimiter {
  const history = new Map<string, number[]>();
  return {
    take(userId, now = Date.now()) {
      const times = (history.get(userId) ?? []).filter((time) => now - time < DAY);
      const lastMinute = times.filter((time) => now - time < MINUTE);
      if (lastMinute.length >= perMinute) return MINUTE - (now - lastMinute[0]!);
      if (times.length >= perDay) return DAY - (now - times[0]!);
      times.push(now);
      history.set(userId, times);
      return 0;
    },
  };
}
