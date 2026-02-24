import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { createTunnelRoutes } from "../routes/tunnels";
import {
  createMockAuth,
  createMockVpsClient,
  createMockAuditLog,
  createMockDb,
  TEST_ENV,
  MOCK_VPS_ROW,
} from "./helpers";

describe("Tunnel routes", () => {
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
    app.route("/", createTunnelRoutes({ db, auth, env: TEST_ENV, vpsClient, auditLog }));
    return { app, vpsClient, auditLog };
  }

  describe("POST /api/vps/:vpsId/tunnels", () => {
    it("should create a tunnel via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: ["app.example.com"], upstreamPort: 443 }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe("tun-1");
      expect(vpsClient.createTunnel).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/tunnels", {
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
      const res = await app.request("/api/vps/vps-1/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/vps/:vpsId/tunnels", () => {
    it("should list tunnels from VPS API", async () => {
      const tunnels = [{ id: "tun-1" }, { id: "tun-2" }];
      const { app } = createApp(undefined, {
        listTunnels: () => Promise.resolve(tunnels),
      });
      const res = await app.request("/api/vps/vps-1/tunnels");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(tunnels);
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/tunnels");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/vps/:vpsId/tunnels/:id", () => {
    it("should delete a tunnel via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(vpsClient.deleteTunnel).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("tunnel.delete");
    });
  });

  describe("GET /api/vps/:vpsId/tunnels/:id/config", () => {
    it("should return tunnel config from VPS API", async () => {
      const { app } = createApp(undefined, {
        getTunnelConfig: () => Promise.resolve({ configText: "[Interface]\nPrivateKey=..." }),
      });
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1/config");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.configText).toContain("[Interface]");
    });
  });

  describe("GET /api/vps/:vpsId/tunnels/:id/qr", () => {
    it("should return QR code from VPS API", async () => {
      const { app } = createApp(undefined, {
        getTunnelQr: () => Promise.resolve({ qrUrl: "/qr.png" }),
      });
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1/qr");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/vps/:vpsId/tunnels/:id/rotate", () => {
    it("should rotate tunnel keys via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1/rotate", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(vpsClient.rotateTunnel).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
      expect(auditLog.calls[0]![2]).toBe("tunnel.rotate");
    });
  });

  describe("GET /api/vps/:vpsId/tunnels/:id/rotation-policy", () => {
    it("should return rotation policy from VPS API", async () => {
      const policy = { autoRotatePsk: true, pskRotationIntervalDays: 90 };
      const { app, vpsClient } = createApp(undefined, {
        getRotationPolicy: () => Promise.resolve(policy),
      });
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1/rotation-policy");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual(policy);
      expect(vpsClient.getRotationPolicy).toHaveBeenCalled();
    });

    it("should return 404 when VPS not found", async () => {
      const { app } = createApp([]);
      const res = await app.request("/api/vps/nonexistent/tunnels/tun-1/rotation-policy");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/vps/:vpsId/tunnels/:id/rotation-policy", () => {
    it("should update rotation policy via VPS API", async () => {
      const { app, vpsClient, auditLog } = createApp();
      const res = await app.request("/api/vps/vps-1/tunnels/tun-1/rotation-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRotatePsk: true, pskRotationIntervalDays: 90 }),
      });
      expect(res.status).toBe(200);
      expect(vpsClient.updateRotationPolicy).toHaveBeenCalled();
      expect(auditLog.calls).toHaveLength(1);
    });
  });
});
