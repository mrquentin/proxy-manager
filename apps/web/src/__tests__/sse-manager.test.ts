import { describe, test, expect } from "bun:test";
import { parseSseEvent } from "../hooks/use-vps-events";

describe("SSE event parsing", () => {
  test("parses vps:status event", () => {
    const data = JSON.stringify({
      type: "vps:status",
      vpsId: "vps-123",
      status: "online",
    });
    const event = parseSseEvent("vps:status", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("vps:status");
    if (event!.type === "vps:status") {
      expect(event!.vpsId).toBe("vps-123");
      expect(event!.status).toBe("online");
    }
  });

  test("parses tunnel:connected event", () => {
    const data = JSON.stringify({
      type: "tunnel:connected",
      vpsId: "vps-456",
      tunnelId: "tun_abc",
    });
    const event = parseSseEvent("tunnel:connected", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("tunnel:connected");
    if (event!.type === "tunnel:connected") {
      expect(event!.vpsId).toBe("vps-456");
      expect(event!.tunnelId).toBe("tun_abc");
    }
  });

  test("parses tunnel:disconnected event", () => {
    const data = JSON.stringify({
      type: "tunnel:disconnected",
      vpsId: "vps-456",
      tunnelId: "tun_abc",
    });
    const event = parseSseEvent("tunnel:disconnected", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("tunnel:disconnected");
  });

  test("parses reconciliation:drift event", () => {
    const data = JSON.stringify({
      type: "reconciliation:drift",
      vpsId: "vps-789",
      caddyOps: 2,
      wgOps: 1,
      fwOps: 0,
    });
    const event = parseSseEvent("reconciliation:drift", data);
    expect(event).not.toBeNull();
    if (event!.type === "reconciliation:drift") {
      expect(event!.caddyOps).toBe(2);
      expect(event!.wgOps).toBe(1);
      expect(event!.fwOps).toBe(0);
    }
  });

  test("parses route:added event", () => {
    const data = JSON.stringify({
      type: "route:added",
      vpsId: "vps-123",
      routeId: "route_xyz",
    });
    const event = parseSseEvent("route:added", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("route:added");
  });

  test("parses route:removed event", () => {
    const data = JSON.stringify({
      type: "route:removed",
      vpsId: "vps-123",
      routeId: "route_xyz",
    });
    const event = parseSseEvent("route:removed", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("route:removed");
  });

  test("parses tunnel:rotation_pending event", () => {
    const data = JSON.stringify({
      type: "tunnel:rotation_pending",
      vpsId: "vps-123",
      tunnelId: "tun_abc",
    });
    const event = parseSseEvent("tunnel:rotation_pending", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("tunnel:rotation_pending");
  });

  test("parses tunnel:revoked_inactive event", () => {
    const data = JSON.stringify({
      type: "tunnel:revoked_inactive",
      vpsId: "vps-123",
      tunnelId: "tun_abc",
    });
    const event = parseSseEvent("tunnel:revoked_inactive", data);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("tunnel:revoked_inactive");
  });

  test("returns null for ping events", () => {
    const event = parseSseEvent("ping", "ping");
    expect(event).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const event = parseSseEvent("vps:status", "not-json");
    expect(event).toBeNull();
  });

  test("returns null for empty data", () => {
    const event = parseSseEvent("vps:status", "");
    expect(event).toBeNull();
  });
});
