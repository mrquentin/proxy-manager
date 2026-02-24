import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { createRateLimiter } from "../../middleware/rate-limit";

describe("middleware/rate-limit", () => {
  it("should allow requests within the limit", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 5, windowMs: 60_000, refillRate: 5 }));
    app.get("/test", (c) => c.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("should return 429 when rate limit is exceeded", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 3, windowMs: 60_000, refillRate: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    // Exhaust tokens
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }

    // 4th request should be rate-limited
    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
  });

  it("should set rate limit headers", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 10, windowMs: 60_000, refillRate: 10 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
  });

  it("should set Retry-After header on 429 responses", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 1, windowMs: 60_000, refillRate: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    // Exhaust token
    await app.request("/test", { headers: { "x-forwarded-for": "9.9.9.9" } });

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);
  });

  it("should track different IPs independently", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 2, windowMs: 60_000, refillRate: 2 }));
    app.get("/test", (c) => c.json({ ok: true }));

    // IP A: use both tokens
    await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
    await app.request("/test", { headers: { "x-forwarded-for": "10.0.0.1" } });

    // IP A: should be rate limited
    const resA = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(resA.status).toBe(429);

    // IP B: should still have tokens
    const resB = await app.request("/test", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(resB.status).toBe(200);
  });

  it("should use x-real-ip as fallback when x-forwarded-for is not set", async () => {
    const app = new Hono();
    app.use("*", createRateLimiter({ maxTokens: 1, windowMs: 60_000, refillRate: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test", {
      headers: { "x-real-ip": "20.0.0.1" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { "x-real-ip": "20.0.0.1" },
    });
    expect(res2.status).toBe(429);
  });
});
