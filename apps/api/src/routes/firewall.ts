import { Hono } from "hono";
import type { Auth } from "../lib/auth";
import type { Env } from "../lib/env";
import type { VpsClient } from "../lib/vps-client";
import { getVps } from "../lib/vps-helpers";
import { createRequireAuth, createRequirePermission, requireActiveOrg } from "../middleware/auth";
import type { AuditLogService } from "../services/audit-log";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

interface FirewallRouteDeps {
  db: Database;
  auth: Auth;
  env: Env;
  vpsClient: VpsClient;
  auditLog: AuditLogService;
}

/**
 * Create firewall proxy routes.
 * These routes proxy requests to the VPS control plane firewall API.
 */
export function createFirewallRoutes({ db, auth, env, vpsClient, auditLog }: FirewallRouteDeps) {
  const app = new Hono();
  const requireAuth = createRequireAuth(auth);

  // All firewall routes require authentication and an active org
  app.use("/api/vps/:vpsId/firewall/*", requireAuth, requireActiveOrg);

  /**
   * POST /api/vps/:vpsId/firewall/rules — Add a dynamic firewall rule.
   */
  app.post(
    "/api/vps/:vpsId/firewall/rules",
    createRequirePermission(auth, "firewall", "create"),
    async (c) => {
      const session = c.get("session") as { activeOrganizationId: string };
      const user = c.get("user") as { id: string };
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const body = await c.req.json();
      const result = await vpsClient.createFirewallRule(vps, body);

      await auditLog.logAction(
        session.activeOrganizationId,
        user.id,
        "firewall.create",
        "firewall",
        null,
        { vpsId, port: body.port, proto: body.proto, action: body.action }
      );

      return c.json({ data: result }, 201);
    }
  );

  /**
   * GET /api/vps/:vpsId/firewall/rules — List all dynamic firewall rules.
   */
  app.get(
    "/api/vps/:vpsId/firewall/rules",
    createRequirePermission(auth, "firewall", "read"),
    async (c) => {
      const session = c.get("session") as { activeOrganizationId: string };
      const vpsId = c.req.param("vpsId");

      const vps = await getVps(db, vpsId, session.activeOrganizationId);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.listFirewallRules(vps);
      return c.json({ data: result });
    }
  );

  /**
   * DELETE /api/vps/:vpsId/firewall/rules/:id — Remove a firewall rule.
   */
  app.delete(
    "/api/vps/:vpsId/firewall/rules/:id",
    createRequirePermission(auth, "firewall", "delete"),
    async (c) => {
      const session = c.get("session") as { activeOrganizationId: string };
      const user = c.get("user") as { id: string };
      const vpsId = c.req.param("vpsId");
      const ruleId = c.req.param("id");

      const vps = await getVps(db, vpsId, session.activeOrganizationId);
      if (!vps) {
        return c.json({ error: "VPS instance not found" }, 404);
      }

      const result = await vpsClient.deleteFirewallRule(vps, ruleId);

      await auditLog.logAction(
        session.activeOrganizationId,
        user.id,
        "firewall.delete",
        "firewall",
        ruleId,
        { vpsId }
      );

      return c.json({ data: result });
    }
  );

  return app;
}
