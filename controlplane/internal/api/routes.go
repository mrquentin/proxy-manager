package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

type createRouteRequest struct {
	TunnelID     string   `json:"tunnel_id"`
	MatchType    string   `json:"match_type"`    // "sni" or "port_forward"
	MatchValue   []string `json:"match_value"`   // required for sni, ignored for port_forward
	UpstreamPort int      `json:"upstream_port"`
	Protocol     string   `json:"protocol"`      // "tcp" or "udp" (port_forward only, defaults to "tcp")
	ListenPort   int      `json:"listen_port"`   // required for port_forward
}

func (s *Server) handleCreateRoute(w http.ResponseWriter, r *http.Request) {
	var req createRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// Validate tunnel exists
	tunnel, err := s.tunnelStore.Get(req.TunnelID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "tunnel not found")
		return
	}

	// Validate upstream is in the WireGuard subnet
	if !strings.HasPrefix(tunnel.VpnIP, extractSubnetPrefix(s.cfg.WGServerIP)) {
		writeError(w, http.StatusBadRequest, "upstream must be within the WireGuard subnet")
		return
	}

	// Validate upstream port
	if req.UpstreamPort < 1 || req.UpstreamPort > 65535 {
		writeError(w, http.StatusBadRequest, "upstream_port must be between 1 and 65535")
		return
	}
	if reservedPorts[req.UpstreamPort] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("port %d is reserved", req.UpstreamPort))
		return
	}

	// Default protocol
	if req.Protocol == "" {
		req.Protocol = "tcp"
	}
	if req.Protocol != "tcp" && req.Protocol != "udp" {
		writeError(w, http.StatusBadRequest, "protocol must be 'tcp' or 'udp'")
		return
	}

	var (
		routeID    string
		caddyID    string
		listenPort int
		upstream   string
	)

	switch req.MatchType {
	case "sni":
		// Validate match values
		if len(req.MatchValue) == 0 {
			writeError(w, http.StatusBadRequest, "match_value must have at least one entry")
			return
		}
		for _, v := range req.MatchValue {
			if !sniRegex.MatchString(v) {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid SNI value: %q", v))
				return
			}
		}

		listenPort = 443
		upstream = fmt.Sprintf("%s:%d", tunnel.VpnIP, req.UpstreamPort)
		routeID = wireguard.GenerateRandomID("route_")
		caddyID = fmt.Sprintf("route-%s-%d", req.TunnelID, req.UpstreamPort)

		// Add to Caddy SNI server
		caddyRoute := caddy.BuildCaddyRoute(caddyID, req.MatchValue, upstream)
		_ = s.caddyClient.CreateServer(r.Context())
		if err := s.caddyClient.AddRoute(r.Context(), caddyRoute); err != nil {
			fmt.Printf("warning: failed to add caddy route: %v\n", err)
		}

	case "port_forward":
		// Validate listen port
		if req.ListenPort < 1 || req.ListenPort > 65535 {
			writeError(w, http.StatusBadRequest, "listen_port must be between 1 and 65535")
			return
		}
		if reservedPorts[req.ListenPort] {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("port %d is reserved", req.ListenPort))
			return
		}

		// Check for port conflict
		existing, err := s.routeStore.FindByPortAndProtocol(req.ListenPort, req.Protocol)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check port conflict")
			return
		}
		if existing != nil {
			writeError(w, http.StatusConflict, fmt.Sprintf("port %d/%s is already in use by route %s", req.ListenPort, req.Protocol, existing.ID))
			return
		}

		listenPort = req.ListenPort
		upstream = caddy.FormatUpstream(tunnel.VpnIP, req.UpstreamPort, req.Protocol)
		routeID = wireguard.GenerateRandomID("route_")
		caddyID = fmt.Sprintf("pf-%s", routeID)

		// Create dedicated Caddy server
		serverName := caddy.PortForwardServerName(req.ListenPort, req.Protocol)
		listenAddr := caddy.FormatListenAddr(req.ListenPort, req.Protocol)
		if err := s.caddyClient.CreatePortForwardServer(r.Context(), serverName, listenAddr, upstream, caddyID); err != nil {
			fmt.Printf("warning: failed to create caddy port-forward server: %v\n", err)
		}

	default:
		writeError(w, http.StatusBadRequest, "match_type must be 'sni' or 'port_forward'")
		return
	}

	// Persist to SQLite
	route := &store.Route{
		ID:         routeID,
		TunnelID:   req.TunnelID,
		ListenPort: listenPort,
		Protocol:   req.Protocol,
		MatchType:  req.MatchType,
		MatchValue: req.MatchValue,
		Upstream:   upstream,
		CaddyID:    caddyID,
		Enabled:    true,
	}
	if route.MatchValue == nil {
		route.MatchValue = []string{}
	}
	if err := s.routeStore.Create(route); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist route: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"data": map[string]interface{}{
			"id":          routeID,
			"tunnel_id":   req.TunnelID,
			"listen_port": listenPort,
			"protocol":    req.Protocol,
			"match_type":  req.MatchType,
			"match_value": route.MatchValue,
			"upstream":    upstream,
			"caddy_id":    caddyID,
			"enabled":     true,
			"status":      "active",
			"created_at":  route.CreatedAt.UTC().Format(time.RFC3339),
			"updated_at":  route.UpdatedAt.UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleListRoutes(w http.ResponseWriter, r *http.Request) {
	routes, err := s.routeStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list routes: %v", err))
		return
	}

	result := make([]map[string]interface{}, 0, len(routes))
	for _, route := range routes {
		entry := map[string]interface{}{
			"id":          route.ID,
			"tunnel_id":   route.TunnelID,
			"listen_port": route.ListenPort,
			"protocol":    route.Protocol,
			"match_type":  route.MatchType,
			"match_value": route.MatchValue,
			"upstream":    route.Upstream,
			"caddy_id":    route.CaddyID,
			"enabled":     route.Enabled,
			"created_at":  route.CreatedAt.UTC().Format(time.RFC3339),
			"updated_at":  route.UpdatedAt.UTC().Format(time.RFC3339),
		}
		result = append(result, entry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": result})
}

func (s *Server) handleDeleteRoute(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "route id is required")
		return
	}

	route, err := s.routeStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	// Remove from Caddy
	if route.MatchType == "port_forward" {
		serverName := caddy.PortForwardServerName(route.ListenPort, route.Protocol)
		if err := s.caddyClient.DeleteServer(context.Background(), serverName); err != nil {
			fmt.Printf("warning: failed to delete caddy port-forward server: %v\n", err)
		}
	} else {
		if err := s.caddyClient.DeleteRoute(context.Background(), route.CaddyID); err != nil {
			fmt.Printf("warning: failed to delete caddy route: %v\n", err)
		}
	}

	// Delete from DB
	if err := s.routeStore.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete route: %v", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
