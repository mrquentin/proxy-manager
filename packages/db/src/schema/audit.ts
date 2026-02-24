import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organization } from "./auth";

/**
 * Dashboard audit log table.
 * Records every mutation (create, update, delete) performed through the dashboard.
 * Scoped to an organization for multi-tenant isolation.
 */
export const auditLog = sqliteTable("audit_log", {
  /** Auto-incrementing primary key. */
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The organization this audit entry belongs to. */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),

  /** The user who performed the action. */
  userId: text("user_id").notNull(),

  /**
   * The action performed, in "resource.verb" format.
   * Examples: "vps.create", "tunnel.delete", "firewall.create", "member.invite".
   */
  action: text("action").notNull(),

  /**
   * The type of resource acted upon.
   * Examples: "vps", "tunnel", "route", "firewall", "member".
   */
  resourceType: text("resource_type").notNull(),

  /** The ID of the specific resource acted upon. Null for list/bulk operations. */
  resourceId: text("resource_id"),

  /** JSON blob with additional request details (e.g., request body, IP address). */
  metadata: text("metadata"),

  /** Timestamp of when the action was performed. */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
