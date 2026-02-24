import { eq, and } from "drizzle-orm";
import { vpsInstances } from "@proxy-manager/db";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

/**
 * Load and validate a VPS instance from the database, scoped to the user's active organization.
 * Returns null if not found.
 */
export async function getVps(db: Database, vpsId: string, orgId: string) {
  const [vps] = await db
    .select()
    .from(vpsInstances)
    .where(and(eq(vpsInstances.id, vpsId), eq(vpsInstances.organizationId, orgId)));
  return vps ?? null;
}
