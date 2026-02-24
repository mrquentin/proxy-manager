import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { VpsPoller } from "../../services/vps-poller";
import { SSEManager } from "../../services/sse-manager";
import type { VpsClient } from "../../lib/vps-client";
import type { SseEvent } from "@proxy-manager/shared";

// Mock VPS record matching the schema
function createMockVps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "vps-1",
    organizationId: "org-1",
    name: "Test VPS",
    apiUrl: "https://10.0.0.1:7443",
    encryptedClientKey: "encrypted-key",
    clientCert: "cert-pem",
    serverCa: "ca-pem",
    status: "unknown",
    lastSeenAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// Mock database
function createMockDb(instances: ReturnType<typeof createMockVps>[] = []) {
  const updatedRows: { id: string; set: Record<string, unknown> }[] = [];

  return {
    db: {
      select: () => ({
        from: () => Promise.resolve(instances),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            // Extract the VPS ID from the condition — simplified for testing
            const id = instances[updatedRows.length % instances.length]?.id ?? "unknown";
            updatedRows.push({ id, set: values });
            return Promise.resolve();
          },
        }),
      }),
    } as unknown as ReturnType<typeof import("@proxy-manager/db").createDatabase>,
    updatedRows,
  };
}

describe("VpsPoller", () => {
  let sseManager: SSEManager;

  beforeEach(() => {
    sseManager = new SSEManager();
  });

  it("should mark a VPS as online when status check succeeds", async () => {
    const vps = createMockVps({ status: "unknown" });
    const mockDb = createMockDb([vps]);

    const mockVpsClient = {
      getStatus: mock(() => Promise.resolve({ tunnels: { total: 0 } })),
    } as unknown as VpsClient;

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(mockDb.updatedRows).toHaveLength(1);
    expect(mockDb.updatedRows[0]!.set.status).toBe("online");
    expect(mockDb.updatedRows[0]!.set.lastSeenAt).toBeInstanceOf(Date);
  });

  it("should mark a VPS as offline when status check fails", async () => {
    const vps = createMockVps({ status: "online" });
    const mockDb = createMockDb([vps]);

    const mockVpsClient = {
      getStatus: mock(() => Promise.reject(new Error("Connection refused"))),
    } as unknown as VpsClient;

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(mockDb.updatedRows).toHaveLength(1);
    expect(mockDb.updatedRows[0]!.set.status).toBe("offline");
  });

  it("should broadcast SSE event when VPS status changes to online", async () => {
    const vps = createMockVps({ status: "offline" });
    const mockDb = createMockDb([vps]);

    const mockVpsClient = {
      getStatus: mock(() => Promise.resolve({})),
    } as unknown as VpsClient;

    const events: SseEvent[] = [];
    sseManager.subscribe("test:1", "org-1", (e) => events.push(e));

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("vps:status");
    if (events[0]!.type === "vps:status") {
      expect(events[0]!.status).toBe("online");
      expect(events[0]!.vpsId).toBe("vps-1");
    }
  });

  it("should broadcast SSE event when VPS status changes to offline", async () => {
    const vps = createMockVps({ status: "online" });
    const mockDb = createMockDb([vps]);

    const mockVpsClient = {
      getStatus: mock(() => Promise.reject(new Error("timeout"))),
    } as unknown as VpsClient;

    const events: SseEvent[] = [];
    sseManager.subscribe("test:1", "org-1", (e) => events.push(e));

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("vps:status");
    if (events[0]!.type === "vps:status") {
      expect(events[0]!.status).toBe("offline");
    }
  });

  it("should NOT broadcast when status does not change", async () => {
    const vps = createMockVps({ status: "online" });
    const mockDb = createMockDb([vps]);

    const mockVpsClient = {
      getStatus: mock(() => Promise.resolve({})),
    } as unknown as VpsClient;

    const events: SseEvent[] = [];
    sseManager.subscribe("test:1", "org-1", (e) => events.push(e));

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(events).toHaveLength(0);
  });

  it("should handle multiple VPS instances in a single poll", async () => {
    const vps1 = createMockVps({ id: "vps-1", status: "unknown" });
    const vps2 = createMockVps({ id: "vps-2", status: "unknown" });
    const mockDb = createMockDb([vps1, vps2]);

    let callCount = 0;
    const mockVpsClient = {
      getStatus: mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({});
        return Promise.reject(new Error("offline"));
      }),
    } as unknown as VpsClient;

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    await poller.poll();

    expect(mockDb.updatedRows).toHaveLength(2);
    expect(mockDb.updatedRows[0]!.set.status).toBe("online");
    expect(mockDb.updatedRows[1]!.set.status).toBe("offline");
  });

  it("should start and stop the polling timer", () => {
    const mockDb = createMockDb([]);
    const mockVpsClient = {
      getStatus: mock(() => Promise.resolve({})),
    } as unknown as VpsClient;

    const poller = new VpsPoller(mockDb.db, mockVpsClient, sseManager, 60_000);
    poller.start();
    // Should not throw on double start
    poller.start();
    poller.stop();
    // Should not throw on double stop
    poller.stop();
  });
});
