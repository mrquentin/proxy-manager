import type { VpsInstance, VpsStatus, VpsStatusReport } from "./vps";
import type { Tunnel, TunnelConfig, RotationPolicy } from "./tunnel";
import type { L4Route, L4MatchType, L4Protocol } from "./route";
import type {
  FirewallRule,
  FirewallProtocol,
  FirewallAction,
} from "./firewall";

// =============================================================================
// Generic API envelope
// =============================================================================

/** Standard success response wrapper. */
export interface ApiResponse<T> {
  data: T;
}

/** Standard error response. */
export interface ApiError {
  error: string;
  /** Optional machine-readable error code. */
  code?: string;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// VPS Instance endpoints (dashboard backend)
// =============================================================================

/** POST /api/vps — Register a new VPS instance in the dashboard. */
export interface CreateVpsRequest {
  /** Human-readable name for the VPS (e.g., "EU-1 Frankfurt"). */
  name: string;

  /** Control plane API URL including port (e.g., "https://203.0.113.1:7443"). */
  apiUrl: string;

  /** PEM-encoded client certificate for mTLS authentication. */
  clientCert: string;

  /** PEM-encoded client private key for mTLS authentication (will be encrypted at rest). */
  clientKey: string;

  /** PEM-encoded CA certificate for verifying the VPS server certificate. */
  serverCa: string;
}

/** Response after creating a VPS instance. */
export interface CreateVpsResponse {
  /** The created VPS instance (clientKey is not returned). */
  data: VpsInstance;
}

/** PATCH /api/vps/:id — Update a VPS instance. */
export interface UpdateVpsRequest {
  /** Updated human-readable name. */
  name?: string;

  /** Updated control plane API URL. */
  apiUrl?: string;

  /** Updated PEM-encoded client certificate. */
  clientCert?: string;

  /** Updated PEM-encoded client private key. */
  clientKey?: string;

  /** Updated PEM-encoded CA certificate. */
  serverCa?: string;
}

/** GET /api/vps — List VPS instances (scoped to active organization). */
export interface ListVpsResponse {
  data: VpsInstance[];
}

/** GET /api/vps/:id — Single VPS instance detail. */
export interface GetVpsResponse {
  data: VpsInstance;
}

/** GET /api/vps/:id/status — Full VPS status report from the control plane. */
export interface GetVpsStatusResponse {
  data: VpsStatusReport;
}

// =============================================================================
// Tunnel endpoints (proxied to VPS control plane via dashboard backend)
// =============================================================================

/**
 * POST /api/vps/:vpsId/tunnels — Create a new WireGuard tunnel.
 *
 * Two flows are supported:
 * - Omit publicKey: server generates a keypair, returns a full .conf file (Flow A).
 * - Provide publicKey: user generated keys client-side, server returns connection info (Flow B).
 */
export interface CreateTunnelRequest {
  /**
   * User-provided WireGuard public key (Flow B).
   * If omitted, the VPS control plane generates a keypair (Flow A).
   */
  publicKey?: string;

  /** Domains to associate with this tunnel for L4 routing. */
  domains?: string[];

  /** Default upstream port for L4 routes (defaults to 443). */
  upstreamPort?: number;
}

/**
 * Response for server-generated keys (Flow A).
 * The private key is included in configText and is shown once only.
 */
export interface CreateTunnelResponseFlowA {
  /** Tunnel identifier. */
  id: string;

  /** Assigned VPN IP. */
  vpnIp: string;

  /** Full WireGuard .conf file contents (includes private key — show once). */
  config: string;

  /** URL to fetch the QR code PNG. */
  qrCodeUrl: string;

  /** VPS WireGuard server public key. */
  serverPublicKey: string;

  /** Warning to display about saving the config. */
  warning: string;
}

/**
 * Response for user-provided keys (Flow B).
 * No private key is involved server-side.
 */
export interface CreateTunnelResponseFlowB {
  /** Tunnel identifier. */
  id: string;

  /** Assigned VPN IP. */
  vpnIp: string;

  /** VPS WireGuard server public key. */
  serverPublicKey: string;

  /** VPS public endpoint for the WireGuard connection (e.g., "203.0.113.1:51820"). */
  serverEndpoint: string;

  /** Pre-shared key (shown once). */
  presharedKey: string;
}

/** Union of both tunnel creation response types. */
export type CreateTunnelResponse =
  | CreateTunnelResponseFlowA
  | CreateTunnelResponseFlowB;

/** GET /api/vps/:vpsId/tunnels — List all tunnels on a VPS. */
export interface ListTunnelsResponse {
  data: Tunnel[];
}

/** GET /api/vps/:vpsId/tunnels/:tunnelId — Single tunnel detail. */
export interface GetTunnelResponse {
  data: Tunnel;
}

/** POST /api/vps/:vpsId/tunnels/:tunnelId/rotate — Rotate tunnel keys. */
export interface RotateTunnelResponse {
  /** New config text to download. */
  config: string;

  /** URL to fetch the new QR code PNG. */
  qrCodeUrl: string;

  /** Minutes until the old config is revoked. */
  gracePeriodMinutes: number;

  /** Warning to display about the rotation. */
  warning: string;
}

/** PATCH /api/vps/:vpsId/tunnels/:tunnelId/rotation-policy — Update rotation policy. */
export interface UpdateRotationPolicyRequest {
  /** Enable/disable automatic PSK rotation. */
  autoRotatePsk?: boolean;

