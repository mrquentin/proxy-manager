import { describe, it, expect, beforeEach } from "bun:test";
import { SSEManager } from "../../services/sse-manager";
import type { SseEvent, VpsStatusEvent } from "@proxy-manager/shared";

describe("SSEManager", () => {
  let manager: SSEManager;

  beforeEach(() => {
    manager = new SSEManager();
  });

  describe("subscribe/unsubscribe", () => {
    it("should add a subscriber", () => {
      manager.subscribe("user1:conn1", "org1", () => {});
      expect(manager.subscriberCount).toBe(1);
    });

    it("should remove a subscriber via the returned unsubscribe function", () => {
      const unsub = manager.subscribe("user1:conn1", "org1", () => {});
      expect(manager.subscriberCount).toBe(1);
      unsub();
      expect(manager.subscriberCount).toBe(0);
    });

    it("should remove a subscriber via unsubscribe method", () => {
      manager.subscribe("user1:conn1", "org1", () => {});
      expect(manager.subscriberCount).toBe(1);
      manager.unsubscribe("user1:conn1");
      expect(manager.subscriberCount).toBe(0);
    });

    it("should support multiple subscribers", () => {
      manager.subscribe("user1:conn1", "org1", () => {});
      manager.subscribe("user2:conn1", "org1", () => {});
      manager.subscribe("user3:conn1", "org2", () => {});
      expect(manager.subscriberCount).toBe(3);
    });

    it("should handle unsubscribing a non-existent subscriber gracefully", () => {
      manager.unsubscribe("nonexistent");
      expect(manager.subscriberCount).toBe(0);
    });
  });

  describe("broadcast", () => {
    it("should broadcast to all subscribers", () => {
      const received: SseEvent[] = [];
      manager.subscribe("user1:conn1", "org1", (e) => { received.push(e); });
      manager.subscribe("user2:conn1", "org2", (e) => { received.push(e); });

      const event: VpsStatusEvent = { type: "vps:status", vpsId: "vps1", status: "online" };
      manager.broadcast(event);

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual(event);
      expect(received[1]).toEqual(event);
    });

    it("should not fail if a subscriber callback throws", () => {
      manager.subscribe("user1:conn1", "org1", () => {
        throw new Error("callback error");
      });
      manager.subscribe("user2:conn1", "org1", () => {});

      const event: VpsStatusEvent = { type: "vps:status", vpsId: "vps1", status: "online" };
      // Should not throw
      expect(() => manager.broadcast(event)).not.toThrow();
    });
  });

  describe("broadcastToOrg", () => {
    it("should only broadcast to subscribers in the specified org", () => {
      const org1Received: SseEvent[] = [];
      const org2Received: SseEvent[] = [];

      manager.subscribe("user1:conn1", "org1", (e) => { org1Received.push(e); });
      manager.subscribe("user2:conn1", "org2", (e) => { org2Received.push(e); });
      manager.subscribe("user3:conn1", "org1", (e) => { org1Received.push(e); });

      const event: VpsStatusEvent = { type: "vps:status", vpsId: "vps1", status: "offline" };
      manager.broadcastToOrg("org1", event);

      expect(org1Received).toHaveLength(2);
      expect(org2Received).toHaveLength(0);
    });

    it("should not broadcast to subscribers with null orgId", () => {
      const received: SseEvent[] = [];
      manager.subscribe("user1:conn1", null, (e) => { received.push(e); });

      const event: VpsStatusEvent = { type: "vps:status", vpsId: "vps1", status: "online" };
      manager.broadcastToOrg("org1", event);

      expect(received).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("should remove all subscribers", () => {
      manager.subscribe("user1:conn1", "org1", () => {});
      manager.subscribe("user2:conn1", "org2", () => {});
      expect(manager.subscriberCount).toBe(2);

      manager.clear();
      expect(manager.subscriberCount).toBe(0);
    });
  });
});
