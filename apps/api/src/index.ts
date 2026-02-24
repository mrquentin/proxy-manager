import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { parseEnv } from "./lib/env";
import { createAuth } from "./lib/auth";
import { VpsClient } from "./lib/vps-client";
import { VpsApiError } from "./lib/vps-client";
import { createCorsMiddleware } from "./middleware/cors";
import { defaultRateLimiter } from "./middleware/rate-limit";
import { createAuthRoutes } from "./routes/auth";
import { createVpsRoutes } from "./routes/vps";
import { createTunnelRoutes } from "./routes/tunnels";
import { createRouteRoutes } from "./routes/routes";
import { createFirewallRoutes } from "./routes/firewall";
import { createEventRoutes } from "./routes/events";
import { SSEManager } from "./services/sse-manager";
import { AuditLogService } from "./services/audit-log";
import { VpsPoller } from "./services/vps-poller";
import { createDatabase } from "@proxy-manager/db";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const env = parseEnv();

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = createDatabase(env.DATABASE_PATH);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const auth = createAuth(db, env);
const vpsClient = new VpsClient(env.ENCRYPTION_KEY);
const sseManager = new SSEManager();
const auditLog = new AuditLogService(db);

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

// Global error handler — catches VPS API errors and other unhandled exceptions
app.onError((err, c) => {
  if (err instanceof VpsApiError) {
    console.error(`[vps-api-error] vps=${err.vpsId} status=${err.statusCode}: ${err.responseBody}`);
    return c.json(
      { error: `VPS API error: ${err.responseBody}`, code: "vps_api_error" },
      err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode as 400 : 502
    );
  }

  console.error("[unhandled-error]", err);
  return c.json(
    { error: "Internal server error" },
    500
  );
});

// Global middleware
app.use("*", logger());
app.use("/api/*", createCorsMiddleware(env));
app.use("/api/*", defaultRateLimiter);

// ---------------------------------------------------------------------------
// Health check (unauthenticated)
// ---------------------------------------------------------------------------

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const authRoutes = createAuthRoutes(auth);
const vpsRoutes = createVpsRoutes({ db, auth, env, auditLog, vpsClient });
const tunnelRoutes = createTunnelRoutes({ db, auth, env, vpsClient, auditLog });
const routeRoutes = createRouteRoutes({ db, auth, env, vpsClient, auditLog });
const firewallRoutes = createFirewallRoutes({ db, auth, env, vpsClient, auditLog });
const eventRoutes = createEventRoutes({ auth, sseManager });

app.route("/", authRoutes);
app.route("/", vpsRoutes);
app.route("/", tunnelRoutes);
app.route("/", routeRoutes);
app.route("/", firewallRoutes);
app.route("/", eventRoutes);

// ---------------------------------------------------------------------------
// Serve static files in production (Vite build output)
// ---------------------------------------------------------------------------

if (env.NODE_ENV === "production") {
  // Serve static assets from the web build directory
  app.use("/*", serveStatic({ root: "./public" }));

  // SPA fallback: serve index.html for any non-API, non-static route
  app.get("*", serveStatic({ root: "./public", path: "index.html" }));
}

// ---------------------------------------------------------------------------
// Start VPS health poller
// ---------------------------------------------------------------------------

const vpsPoller = new VpsPoller(db, vpsClient, sseManager);
vpsPoller.start();

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

console.log(`[api] starting on port ${env.PORT} (${env.NODE_ENV})`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
