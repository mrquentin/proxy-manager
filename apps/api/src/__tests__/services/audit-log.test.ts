import { describe, it, expect, beforeEach, mock } from "bun:test";
import { AuditLogService } from "../../services/audit-log";

// Mock database
function createMockDb() {
  const insertedValues: unknown[] = [];
  return {
    db: {
      insert: () => ({
        values: (vals: unknown) => {
          insertedValues.push(vals);
          return Promise.resolve();
        },
      }),
    } as unknown as ReturnType<typeof import("@proxy-manager/db").createDatabase>,
    insertedValues,
  };
}

describe("AuditLogService", () => {
  let service: AuditLogService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new AuditLogService(mockDb.db);
  });

  it("should write an audit log entry with all fields", async () => {
    await service.logAction("org1", "user1", "vps.create", "vps", "vps-123", {
      name: "Test VPS",
    });

    expect(mockDb.insertedValues).toHaveLength(1);
    const entry = mockDb.insertedValues[0] as Record<string, unknown>;
    expect(entry.organizationId).toBe("org1");
    expect(entry.userId).toBe("user1");
    expect(entry.action).toBe("vps.create");
    expect(entry.resourceType).toBe("vps");
    expect(entry.resourceId).toBe("vps-123");
    expect(entry.metadata).toBe(JSON.stringify({ name: "Test VPS" }));
  });

  it("should write an audit log entry without optional fields", async () => {
    await service.logAction("org1", "user1", "tunnel.delete", "tunnel");

    expect(mockDb.insertedValues).toHaveLength(1);
    const entry = mockDb.insertedValues[0] as Record<string, unknown>;
    expect(entry.resourceId).toBeNull();
    expect(entry.metadata).toBeNull();
  });

  it("should write an audit log entry with null metadata", async () => {
    await service.logAction("org1", "user1", "firewall.create", "firewall", "fw-1", null);

    expect(mockDb.insertedValues).toHaveLength(1);
    const entry = mockDb.insertedValues[0] as Record<string, unknown>;
    expect(entry.metadata).toBeNull();
  });

  it("should not throw if the database insert fails", async () => {
    const failingDb = {
      insert: () => ({
        values: () => Promise.reject(new Error("DB write failed")),
      }),
    } as unknown as ReturnType<typeof import("@proxy-manager/db").createDatabase>;

    const failingService = new AuditLogService(failingDb);

    // Should not throw — it logs the error internally
    await expect(
      failingService.logAction("org1", "user1", "vps.delete", "vps", "vps-1")
    ).resolves.toBeUndefined();
  });
});
