import { auditLog } from "@proxy-manager/db";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

/**
 * Audit log service that writes mutation records to the audit_log table.
 *
 * Every destructive or state-changing action through the dashboard is recorded
 * with the user, organization, resource, and action details.
 */
export class AuditLogService {
  constructor(private readonly db: Database) {}

  /**
   * Record an action in the audit log.
   *
   * @param orgId - The organization ID the action was performed in.
   * @param userId - The user who performed the action.
   * @param action - The action in "resource.verb" format (e.g., "vps.create").
   * @param resourceType - The type of resource (e.g., "vps", "tunnel").
   * @param resourceId - The ID of the specific resource. Null for list/bulk operations.
   * @param metadata - Optional metadata object (serialized as JSON).
   */
  async logAction(
    orgId: string,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | null = null,
    metadata: Record<string, unknown> | null = null
  ): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        organizationId: orgId,
        userId,
        action,
        resourceType,
        resourceId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
    } catch (error) {
      // Log the error but do not fail the main request.
      // Audit logging should never break the user's workflow.
      console.error("[audit-log] Failed to write audit log entry:", error);
    }
  }
}
