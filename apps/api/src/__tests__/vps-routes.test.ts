import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { createVpsRoutes } from "../routes/vps";
import {
  createMockAuth,
  createMockVpsClient,
  createMockAuditLog,
  createMockDb,
  TEST_ENV,
  MOCK_VPS_ROW,
} from "./helpers";

describe("VPS routes", () => {
  function createApp(
    dbRows: Record<string, unknown>[] = [MOCK_VPS_ROW],
    authOverrides?: Parameters<typeof createMockAuth>[0],
    vpsClientOverrides?: Record<string, () => Promise<unknown>>
  ) {
    const auth = createMockAuth(authOverrides);
    const { db, insertedValues, deletedIds } = createMockDb(dbRows);
    const auditLog = createMockAuditLog();
    const vpsClient = createMockVpsClient(vpsClientOverrides);

    const app = new Hono();
    app.route("/", createVpsRoutes({ db, auth, env: TEST_ENV, auditLog, vpsClient }));
    return { app, insertedValues, deletedIds, auditLog, vpsClient };
  }

  describe("GET /api/vps", () => {
    it("should return a list of VPS instances", async () => {
      const { app } = createApp();
      const res = await app.request("/api/vps");
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("vps-1");
      expect(body.data[0].encryptedClientKey).toBe("[encrypted]");
    });

    it("should return 401 when not authenticated", async () => {
      const { app } = createApp([], {
        getSession: () => Promise.resolve(null),
      });
      const res = await app.request("/api/vps");
      expect(res.status).toBe(401);
    });

    it("should return 400 when no active org", async () => {
      const { app } = createApp([], {
        getSession: () =>
          Promise.resolve({
            user: { id: "user-1", name: "T", email: "t@t.com", image: null },
            session: { id: "s-1", userId: "user-1", activeOrganizationId: null },
          }),
      });
      const res = await app.request("/api/vps");
      expect(res.status).toBe(400);
    });

    it("should return 403 when permission is denied", async () => {
      const { app } = createApp([], {
        hasPermission: () => Promise.resolve({ success: false }),
      });
      const res = await app.request("/api/vps");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/vps/:id", () => {
    it("should return a single VPS instance", async () => {
      const { app } = createApp();
      const res = await app.request("/api/vps/vps-1");
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.id).toBe("vps-1");
      expect(body.data.name).toBe("Test VPS");
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/vps", () => {
    it("should create a new VPS instance", async () => {
      const { app, auditLog } = createApp();
      const res = await app.request("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New VPS",
          apiUrl: "https://10.0.0.2:7443",
          clientCert: "cert-pem",
          clientKey: "key-pem",
          serverCa: "ca-pem",
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.name).toBe("Test VPS"); // From mock DB select
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("vps.create");
    });

    it("should return 400 when required fields are missing", async () => {
      const { app } = createApp();
      const res = await app.request("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Incomplete" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/vps/:id", () => {
    it("should delete a VPS instance", async () => {
      const { app, deletedIds, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.deleted).toBe(true);
      expect(deletedIds).toHaveLength(1);
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("vps.delete");
    });

    it("should return 404 when VPS not found for deletion", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/vps/:id/status", () => {
    it("should return VPS status from the control plane", async () => {
      const statusReport = { tunnels: { total: 2, connected: 1 } };
      const { app, vpsClient } = createApp(undefined, undefined, {
        getStatus: () => Promise.resolve({ data: statusReport }),
      });
      const res = await app.request("/api/vps/vps-1/status");
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toEqual(statusReport);
      expect(vpsClient.getStatus).toHaveBeenCalled();
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/status");
      expect(res.status).toBe(404);
    });

    it("should return 502 when VPS API call fails", async () => {
      const { app } = createApp(undefined, undefined, {
        getStatus: () => Promise.reject(new Error("Connection refused")),
      });
      const res = await app.request("/api/vps/vps-1/status");
      expect(res.status).toBe(502);
      const body = await res.json() as any;
      expect(body.error).toContain("Connection refused");
    });
  });

  describe("POST /api/vps/:id/reconcile", () => {
    it("should trigger reconciliation on the VPS", async () => {
      const { app, vpsClient, auditLog } = createApp(undefined, undefined, {
        reconcile: () => Promise.resolve({ status: "ok" }),
      });
      const res = await app.request("/api/vps/vps-1/reconcile", { method: "POST" });
      expect(res.status).toBe(200);
      expect(vpsClient.reconcile).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("vps.reconcile");
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/reconcile", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should return 502 when VPS API call fails", async () => {
      const { app } = createApp(undefined, undefined, {
        reconcile: () => Promise.reject(new Error("Timeout")),
      });
      const res = await app.request("/api/vps/vps-1/reconcile", { method: "POST" });
      expect(res.status).toBe(502);
      const body = await res.json() as any;
      expect(body.error).toContain("Timeout");
    });
  });
});
