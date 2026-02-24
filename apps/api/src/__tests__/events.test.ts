import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createEventRoutes } from "../routes/events";
import { SSEManager } from "../services/sse-manager";
import { createMockAuth } from "./helpers";
import type { VpsStatusEvent } from "@proxy-manager/shared";

describe("SSE events route", () => {
  let sseManager: SSEManager;

  beforeEach(() => {
    sseManager = new SSEManager();
  });

  function createApp(authOverrides?: Parameters<typeof createMockAuth>[0]) {
    const auth = createMockAuth(authOverrides);
    const app = new Hono();
    app.route("/", createEventRoutes({ auth, sseManager }));
    return app;
  }

  it("should return 401 when not authenticated", async () => {
    const app = createApp({
      getSession: () => Promise.resolve(null),
    });

    const res = await app.request("/api/events");
    expect(res.status).toBe(401);
  });

  it("should return a streaming response when authenticated", async () => {
    const app = createApp();

    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("should register a subscriber on connection", async () => {
    const app = createApp();

    expect(sseManager.subscriberCount).toBe(0);

    // Start the SSE connection
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);

    // The SSE stream should have registered a subscriber.
    // Since the stream is async, we give it a tick to set up.
    await new Promise((r) => setTimeout(r, 50));
    expect(sseManager.subscriberCount).toBeGreaterThanOrEqual(1);
  });

  it("should include content-type text/event-stream header", async () => {
    const app = createApp();
    const res = await app.request("/api/events");
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/event-stream");
  });

  it("should send initial connected event in the stream", async () => {
    const app = createApp();
    const res = await app.request("/api/events");

    // Read the beginning of the stream
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("No response body reader");
    }

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: connected");
    reader.releaseLock();
  });
});
