import { decrypt } from "./crypto";

/**
 * Represents a VPS record from the database with the fields needed for API calls.
 */
export interface VpsRecord {
  id: string;
  apiUrl: string;
  clientCert: string;
  encryptedClientKey: string;
  serverCa: string;
}

/**
 * Error thrown when a VPS API call fails.
 */
export class VpsApiError extends Error {
  constructor(
    public readonly vpsId: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(`VPS API error (vps=${vpsId}, status=${statusCode}): ${responseBody}`);
    this.name = "VpsApiError";
  }
}

/**
 * Options for VPS API requests.
 */
interface VpsRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Make an authenticated mTLS HTTP request to a VPS control plane API.
 *
 * Uses Bun's native TLS support in fetch() to pass client certificates.
 *
 * @param vps - VPS record containing connection details and encrypted credentials.
 * @param endpoint - API endpoint path (e.g., "/api/v1/status").
 * @param encryptionKey - Hex encryption key used to decrypt the client private key.
 * @param options - Request options (method, body, headers).
 * @returns The parsed JSON response.
 */
export async function callVpsApi(
  vps: VpsRecord,
  endpoint: string,
  encryptionKey: string,
  options?: VpsRequestOptions
): Promise<unknown> {
  const clientKey = await decrypt(vps.encryptedClientKey, encryptionKey);

  const url = `${vps.apiUrl}${endpoint}`;
  const method = options?.method ?? "GET";

  const fetchOptions: RequestInit & { tls?: Record<string, string> } = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    tls: {
      cert: vps.clientCert,
      key: clientKey,
      ca: vps.serverCa,
    },
  };

  if (options?.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions as RequestInit);

  if (!response.ok) {
    const text = await response.text();
    throw new VpsApiError(vps.id, response.status, text);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  // For non-JSON responses (e.g., QR code PNG, config text), return the response directly
  return response;
}

/**
 * High-level VPS API client that wraps callVpsApi with typed methods for each endpoint.
 */
export class VpsClient {
  constructor(private readonly encryptionKey: string) {}

  /** GET /api/v1/status — Full VPS status report. */
  async getStatus(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/status", this.encryptionKey);
  }

  /** GET /api/v1/server/pubkey — VPS WireGuard public key. */
  async getServerPubkey(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/server/pubkey", this.encryptionKey);
  }

  /** POST /api/v1/reconcile — Force immediate reconciliation. */
  async reconcile(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/reconcile", this.encryptionKey, { method: "POST" });
  }

  // --- Tunnel endpoints ---

  /** POST /api/v1/tunnels — Create a new tunnel. */
  async createTunnel(vps: VpsRecord, body: unknown): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/tunnels", this.encryptionKey, { method: "POST", body });
  }

  /** GET /api/v1/tunnels — List all tunnels. */
  async listTunnels(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/tunnels", this.encryptionKey);
  }

  /** DELETE /api/v1/tunnels/:id — Delete a tunnel. */
  async deleteTunnel(vps: VpsRecord, tunnelId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}`, this.encryptionKey, { method: "DELETE" });
  }

  /** GET /api/v1/tunnels/:id/config — Download tunnel config. */
  async getTunnelConfig(vps: VpsRecord, tunnelId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}/config`, this.encryptionKey);
  }

  /** GET /api/v1/tunnels/:id/qr — Get tunnel QR code. */
  async getTunnelQr(vps: VpsRecord, tunnelId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}/qr`, this.encryptionKey);
  }

  /** POST /api/v1/tunnels/:id/rotate — Rotate tunnel keys. */
  async rotateTunnel(vps: VpsRecord, tunnelId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}/rotate`, this.encryptionKey, {
      method: "POST",
    });
  }

  /** GET /api/v1/tunnels/:id/rotation-policy — Get rotation policy. */
  async getRotationPolicy(vps: VpsRecord, tunnelId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}/rotation-policy`, this.encryptionKey);
  }

  /** PATCH /api/v1/tunnels/:id/rotation-policy — Update rotation policy. */
  async updateRotationPolicy(vps: VpsRecord, tunnelId: string, body: unknown): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/tunnels/${tunnelId}/rotation-policy`, this.encryptionKey, {
      method: "PATCH",
      body,
    });
  }

  // --- Route endpoints ---

  /** POST /api/v1/routes — Create an L4 route. */
  async createRoute(vps: VpsRecord, body: unknown): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/routes", this.encryptionKey, { method: "POST", body });
  }

  /** GET /api/v1/routes — List all L4 routes. */
  async listRoutes(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/routes", this.encryptionKey);
  }

  /** DELETE /api/v1/routes/:id — Delete an L4 route. */
  async deleteRoute(vps: VpsRecord, routeId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/routes/${routeId}`, this.encryptionKey, { method: "DELETE" });
  }

  // --- Firewall endpoints ---

  /** POST /api/v1/firewall/rules — Create a firewall rule. */
  async createFirewallRule(vps: VpsRecord, body: unknown): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/firewall/rules", this.encryptionKey, { method: "POST", body });
  }

  /** GET /api/v1/firewall/rules — List all firewall rules. */
  async listFirewallRules(vps: VpsRecord): Promise<unknown> {
    return callVpsApi(vps, "/api/v1/firewall/rules", this.encryptionKey);
  }

  /** DELETE /api/v1/firewall/rules/:id — Delete a firewall rule. */
  async deleteFirewallRule(vps: VpsRecord, ruleId: string): Promise<unknown> {
    return callVpsApi(vps, `/api/v1/firewall/rules/${ruleId}`, this.encryptionKey, {
      method: "DELETE",
    });
  }
}
