import { eq } from "drizzle-orm";
import { vpsInstances } from "@proxy-manager/db";
import type { VpsClient } from "../lib/vps-client";
import type { SSEManager } from "./sse-manager";
import type { VpsStatusEvent } from "@proxy-manager/shared";

type Database = ReturnType<typeof import("@proxy-manager/db").createDatabase>;

/** Default polling interval: 60 seconds. */
const DEFAULT_POLL_INTERVAL = 60_000;

/**
 * Background VPS health poller.
 *
 * Periodically queries each registered VPS instance's /api/v1/status endpoint
 * to determine connectivity. Updates the database with the latest status and
 * broadcasts SSE events to connected dashboard clients.
 */
export class VpsPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly vpsClient: VpsClient,
    private readonly sseManager: SSEManager,
    private readonly intervalMs: number = DEFAULT_POLL_INTERVAL
  ) {}

  /**
   * Start the background polling loop.
   */
  start(): void {
    if (this.timer) {
      return; // Already started
    }

    console.log(`[vps-poller] Starting with interval ${this.intervalMs}ms`);

    // Run immediately on start, then on interval
    void this.poll();

    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);

    // Prevent the timer from keeping the process alive during shutdown
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the background polling loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[vps-poller] Stopped");
    }
  }

  /**
   * Execute a single poll cycle across all VPS instances.
   */
  async poll(): Promise<void> {
    if (this.running) {
      return; // Skip if a previous poll is still running
    }

    this.running = true;

    try {
      const instances = await this.db.select().from(vpsInstances);

      for (const vps of instances) {
        await this.checkInstance(vps);
      }
    } catch (error) {
      console.error("[vps-poller] Error during poll cycle:", error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Check a single VPS instance's health.
   */
  private async checkInstance(vps: typeof vpsInstances.$inferSelect): Promise<void> {
    const previousStatus = vps.status;

    try {
      await this.vpsClient.getStatus(vps);

      // VPS responded successfully — mark as online
      await this.db
        .update(vpsInstances)
        .set({ status: "online", lastSeenAt: new Date() })
        .where(eq(vpsInstances.id, vps.id));

      if (previousStatus !== "online") {
        const event: VpsStatusEvent = {
          type: "vps:status",
          vpsId: vps.id,
          status: "online",
        };
        this.sseManager.broadcastToOrg(vps.organizationId, event);
      }
    } catch {
      // VPS did not respond — mark as offline
      await this.db
        .update(vpsInstances)
        .set({ status: "offline" })
        .where(eq(vpsInstances.id, vps.id));

      if (previousStatus !== "offline") {
        const event: VpsStatusEvent = {
          type: "vps:status",
          vpsId: vps.id,
          status: "offline",
        };
        this.sseManager.broadcastToOrg(vps.organizationId, event);
      }
    }
  }
}
