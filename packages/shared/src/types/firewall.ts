/**
 * Network protocol for firewall rules.
 */
export type FirewallProtocol = "tcp" | "udp";

/**
 * Traffic direction for firewall rules.
 */
export type FirewallDirection = "in" | "out";

/**
 * Firewall rule action.
 */
export type FirewallAction = "allow" | "deny";

/**
 * A dynamic firewall rule managed by the VPS control plane.
 * These rules live in a dedicated nftables chain ("dynamic-api-rules")
 * that is separate from the UFW static baseline. The reconciliation loop
 * ensures nftables state matches the SQLite source of truth.
 */
export interface FirewallRule {
  /** Unique rule identifier (e.g., "fw_rule_001"). */
  id: string;

  /** Port number (1-65535). Reserved management ports (22, 2019, 7443, 51820) are rejected. */
  port: number;

  /** Network protocol. */
  proto: FirewallProtocol;

  /** Traffic direction. */
  direction: FirewallDirection;

  /**
   * Source CIDR for ingress filtering (e.g., "0.0.0.0/0" for any source,
   * "192.168.1.0/24" for a specific subnet).
   */
  sourceCidr: string;

  /** Whether to allow or deny matching traffic. */
  action: FirewallAction;

  /** Whether the rule is active. Disabled rules are removed from nftables by the reconciler. */
  enabled: boolean;

  /** ISO 8601 timestamp of when the rule was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last update. */
  updatedAt: string;
}
