import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { createFirewallRoutes } from "../routes/firewall";
import {
  createMockAuth,
  createMockVpsClient,
  createMockAuditLog,
  createMockDb,
  TEST_ENV,
  MOCK_VPS_ROW,
} from "./helpers";

describe("Firewall routes", () => {
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
    app.route("/", createFirewallRoutes({ db, auth, env: TEST_ENV, vpsClient, auditLog }));
    return { app, vpsClient, auditLog };
  }

  describe("POST /api/vps/:vpsId/firewall/rules", () => {
    it("should create a firewall rule via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/firewall/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: 8080, proto: "tcp", source_cidr: "0.0.0.0/0", action: "allow" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.id).toBe("fw-1");
      expect(vpsClient.createFirewallRule).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("firewall.create");
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/firewall/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: 80, proto: "tcp" }),
      });
      expect(res.status).toBe(404);
    });

    it("should return 401 when not authenticated", async () => {
      const { app } = createApp([], undefined, {
        getSession: () => Promise.resolve(null),
      });
      const res = await app.request("/api/vps/vps-1/firewall/rules", {
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
      const res = await app.request("/api/vps/vps-1/firewall/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/vps/:vpsId/firewall/rules", () => {
    it("should list firewall rules from VPS API", async () => {
      const rules = [
        { id: "fw-1", port: 8080, proto: "tcp", action: "allow" },
        { id: "fw-2", port: 443, proto: "tcp", action: "allow" },
      ];
      const { app } = createApp(undefined, {
        listFirewallRules: () => Promise.resolve(rules),
      });
      const res = await app.request("/api/vps/vps-1/firewall/rules");
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(rules);
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/firewall/rules");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/vps/:vpsId/firewall/rules/:id", () => {
    it("should delete a firewall rule via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/firewall/rules/fw-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(vpsClient.deleteFirewallRule).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("firewall.delete");
    });

    it("should return 404 when VPS not found for deletion", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/firewall/rules/fw-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });
});
