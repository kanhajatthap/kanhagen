/**
 * Sliding-window-log rate limiter backed by a per-user LRU cache.
 *
 * Rate limiting   — each user keeps a queue of request timestamps (incoming
 *                   order). On every call stale timestamps older than `WINDOW_MS`
 *                   are dropped from the FRONT of the queue — a classic deque.
 *                   If the remaining count is at/below the limit the request is
 *                   recorded (push to the BACK) and allowed; otherwise a 429
 *                   with the seconds until the oldest request ages out.
 *
 * Memory bounded — the per-user queues live in an LRUCache so users who stop
 *                   making requests are automatically evicted (LRU tail) instead
 *                   of leaking a Map entry forever. The old implementation had an
 *                   explicit `setInterval` sweeper; the LRU removes that need.
 *
 * Complexity      — O(1) amortized per check (amortized array compaction keeps
 *                   evicting the front from being O(n)).
 */

import { LRUCache } from "./lruCache";

export const WINDOW_MS = 60 * 1000;
export const MAX_REQUESTS = 20;
const MAX_USERS = 10_000;
/**
 * Buckets must outlive the longest window a caller can ask for, otherwise the
 * bucket is TTL-evicted mid-window and the throttle silently resets. Login uses
 * a 15-minute window, so this has to be comfortably longer than that.
 */
const LONGEST_WINDOW_MS = 15 * 60 * 1000;
const USER_BUCKET_TTL_MS = 2 * LONGEST_WINDOW_MS;
const COMPACT_THRESHOLD = 4096;

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}

class SlidingWindow {
  /** Request timestamps in increasing order; `head` is the oldest live one. */
  private timestamps: number[] = [];
  private head = 0;

  /** Drops requests that aged out of the window, then compact when idle. */
  private sweep(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    while (this.head < this.timestamps.length && this.timestamps[this.head] <= cutoff) {
      this.head += 1;
    }
    // Avoid unbounded growth of dropped-but-kept slots.
    if (this.head > COMPACT_THRESHOLD && this.head * 2 > this.timestamps.length) {
      this.timestamps = this.timestamps.slice(this.head);
      this.head = 0;
    }
  }

  tryUse(now: number, windowMs: number, maxRequests: number): RateLimitResult {
    this.sweep(now, windowMs);
    const live = this.timestamps.length - this.head;

    if (live >= maxRequests) {
      const oldest = this.timestamps[this.head];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }

    this.timestamps.push(now);
    return { allowed: true };
  }
}

const userBuckets = new LRUCache<string, SlidingWindow>({
  max: MAX_USERS,
  ttlMs: USER_BUCKET_TTL_MS,
});

/**
 * Records/checks one request for a user. Exposed with the same signature as the
 * old fixed-window limiter so existing call sites keep working.
 *
 * `windowMs` / `maxRequests` are optional overrides so stricter policies (e.g.
 * login brute-force) can share the same implementation. Every key gets its own
 * sliding window regardless of the limits used, so buckets never interfere.
 *
 * Note this state is per-process: on a multi-instance host (Vercel) the
 * effective limit is N x the configured one. The daily Mongo quota is the hard
 * ceiling behind it — see lib/quota.ts.
 */
export function checkRateLimit(
  userId: string,
  windowMs: number = WINDOW_MS,
  maxRequests: number = MAX_REQUESTS,
): RateLimitResult {
  const now = Date.now();
  let bucket = userBuckets.get(userId);
  if (!bucket) {
    bucket = new SlidingWindow();
    userBuckets.set(userId, bucket);
  }
  return bucket.tryUse(now, windowMs, maxRequests);
}

/** Debug/diagnostic view of the limiter's internal state. */
export function getRateLimiterInfo(): {
  windowMs: number;
  maxRequests: number;
  activeUsers: number;
  capacity: number;
} {
  const stats = userBuckets.stats();
  return {
    windowMs: WINDOW_MS,
    maxRequests: MAX_REQUESTS,
    activeUsers: stats.size,
    capacity: stats.capacity,
  };
}