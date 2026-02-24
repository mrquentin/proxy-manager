import { describe, it, expect, mock } from "bun:test";
import { Hono } from "hono";
import { createRequireAuth, createRequirePermission, requireActiveOrg } from "../../middleware/auth";
import type { Auth } from "../../lib/auth";

/**
 * Create a mock auth instance for testing.
 */
function createMockAuth(overrides: {
  getSession?: () => Promise<unknown>;
  hasPermission?: () => Promise<{ success: boolean }>;
} = {}) {
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
  } as unknown as Auth;
}

describe("middleware/auth", () => {
  describe("requireAuth", () => {
    it("should pass through when session is valid", async () => {
      const auth = createMockAuth();
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.get("/test", (c) => {
        const user = c.get("user") as { id: string };
        return c.json({ userId: user.id });
      });

      const res = await app.request("/test");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-1");
    });

    it("should return 401 when session is null", async () => {
      const auth = createMockAuth({
        getSession: () => Promise.resolve(null),
      });
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should set user and session on context", async () => {
      const auth = createMockAuth();
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.get("/test", (c) => {
        const user = c.get("user") as { id: string; email: string };
        const session = c.get("session") as { activeOrganizationId: string };
        return c.json({
          userId: user.id,
          email: user.email,
          orgId: session.activeOrganizationId,
        });
      });

      const res = await app.request("/test");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-1");
      expect(body.email).toBe("test@example.com");
      expect(body.orgId).toBe("org-1");
    });
  });

  describe("requirePermission", () => {
    it("should pass through when permission is granted", async () => {
      const auth = createMockAuth({
        hasPermission: () => Promise.resolve({ success: true }),
      });
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.use("*", createRequirePermission(auth, "vps", "create"));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("should return 403 when permission is denied", async () => {
      const auth = createMockAuth({
        hasPermission: () => Promise.resolve({ success: false }),
      });
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.use("*", createRequirePermission(auth, "vps", "create"));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("should return 403 when hasPermission returns null/undefined", async () => {
      const auth = createMockAuth({
        hasPermission: () => Promise.resolve(null as unknown as { success: boolean }),
      });
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.use("*", createRequirePermission(auth, "tunnel", "delete"));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
    });
  });

  describe("requireActiveOrg", () => {
    it("should pass through when active org is set", async () => {
      const auth = createMockAuth();
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.use("*", requireActiveOrg);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("should return 400 when active org is null", async () => {
      const auth = createMockAuth({
        getSession: () =>
          Promise.resolve({
            user: { id: "user-1", name: "Test", email: "t@t.com", image: null },
            session: { id: "s-1", userId: "user-1", activeOrganizationId: null },
          }),
      });
      const app = new Hono();
      app.use("*", createRequireAuth(auth));
      app.use("*", requireActiveOrg);
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("No active organization selected");
    });
  });
});
