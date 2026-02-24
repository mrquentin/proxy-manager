import type { SseEvent } from "@proxy-manager/shared";

/**
 * Callback type for SSE event subscribers.
 */
export type SseCallback = (event: SseEvent) => void | Promise<void>;

/**
 * Subscriber entry tracking the callback and the organization the user belongs to.
 */
interface Subscriber {
  callback: SseCallback;
  orgId: string | null;
}

/**
 * In-memory pub/sub manager for SSE (Server-Sent Events).
 *
 * Manages subscriber registrations keyed by a unique subscriber ID (typically
 * a combination of userId and connection ID to support multiple tabs).
 *
 * Supports broadcasting to all subscribers, or scoped to an organization.
 */
export class SSEManager {
  private subscribers = new Map<string, Subscriber>();

  /**
   * Subscribe to SSE events.
   *
   * @param subscriberId - Unique subscriber identifier (e.g., `${userId}:${connectionId}`).
   * @param orgId - The organization ID to scope events to. Null if no org context.
   * @param callback - Function called when an event is broadcast.
   * @returns An unsubscribe function.
   */
  subscribe(subscriberId: string, orgId: string | null, callback: SseCallback): () => void {
    this.subscribers.set(subscriberId, { callback, orgId });

    return () => {
      this.subscribers.delete(subscriberId);
    };
  }

  /**
   * Remove a subscriber by ID.
   */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * Broadcast an event to ALL connected subscribers.
   */
  broadcast(event: SseEvent): void {
    for (const subscriber of this.subscribers.values()) {
      try {
        void subscriber.callback(event);
      } catch {
        // Ignore errors from individual subscribers — they may have disconnected.
      }
    }
  }

  /**
   * Broadcast an event only to subscribers whose active organization matches.
   *
   * @param orgId - The organization ID to scope the broadcast to.
   * @param event - The SSE event to broadcast.
   */
  broadcastToOrg(orgId: string, event: SseEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.orgId === orgId) {
        try {
          void subscriber.callback(event);
        } catch {
          // Ignore errors from individual subscribers.
        }
      }
    }
  }

  /**
   * Get the number of active subscribers.
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Remove all subscribers. Used for cleanup in tests.
   */
  clear(): void {
    this.subscribers.clear();
  }
}
