import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organization } from "./auth";

/**
 * VPS instances table.
 * Each VPS runs the Go control plane and is managed via mTLS from the Hono backend.
 * Scoped to an organization — all queries filter by organizationId.
 */
export const vpsInstances = sqliteTable("vps_instances", {
  /** Unique identifier (UUID). */
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  /** The organization that owns this VPS instance. */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),

  /** Human-readable name (e.g., "EU-1 Frankfurt"). */
  name: text("name").notNull(),

  /** Control plane API URL including port (e.g., "https://203.0.113.1:7443"). */
  apiUrl: text("api_url").notNull(),

  /** Encrypted PEM-encoded client private key for mTLS (encrypted at rest). */
  encryptedClientKey: text("encrypted_client_key").notNull(),

  /** PEM-encoded client certificate for mTLS authentication. */
  clientCert: text("client_cert").notNull(),

  /** PEM-encoded CA certificate for verifying the VPS server certificate. */
  serverCa: text("server_ca").notNull(),

  /** Current connectivity status as determined by the background poller. */
  status: text("status", { enum: ["online", "offline", "unknown"] })
    .notNull()
    .default("unknown"),

  /** Timestamp of the last successful health check. Null if never seen. */
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),

  /** Timestamp of when this VPS was registered. */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
