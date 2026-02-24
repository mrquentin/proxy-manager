import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { createRouteRoutes } from "../routes/routes";
import {
  createMockAuth,
  createMockVpsClient,
  createMockAuditLog,
  createMockDb,
  TEST_ENV,
  MOCK_VPS_ROW,
} from "./helpers";

describe("Route routes (L4)", () => {
  function createApp(
    dbRows: Record<string, unknown>[] = [MOCK_VPS_ROW],
    vpsClientOverrides?: Record<string, () => Promise<unknown>>,
    authOverrides?: Parameters<typeof createMockAuth>[0]
  ) {
    const auth = createMockAuth(authOverrides);
    const { db } = createMockDb(dbRows);
    const vpsClient = createMockVpsClient(vpsClientOverrides);
    const auditLog = createMockAuditLog();

    const app = new Hono();
    app.route("/", createRouteRoutes({ db, auth, env: TEST_ENV, vpsClient, auditLog }));
    return { app, vpsClient, auditLog };
  }

  describe("POST /api/vps/:vpsId/routes", () => {
    it("should create an L4 route via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tunnel_id: "tun-1",
          match_type: "sni",
          match_value: ["app.example.com"],
          upstream_port: 443,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe("route-1");
      expect(vpsClient.createRoute).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("route.create");
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("should return 401 when not authenticated", async () => {
      const { app } = createApp([], undefined, {
        getSession: () => Promise.resolve(null),
      });
      const res = await app.request("/api/vps/vps-1/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("should return 403 when permission is denied", async () => {
      const { app } = createApp([], undefined, {
        hasPermission: () => Promise.resolve({ success: false }),
      });
      const res = await app.request("/api/vps/vps-1/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/vps/:vpsId/routes", () => {
    it("should list routes from VPS API", async () => {
      const routes = [
        { id: "route-1", matchType: "sni", matchValue: ["example.com"] },
        { id: "route-2", matchType: "sni", matchValue: ["api.example.com"] },
      ];
      const { app } = createApp(undefined, {
        listRoutes: () => Promise.resolve(routes),
      });
      const res = await app.request("/api/vps/vps-1/routes");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(routes);
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/routes");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/vps/:vpsId/routes/:id", () => {
    it("should delete a route via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/routes/route-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(vpsClient.deleteRoute).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("route.delete");
    });

    it("should return 404 when VPS not found for deletion", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/routes/route-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });
});
