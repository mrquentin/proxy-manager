/**
 * Supported L4 match types.
 * Currently only SNI matching is used, but the type system supports future expansion
 * (e.g., protocol-based matching for SSH, RDP, etc.).
 */
export type L4MatchType = "sni";

/**
 * An L4 forwarding route managed by the VPS Caddy L4 proxy.
 * Each route matches incoming traffic (e.g., by TLS SNI) and forwards
 * the raw TCP stream to a WireGuard peer upstream without terminating TLS.
 */
export interface L4Route {
  /** Unique route identifier (e.g., "route_xyz789"). */
  id: string;

  /** The tunnel (WireGuard peer) this route forwards traffic to. */
  tunnelId: string;

  /** The port Caddy listens on for this route (typically 443). */
  listenPort: number;

  /** The type of match (e.g., "sni" for TLS SNI matching). */
  matchType: L4MatchType;

  /**
   * The match values. For SNI matching, this is an array of domain names
   * (e.g., ["app.example.com", "api.example.com"]).
   */
  matchValue: string[];

  /**
   * The upstream address where Caddy proxies matched traffic.
   * Derived from the tunnel's VPN IP and the upstream port
   * (e.g., "10.0.0.2:443").
   */
  upstream: string;

  /**
   * The Caddy @id used for stable addressing in the Caddy admin API.
   * Format: "route-{tunnel_id}-{port}" (e.g., "route-tun_abc123-443").
   */
  caddyId: string;

  /** Whether the route is active. Disabled routes are removed from Caddy by the reconciler. */
  enabled: boolean;

  /** ISO 8601 timestamp of when the route was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last update. */
  updatedAt: string;
}

/**
 * A single route match configuration within a Caddy L4 route.
 * Maps to the Caddy JSON structure under "match" in a route object.
 */
export interface RouteMatch {
  /** Match type. */
  type: L4MatchType;

  /**
   * Match values. For "sni", an array of domain names.
   */
  values: string[];
}
