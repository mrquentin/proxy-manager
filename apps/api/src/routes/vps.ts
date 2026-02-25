import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { vpsInstances } from "@proxy-manager/db";
import { encrypt } from "../lib/crypto";
import type { Auth } from "../lib/auth";
import type { Env } from "../lib/env";
import type { AppEnv } from "../lib/hono-env";
import type { VpsClient } from "../lib/vps-client";
import { createRequireAuth, createRequirePermission, requireActiveOrg } from "../middleware/auth";
import type { AuditLogService } from "../services/audit-log";

/** Zod schema for VPS creation request body. */
const createVpsSchema = z.object({
  name: z.string().min(1).max(255),
  apiUrl: z.string().url().max(2048),
  clientCert: z.string().min(1).max(65536),
  clientKey: z.string().min(1).max(65536),
  serverCa: z.string().min(1).max(65536),
});

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

interface VpsRouteDeps {
  db: Database;
  auth: Auth;
  env: Env;
  auditLog: AuditLogService;
  vpsClient?: VpsClient;
}

/**
 * Create VPS CRUD routes.
 * All operations are scoped to the user's active organization.
 */
export function createVpsRoutes({ db, auth, env, auditLog, vpsClient }: VpsRouteDeps) {
  const app = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(auth);

  // All VPS routes require authentication and an active org
  app.use("/api/vps/*", requireAuth, requireActiveOrg);
  app.use("/api/vps", requireAuth, requireActiveOrg);

  /**
   * POST /api/vps — Register a new VPS instance.
   * Encrypts the client key before storing in the database.
   */
  app.post("/api/vps", createRequirePermission(auth, "vps", "create"), async (c) => {
    const session = c.get("session");
    const user = c.get("user");
    const raw = await c.req.json();
    const parsed = createVpsSchema.safeParse(raw);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return c.json({ error: `Validation failed: ${errors}` }, 400);
    }

    const { name, apiUrl, clientCert, clientKey, serverCa } = parsed.data;

    // Encrypt the client private key before storing
    const encryptedClientKey = await encrypt(clientKey, env.ENCRYPTION_KEY);

    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(vpsInstances).values({
      id,
      organizationId: session.activeOrganizationId!,
      name,
      apiUrl,
      encryptedClientKey,
      clientCert,
      serverCa,
      status: "unknown",
      createdAt: now,
    });

    await auditLog.logAction(
      session.activeOrganizationId!,
      user.id,
      "vps.create",
      "vps",
      id,
      { name, apiUrl }
    );

    const [created] = await db
      .select()
      .from(vpsInstances)
      .where(eq(vpsInstances.id, id));

    if (!created) {
      return c.json({ error: "Failed to create VPS instance" }, 500);
    }

    // Return the VPS instance without the encrypted key details
    return c.json(
      {
        data: {
          id: created.id,
          organizationId: created.organizationId,
          name: created.name,
          apiUrl: created.apiUrl,
          clientCert: created.clientCert,
          encryptedClientKey: "[encrypted]",
          serverCa: created.serverCa,
          status: created.status,
          lastSeenAt: created.lastSeenAt?.toISOString() ?? null,
          createdAt: created.createdAt.toISOString(),
        },
      },
      201
    );
  });

  /**
   * GET /api/vps — List all VPS instances for the active organization.
   */
  app.get("/api/vps", createRequirePermission(auth, "vps", "read"), async (c) => {
    const session = c.get("session");

    const instances = await db
      .select()
      .from(vpsInstances)
      .where(eq(vpsInstances.organizationId, session.activeOrganizationId!));

    return c.json({
      data: instances.map((v) => ({
        id: v.id,
        organizationId: v.organizationId,
        name: v.name,
        apiUrl: v.apiUrl,
        clientCert: v.clientCert,
        encryptedClientKey: "[encrypted]",
        serverCa: v.serverCa,
        status: v.status,
        lastSeenAt: v.lastSeenAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  });

  /**
   * GET /api/vps/:id — Get a single VPS instance by ID.
   */
  app.get("/api/vps/:id", createRequirePermission(auth, "vps", "read"), async (c) => {
    const session = c.get("session");
    const id = c.req.param("id");

    const [vps] = await db
      .select()
      .from(vpsInstances)
      .where(
        and(eq(vpsInstances.id, id), eq(vpsInstances.organizationId, session.activeOrganizationId!))
      );

    if (!vps) {
      return c.json({ error: "VPS instance not found" }, 404);
    }

    return c.json({
      data: {
        id: vps.id,
        organizationId: vps.organizationId,
        name: vps.name,
        apiUrl: vps.apiUrl,
        clientCert: vps.clientCert,
        encryptedClientKey: "[encrypted]",
        serverCa: vps.serverCa,
        status: vps.status,
        lastSeenAt: vps.lastSeenAt?.toISOString() ?? null,
        createdAt: vps.createdAt.toISOString(),
      },
    });
  });

  /**
   * DELETE /api/vps/:id — Remove a VPS instance.
   */
  app.delete("/api/vps/:id", createRequirePermission(auth, "vps", "delete"), async (c) => {
    const session = c.get("session");
    const user = c.get("user");
    const id = c.req.param("id");

    const [vps] = await db
      .select()
      .from(vpsInstances)
      .where(
        and(eq(vpsInstances.id, id), eq(vpsInstances.organizationId, session.activeOrganizationId!))
      );

    if (!vps) {
      return c.json({ error: "VPS instance not found" }, 404);
    }

    await db.delete(vpsInstances).where(eq(vpsInstances.id, id));

    await auditLog.logAction(
      session.activeOrganizationId!,
      user.id,
      "vps.delete",
      "vps",
      id,
      { name: vps.name }
    );

    return c.json({ data: { id, deleted: true } });
  });

  /**
   * GET /api/vps/:id/status — Get VPS status report by proxying to the VPS control plane.
   */
  app.get("/api/vps/:id/status", createRequirePermission(auth, "vps", "read"), async (c) => {
    const session = c.get("session");
    const id = c.req.param("id");

    const [vps] = await db
      .select()
      .from(vpsInstances)
      .where(
        and(eq(vpsInstances.id, id), eq(vpsInstances.organizationId, session.activeOrganizationId!))
      );

    if (!vps) {
      return c.json({ error: "VPS instance not found" }, 404);
    }

    if (!vpsClient) {
      return c.json({ error: "VPS client not configured" }, 500);
    }

    try {
      const status = await vpsClient.getStatus(vps);
      return c.json(status as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch VPS status";
      return c.json({ error: message }, 502);
    }
  });

  /**
   * POST /api/vps/:id/reconcile — Trigger immediate reconciliation on the VPS.
   */
  app.post("/api/vps/:id/reconcile", createRequirePermission(auth, "vps", "update"), async (c) => {
    const session = c.get("session");
    const user = c.get("user");
    const id = c.req.param("id");

    const [vps] = await db
      .select()
      .from(vpsInstances)
      .where(
        and(eq(vpsInstances.id, id), eq(vpsInstances.organizationId, session.activeOrganizationId!))
      );

    if (!vps) {
      return c.json({ error: "VPS instance not found" }, 404);
    }

    if (!vpsClient) {
      return c.json({ error: "VPS client not configured" }, 500);
    }

    try {
      const result = await vpsClient.reconcile(vps);

      await auditLog.logAction(
        session.activeOrganizationId!,
        user.id,
        "vps.reconcile",
        "vps",
        id,
        { name: vps.name }
      );

      return c.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to trigger reconciliation";
      return c.json({ error: message }, 502);
    }
  });

  return app;
}
