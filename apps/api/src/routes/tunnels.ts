import { Hono } from "hono";
import type { Auth } from "../lib/auth";
import type { Env } from "../lib/env";
import type { AppEnv } from "../lib/hono-env";
import type { VpsClient } from "../lib/vps-client";
import { getVps } from "../lib/vps-helpers";
import { createRequireAuth, createRequirePermission, requireActiveOrg } from "../middleware/auth";
import type { AuditLogService } from "../services/audit-log";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

interface TunnelRouteDeps {
  db: Database;
  auth: Auth;
  env: Env;
  vpsClient: VpsClient;
  auditLog: AuditLogService;
}

/**
 * Create tunnel proxy routes.
 * These routes proxy requests to the VPS control plane tunnel API.
 */
export function createTunnelRoutes({ db, auth, env, vpsClient, auditLog }: TunnelRouteDeps) {
  const app = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(auth);

  // All tunnel routes require authentication and an active org
  app.use("/api/vps/:vpsId/tunnels/*", requireAuth, requireActiveOrg);
  app.use("/api/vps/:vpsId/tunnels", requireAuth, requireActiveOrg);

  /**
   * POST /api/vps/:vpsId/tunnels — Create a new WireGuard tunnel.
   */
  app.post(
    "/api/vps/:vpsId/tunnels",
    createRequirePermission(auth, "tunnel", "create"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const body = await c.req.json();
      const result = await vpsClient.createTunnel(vps, body);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "tunnel.create",
        "tunnel",
        null,
        { vpsId }
      );

      return c.json({ data: result }, 201);
    }
  );

  /**
   * GET /api/vps/:vpsId/tunnels — List all tunnels on a VPS.
   */
  app.get(
    "/api/vps/:vpsId/tunnels",
    createRequirePermission(auth, "tunnel", "read"),
    async (c) => {
      const session = c.get("session");
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.listTunnels(vps);
      return c.json(result);
    }
  );

  /**
   * DELETE /api/vps/:vpsId/tunnels/:id — Delete a tunnel.
   */
  app.delete(
    "/api/vps/:vpsId/tunnels/:id",
    createRequirePermission(auth, "tunnel", "delete"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.deleteTunnel(vps, tunnelId);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "tunnel.delete",
        "tunnel",
        tunnelId,
        { vpsId }
      );

      return c.json({ data: result });
    }
  );

  /**
   * GET /api/vps/:vpsId/tunnels/:id/config — Download tunnel config file.
   */
  app.get(
    "/api/vps/:vpsId/tunnels/:id/config",
    createRequirePermission(auth, "tunnel", "read"),
    async (c) => {
      const session = c.get("session");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.getTunnelConfig(vps, tunnelId);

      // If the VPS returns a Response object (non-JSON), forward it
      if (result instanceof Response) {
        return new Response(result.body, {
          status: result.status,
          headers: result.headers,
        });
      }

      return c.json({ data: result });
    }
  );

  /**
   * GET /api/vps/:vpsId/tunnels/:id/qr — Get tunnel QR code.
   */
  app.get(
    "/api/vps/:vpsId/tunnels/:id/qr",
    createRequirePermission(auth, "tunnel", "read"),
    async (c) => {
      const session = c.get("session");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.getTunnelQr(vps, tunnelId);

      // QR code is typically a PNG image — forward the raw response
      if (result instanceof Response) {
        return new Response(result.body, {
          status: result.status,
          headers: result.headers,
        });
      }

      return c.json({ data: result });
    }
  );

  /**
   * POST /api/vps/:vpsId/tunnels/:id/rotate — Rotate tunnel keys.
   */
  app.post(
    "/api/vps/:vpsId/tunnels/:id/rotate",
    createRequirePermission(auth, "tunnel", "rotate"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.rotateTunnel(vps, tunnelId);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "tunnel.rotate",
        "tunnel",
        tunnelId,
        { vpsId }
      );

      return c.json({ data: result });
    }
  );

  /**
   * GET /api/vps/:vpsId/tunnels/:id/rotation-policy — Get rotation policy.
   */
  app.get(
    "/api/vps/:vpsId/tunnels/:id/rotation-policy",
    createRequirePermission(auth, "tunnel", "read"),
    async (c) => {
      const session = c.get("session");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.getRotationPolicy(vps, tunnelId);
      return c.json({ data: result });
    }
  );

  /**
   * PATCH /api/vps/:vpsId/tunnels/:id/rotation-policy — Update rotation policy.
   */
  app.patch(
    "/api/vps/:vpsId/tunnels/:id/rotation-policy",
    createRequirePermission(auth, "tunnel", "rotate"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");
      const tunnelId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const body = await c.req.json();
      const result = await vpsClient.updateRotationPolicy(vps, tunnelId, body);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "tunnel.update-rotation-policy",
        "tunnel",
        tunnelId,
        { vpsId, policy: body }
      );

      return c.json({ data: result });
    }
  );

  return app;
}
