/**
 * VPS instance status as tracked by the dashboard backend.
 * Updated by the background poller that calls each VPS control plane API.
 */
export type VpsStatus = "online" | "offline" | "unknown";

/**
 * A VPS instance registered in the dashboard.
 * Each VPS runs the Go control plane (Caddy L4 + WireGuard + nftables)
 * and is managed via mTLS from the Hono backend.
 */
export interface VpsInstance {
  /** Unique identifier (UUID). */
  id: string;

  /** ID of the organization that owns this VPS. */
  organizationId: string;

  /** Human-readable name (e.g., "EU-1 Frankfurt"). */
  name: string;

  /** Control plane API URL including port (e.g., "https://203.0.113.1:7443"). */
  apiUrl: string;

  /** PEM-encoded client certificate for mTLS authentication. */
  clientCert: string;

  /** Encrypted PEM-encoded client private key (encrypted at rest in SQLite). */
  encryptedClientKey: string;

  /** PEM-encoded CA certificate used to verify the VPS server certificate. */
  serverCa: string;

  /** Current connectivity status. */
  status: VpsStatus;

  /** Timestamp of the last successful health check. Null if never seen. */
  lastSeenAt: string | null;

  /** ISO 8601 timestamp of when this VPS was registered. */
  createdAt: string;
}

/**
 * Full status report returned by the VPS control plane GET /api/v1/status.
 * Consumed by the dashboard to display live VPS details.
 */
export interface VpsStatusReport {
  /** Tunnel/peer summary and per-peer details. */
  tunnels: {
    total: number;
    connected: number;
    peers: VpsPeerStatus[];
  };

  /** L4 route summary and details. */
  routes: {
    total: number;
    routes: VpsRouteInfo[];
  };

  /** Dynamic firewall rule summary and details. */
  firewall: {
    dynamicRules: number;
    rules: VpsFirewallRuleInfo[];
  };

  /** Reconciliation loop health. */
  reconciliation: VpsReconciliationStatus;
}

/**
 * Per-peer status as reported by the VPS control plane.
 */
export interface VpsPeerStatus {
  /** Tunnel identifier (e.g., "tun_abc123"). */
  id: string;

  /** Assigned VPN IP on the WireGuard interface (e.g., "10.0.0.2"). */
  vpnIp: string;

  /** ISO 8601 timestamp of the last successful WireGuard handshake. Null if never connected. */
  lastHandshake: string | null;

  /** Total bytes transmitted to the peer. */
  txBytes: number;

  /** Total bytes received from the peer. */
  rxBytes: number;

  /** True if the last handshake was within the last 5 minutes. */
  connected: boolean;
}

/**
 * L4 route info as reported by the VPS control plane.
 */
export interface VpsRouteInfo {
  /** Route identifier. */
  id: string;

  /** Associated tunnel ID. */
  tunnelId: string;

  /** Match type (currently always "sni"). */
  matchType: string;

  /** Matched values (domain names). */
  matchValue: string[];

  /** Upstream address (e.g., "10.0.0.2:443"). */
  upstream: string;

  /** Whether the route is active. */
  enabled: boolean;
}

/**
 * Dynamic firewall rule info as reported by the VPS control plane.
 */
export interface VpsFirewallRuleInfo {
  /** Rule identifier. */
  id: string;

  /** Port number (1-65535). */
  port: number;

  /** Protocol ("tcp" or "udp"). */
  proto: "tcp" | "udp";

  /** Source CIDR (e.g., "0.0.0.0/0"). */
  sourceCidr: string;

  /** Action ("allow" or "deny"). */
  action: "allow" | "deny";

  /** Whether the rule is active. */
  enabled: boolean;
}

/**
 * Reconciliation loop status from the VPS control plane.
 */
export interface VpsReconciliationStatus {
  /** Interval between reconciliation runs in seconds. */
  intervalSeconds: number;

  /** ISO 8601 timestamp of the last reconciliation run. Null if never run. */
  lastRunAt: string | null;

  /** Result of the last reconciliation run. */
  lastStatus: "ok" | "drift_corrected" | "error" | "pending";

  /** Error message from the last run, if any. */
  lastError: string | null;

  /** Cumulative count of drift corrections since the VPS booted. */
  driftCorrectionsTotal: number;
}
