import type {
  ApiResponse,
  ApiError,
  CreateVpsRequest,
  CreateVpsResponse,
  ListVpsResponse,
  GetVpsResponse,
  GetVpsStatusResponse,
  CreateTunnelRequest,
  CreateTunnelResponse,
  ListTunnelsResponse,
  RotateTunnelResponse,
  UpdateRotationPolicyRequest,
  UpdateRotationPolicyResponse,
  CreateRouteRequest,
  CreateRouteResponse,
  ListRoutesResponse,
  CreateFirewallRuleRequest,
  CreateFirewallRuleResponse,
  ListFirewallRulesResponse,
} from "@proxy-manager/shared";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 401) {
    const currentPath = window.location.pathname;
    if (currentPath !== "/login" && currentPath !== "/signup") {
      window.location.href = "/login";
    }
    throw new ApiClientError(401, "unauthorized", "Session expired");
  }

  if (!response.ok) {
    let errorData: ApiError = { error: "Unknown error" };
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: response.statusText };
    }
    throw new ApiClientError(
      response.status,
      errorData.code,
      errorData.error
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const apiClient = {
  // VPS
  listVps: () => request<ListVpsResponse>("/api/vps"),
  getVps: (id: string) => request<GetVpsResponse>(`/api/vps/${id}`),
  getVpsStatus: (id: string) =>
    request<GetVpsStatusResponse>(`/api/vps/${id}/status`),
  createVps: (data: CreateVpsRequest) =>
    request<CreateVpsResponse>("/api/vps", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteVps: (id: string) =>
    request<void>(`/api/vps/${id}`, { method: "DELETE" }),
  reconcileVps: (id: string) =>
    request<void>(`/api/vps/${id}/reconcile`, { method: "POST" }),

  // Tunnels
  listTunnels: (vpsId: string) =>
    request<ListTunnelsResponse>(`/api/vps/${vpsId}/tunnels`),
  createTunnel: (vpsId: string, data: CreateTunnelRequest) =>
    request<ApiResponse<CreateTunnelResponse>>(`/api/vps/${vpsId}/tunnels`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteTunnel: (vpsId: string, tunnelId: string) =>
    request<void>(`/api/vps/${vpsId}/tunnels/${tunnelId}`, {
      method: "DELETE",
    }),
  rotateTunnel: (vpsId: string, tunnelId: string) =>
    request<RotateTunnelResponse>(
      `/api/vps/${vpsId}/tunnels/${tunnelId}/rotate`,
      { method: "POST" }
    ),
  getRotationPolicy: (vpsId: string, tunnelId: string) =>
    request<UpdateRotationPolicyResponse>(
      `/api/vps/${vpsId}/tunnels/${tunnelId}/rotation-policy`
    ),
  updateRotationPolicy: (
    vpsId: string,
    tunnelId: string,
    data: UpdateRotationPolicyRequest
  ) =>
    request<UpdateRotationPolicyResponse>(
      `/api/vps/${vpsId}/tunnels/${tunnelId}/rotation-policy`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  // Routes
  listRoutes: (vpsId: string) =>
    request<ListRoutesResponse>(`/api/vps/${vpsId}/routes`),
  createRoute: (vpsId: string, data: CreateRouteRequest) =>
    request<CreateRouteResponse>(`/api/vps/${vpsId}/routes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteRoute: (vpsId: string, routeId: string) =>
    request<void>(`/api/vps/${vpsId}/routes/${routeId}`, {
      method: "DELETE",
    }),

  // Firewall
  listFirewallRules: (vpsId: string) =>
    request<ListFirewallRulesResponse>(`/api/vps/${vpsId}/firewall/rules`),
  createFirewallRule: (vpsId: string, data: CreateFirewallRuleRequest) =>
    request<CreateFirewallRuleResponse>(`/api/vps/${vpsId}/firewall/rules`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteFirewallRule: (vpsId: string, ruleId: string) =>
    request<void>(`/api/vps/${vpsId}/firewall/rules/${ruleId}`, {
      method: "DELETE",
    }),
};
