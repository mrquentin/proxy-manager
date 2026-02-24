import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Auth } from "../lib/auth";
import type { AppEnv } from "../lib/hono-env";
import { createRequireAuth } from "../middleware/auth";
import type { SSEManager } from "../services/sse-manager";
import type { SseEvent } from "@proxy-manager/shared";

interface EventRouteDeps {
  auth: Auth;
  sseManager: SSEManager;
}

/**
 * Create SSE (Server-Sent Events) endpoint for real-time dashboard updates.
 *
 * Clients connect to GET /api/events and receive:
 * - VPS status changes (online/offline)
 * - Tunnel connection/disconnection events
 * - Reconciliation drift events
 * - Route add/remove events
 * - Keep-alive pings every 25 seconds
 */
export function createEventRoutes({ auth, sseManager }: EventRouteDeps) {
  const app = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(auth);

  app.get("/api/events", requireAuth, (c) => {
    const user = c.get("user");
    const session = c.get("session");

    return streamSSE(c, async (stream) => {
      // Generate a unique subscriber ID for this connection
      const subscriberId = `${user.id}:${crypto.randomUUID()}`;

      const unsubscribe = sseManager.subscribe(
        subscriberId,
        session.activeOrganizationId,
        async (event: SseEvent) => {
          try {
            await stream.writeSSE({
              data: JSON.stringify(event),
              event: event.type,
            });
          } catch {
            // Client may have disconnected — ignore write errors.
          }
        }
      );

      // Keep-alive ping every 25 seconds to prevent proxy/load balancer timeouts
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            data: "ping",
            event: "ping",
          });
        } catch {
          // Client may have disconnected — ignore write errors.
        }
      }, 25_000);

      // Cleanup when the client disconnects
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(pingInterval);
      });

      // Send an initial connected event
      await stream.writeSSE({
        data: JSON.stringify({ type: "connected", subscriberId }),
        event: "connected",
      });

      // Keep the stream open indefinitely — it will close when the client disconnects
      // or the server shuts down. The onAbort callback handles cleanup.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  });

  return app;
}
