import { Hono } from "hono";
import type { Auth } from "../lib/auth";
import type { Env } from "../lib/env";
import type { AppEnv } from "../lib/hono-env";
import type { VpsClient } from "../lib/vps-client";
import { getVps } from "../lib/vps-helpers";
import { createRequireAuth, createRequirePermission, requireActiveOrg } from "../middleware/auth";
import type { AuditLogService } from "../services/audit-log";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

interface RouteRouteDeps {
  db: Database;
  auth: Auth;
  env: Env;
  vpsClient: VpsClient;
  auditLog: AuditLogService;
}

/**
 * Create L4 route proxy routes.
 * These routes proxy requests to the VPS control plane route API.
 */
export function createRouteRoutes({ db, auth, env, vpsClient, auditLog }: RouteRouteDeps) {
  const app = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(auth);

  // All route routes require authentication and an active org
  app.use("/api/vps/:vpsId/routes/*", requireAuth, requireActiveOrg);
  app.use("/api/vps/:vpsId/routes", requireAuth, requireActiveOrg);

  /**
   * POST /api/vps/:vpsId/routes — Add an L4 forwarding route.
   */
  app.post(
    "/api/vps/:vpsId/routes",
    createRequirePermission(auth, "route", "create"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const body = await c.req.json();
      const result = await vpsClient.createRoute(vps, body);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "route.create",
        "route",
        null,
        { vpsId, matchType: body.match_type, matchValue: body.match_value }
      );

      return c.json({ data: result }, 201);
    }
  );

  /**
   * GET /api/vps/:vpsId/routes — List all L4 routes on a VPS.
   */
  app.get(
    "/api/vps/:vpsId/routes",
    createRequirePermission(auth, "route", "read"),
    async (c) => {
      const session = c.get("session");
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.listRoutes(vps);
      return c.json(result as Record<string, unknown>);
    }
  );

  /**
   * DELETE /api/vps/:vpsId/routes/:id — Remove an L4 route.
   */
  app.delete(
    "/api/vps/:vpsId/routes/:id",
    createRequirePermission(auth, "route", "delete"),
    async (c) => {
      const session = c.get("session");
      const user = c.get("user");
      const vpsId = c.req.param("vpsId");
      const routeId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId!);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.deleteRoute(vps, routeId);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "route.delete",
        "route",
        routeId,
        { vpsId }
      );

      return c.json({ data: result });
    }
  );

  return app;
}