  /** Days between automatic PSK rotations. */
  pskRotationIntervalDays?: number;

  /** Enable/disable automatic revocation of inactive peers. */
  autoRevokeInactive?: boolean;

  /** Days of inactivity before auto-revoke. */
  inactiveExpiryDays?: number;

  /** Minutes to keep old config valid after rotation. */
  gracePeriodMinutes?: number;
}

/** Response after updating rotation policy. */
export interface UpdateRotationPolicyResponse {
  /** Tunnel identifier. */
  tunnelId: string;

  /** Current rotation policy values. */
  autoRotatePsk: boolean;
  pskRotationIntervalDays: number;
  autoRevokeInactive: boolean;
  inactiveExpiryDays: number;
  gracePeriodMinutes: number;

  /** ISO 8601 timestamp of the last rotation. Null if never rotated. */
  lastRotationAt: string | null;

  /** ISO 8601 timestamp of the next scheduled rotation. Null if auto-rotate is off. */
  nextRotationAt: string | null;
}

// =============================================================================
// L4 Route endpoints (proxied to VPS control plane via dashboard backend)
// =============================================================================

/** POST /api/vps/:vpsId/routes — Add an L4 forwarding route. */
export interface CreateRouteRequest {
  /** The tunnel (WireGuard peer) to forward traffic to. */
  tunnelId: string;

  /** Match type: "sni" for domain-based, "port_forward" for raw port forwarding. */
  matchType: L4MatchType;

  /** Match values (e.g., domain names for SNI matching). Ignored for port_forward. */
  matchValue: string[];

  /** Upstream port on the peer (e.g., 443, 8080). */
  upstreamPort: number;

  /** Protocol for port_forward routes: "tcp" or "udp". Defaults to "tcp". */
  protocol?: L4Protocol;

  /** Listen port for port_forward routes. Required when matchType is "port_forward". */
  listenPort?: number;
}

/** Response after creating an L4 route. */
export interface CreateRouteResponse {
  data: L4Route;
}

/** GET /api/vps/:vpsId/routes — List all L4 routes on a VPS. */
export interface ListRoutesResponse {
  data: L4Route[];
}

/** GET /api/vps/:vpsId/routes/:routeId — Single route detail. */
export interface GetRouteResponse {
  data: L4Route;
}

// =============================================================================
// Firewall Rule endpoints (proxied to VPS control plane via dashboard backend)
// =============================================================================

/** POST /api/vps/:vpsId/firewall/rules — Add a dynamic firewall rule. */
export interface CreateFirewallRuleRequest {
  /** Port number (1-65535). Reserved ports (22, 2019, 7443, 51820) are rejected. */
  port: number;

  /** Network protocol. */
  proto: FirewallProtocol;

  /** Source CIDR for filtering (e.g., "0.0.0.0/0" for any). */
  sourceCidr?: string;

  /** Action to take on matching traffic. Defaults to "allow". */
  action?: FirewallAction;
}

/** Response after creating a firewall rule. */
export interface CreateFirewallRuleResponse {
  data: FirewallRule;
}

/** GET /api/vps/:vpsId/firewall/rules — List all dynamic firewall rules. */
export interface ListFirewallRulesResponse {
  data: FirewallRule[];
}

/** GET /api/vps/:vpsId/firewall/rules/:ruleId — Single rule detail. */
export interface GetFirewallRuleResponse {
  data: FirewallRule;
}

// =============================================================================
// SSE Event types (pushed from Hono backend to connected dashboards)
// =============================================================================

/** Base shape for all SSE events. */
export interface SseEventBase {
  type: string;
}

/** VPS connectivity status change. */
export interface VpsStatusEvent extends SseEventBase {
  type: "vps:status";
  vpsId: string;
  status: VpsStatus;
}

/** Tunnel peer connection state change. */
export interface TunnelConnectedEvent extends SseEventBase {
  type: "tunnel:connected";
  vpsId: string;
  tunnelId: string;
}

/** Tunnel peer disconnection state change. */
export interface TunnelDisconnectedEvent extends SseEventBase {
  type: "tunnel:disconnected";
  vpsId: string;
  tunnelId: string;
}

/** Reconciliation drift detected and corrected on a VPS. */
export interface ReconciliationDriftEvent extends SseEventBase {
  type: "reconciliation:drift";
  vpsId: string;
  caddyOps: number;
  wgOps: number;
  fwOps: number;
}

/** L4 route added (from another session or background process). */
export interface RouteAddedEvent extends SseEventBase {
  type: "route:added";
  vpsId: string;
  routeId: string;
}

/** L4 route removed. */
export interface RouteRemovedEvent extends SseEventBase {
  type: "route:removed";
  vpsId: string;
  routeId: string;
}

/** Tunnel rotation pending — user needs to download new config. */
export interface TunnelRotationPendingEvent extends SseEventBase {
  type: "tunnel:rotation_pending";
  vpsId: string;
  tunnelId: string;
}

/** Tunnel revoked due to inactivity. */
export interface TunnelRevokedInactiveEvent extends SseEventBase {
  type: "tunnel:revoked_inactive";
  vpsId: string;
  tunnelId: string;
}

/** Union of all SSE event types. */
export type SseEvent =
  | VpsStatusEvent
  | TunnelConnectedEvent
  | TunnelDisconnectedEvent
  | ReconciliationDriftEvent
  | RouteAddedEvent
  | RouteRemovedEvent
  | TunnelRotationPendingEvent
  | TunnelRevokedInactiveEvent;
