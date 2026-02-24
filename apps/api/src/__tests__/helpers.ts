import { mock } from "bun:test";
import type { Auth } from "../lib/auth";
import type { VpsClient } from "../lib/vps-client";
import type { AuditLogService } from "../services/audit-log";
import type { Env } from "../lib/env";

/**
 * Create a mock auth instance for route testing.
 * By default: authenticated user with org-1, all permissions granted.
 */
export function createMockAuth(overrides: {
  getSession?: () => Promise<unknown>;
  hasPermission?: () => Promise<{ success: boolean }>;
} = {}): Auth {
  return {
    api: {
      getSession: overrides.getSession ?? mock(() =>
        Promise.resolve({
          user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
          session: { id: "session-1", userId: "user-1", activeOrganizationId: "org-1" },
        })
      ),
      hasPermission: overrides.hasPermission ?? mock(() =>
        Promise.resolve({ success: true })
      ),
    },
    handler: mock(() => new Response("auth handler")),
  } as unknown as Auth;
}

/**
 * Create a mock VPS client where every method returns successfully.
 */
export function createMockVpsClient(methodOverrides: Record<string, () => Promise<unknown>> = {}): VpsClient {
  const defaultMethod = () => Promise.resolve({ ok: true });
  return {
    getStatus: mock(methodOverrides.getStatus ?? defaultMethod),
    getServerPubkey: mock(methodOverrides.getServerPubkey ?? defaultMethod),
    reconcile: mock(methodOverrides.reconcile ?? defaultMethod),
    createTunnel: mock(methodOverrides.createTunnel ?? (() => Promise.resolve({ id: "tun-1" }))),
    listTunnels: mock(methodOverrides.listTunnels ?? (() => Promise.resolve([]))),
    deleteTunnel: mock(methodOverrides.deleteTunnel ?? defaultMethod),
    getTunnelConfig: mock(methodOverrides.getTunnelConfig ?? (() => Promise.resolve({ configText: "config" }))),
    getTunnelQr: mock(methodOverrides.getTunnelQr ?? defaultMethod),
    rotateTunnel: mock(methodOverrides.rotateTunnel ?? (() => Promise.resolve({ config: "new-config" }))),
    getRotationPolicy: mock(methodOverrides.getRotationPolicy ?? defaultMethod),
    updateRotationPolicy: mock(methodOverrides.updateRotationPolicy ?? defaultMethod),
    createRoute: mock(methodOverrides.createRoute ?? (() => Promise.resolve({ id: "route-1" }))),
    listRoutes: mock(methodOverrides.listRoutes ?? (() => Promise.resolve([]))),
    deleteRoute: mock(methodOverrides.deleteRoute ?? defaultMethod),
    createFirewallRule: mock(methodOverrides.createFirewallRule ?? (() => Promise.resolve({ id: "fw-1" }))),
    listFirewallRules: mock(methodOverrides.listFirewallRules ?? (() => Promise.resolve([]))),
    deleteFirewallRule: mock(methodOverrides.deleteFirewallRule ?? defaultMethod),
  } as unknown as VpsClient;
}

/**
 * Create a mock audit log service.
 */
export function createMockAuditLog(): AuditLogService & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    logAction: mock((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    }),
    calls,
  } as unknown as AuditLogService & { calls: unknown[][] };
}

/**
 * A valid test env configuration.
 */
export const TEST_ENV: Env = {
  PORT: 3000,
  DATABASE_PATH: ":memory:",
  JWT_SECRET: "a".repeat(32),
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  PASSKEY_RP_ID: "localhost",
  PASSKEY_ORIGIN: "http://localhost:3000",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "test",
};

/**
 * VPS row matching the DB schema for mocking DB queries.
 */
export const MOCK_VPS_ROW = {
  id: "vps-1",
  organizationId: "org-1",
  name: "Test VPS",
  apiUrl: "https://10.0.0.1:7443",
  encryptedClientKey: "encrypted",
  clientCert: "cert",
  serverCa: "ca",
  status: "online" as const,
  lastSeenAt: new Date(),
  createdAt: new Date(),
};

/**
 * Create a mock database for route testing.
 * Supports select (returns mockRows), insert, and delete.
 */
export function createMockDb(mockRows: Record<string, unknown>[] = [MOCK_VPS_ROW]) {
  const insertedValues: unknown[] = [];
  const deletedIds: string[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows),
      }),
    }),
    insert: () => ({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: () => {
        deletedIds.push("deleted");
        return Promise.resolve();
      },
    }),
  } as unknown as ReturnType<typeof import("@proxy-manager/db").createDatabase>;

  return { db, insertedValues, deletedIds };
}
