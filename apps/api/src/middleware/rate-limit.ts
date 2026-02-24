import type { MiddlewareHandler } from "hono";

/**
 * Configuration for the rate limiter.
 */
interface RateLimitConfig {
  /** Maximum number of tokens (requests) per IP. */
  maxTokens: number;
  /** Time window in milliseconds for token refill. */
  windowMs: number;
  /** Number of tokens refilled per window. */
  refillRate: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Simple in-memory token bucket rate limiter per IP address.
 *
 * Each IP gets a bucket with `maxTokens` tokens. Tokens are consumed on each request
 * and refilled at `refillRate` per `windowMs` interval.
 *
 * Stale buckets (not accessed for 5 minutes) are periodically cleaned up.
 */
export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler {
  const { maxTokens, windowMs, refillRate } = config;
  const buckets = new Map<string, Bucket>();

  // Clean up stale buckets every 60 seconds
  const CLEANUP_INTERVAL = 60_000;
  const STALE_THRESHOLD = 5 * 60_000; // 5 minutes

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (now - bucket.lastRefill > STALE_THRESHOLD) {
        buckets.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);

  // Prevent the timer from keeping the process alive
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }

  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const now = Date.now();
    let bucket = buckets.get(ip);

    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= windowMs) {
      const periods = Math.floor(elapsed / windowMs);
      bucket.tokens = Math.min(maxTokens, bucket.tokens + periods * refillRate);
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      const retryAfterMs = windowMs - (now - bucket.lastRefill);
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      c.header("Retry-After", String(retryAfterSec));
      c.header("X-RateLimit-Limit", String(maxTokens));
      c.header("X-RateLimit-Remaining", "0");

      return c.json({ error: "Too many requests" }, 429);
    }

    bucket.tokens -= 1;

    c.header("X-RateLimit-Limit", String(maxTokens));
    c.header("X-RateLimit-Remaining", String(bucket.tokens));

    await next();
  };
}

/**
 * Default rate limiter: 100 requests per minute per IP, refill 100 tokens per minute.
 */
export const defaultRateLimiter = createRateLimiter({
  maxTokens: 100,
  windowMs: 60_000,
  refillRate: 100,
});
