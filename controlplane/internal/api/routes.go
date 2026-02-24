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
	MatchType    string   `json:"match_type"`
	MatchValue   []string `json:"match_value"`
	UpstreamPort int      `json:"upstream_port"`
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

	// Validate match type
	if req.MatchType != "sni" {
		writeError(w, http.StatusBadRequest, "match_type must be 'sni'")
		return
	}

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

	// Validate upstream port
	if req.UpstreamPort < 1 || req.UpstreamPort > 65535 {
		writeError(w, http.StatusBadRequest, "upstream_port must be between 1 and 65535")
		return
	}
	if reservedPorts[req.UpstreamPort] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("port %d is reserved", req.UpstreamPort))
		return
	}

	// Build upstream from tunnel VPN IP + port
	upstream := fmt.Sprintf("%s:%d", tunnel.VpnIP, req.UpstreamPort)

	// Validate upstream is in the WireGuard subnet
	if !strings.HasPrefix(tunnel.VpnIP, extractSubnetPrefix(s.cfg.WGServerIP)) {
		writeError(w, http.StatusBadRequest, "upstream must be within the WireGuard subnet")
		return
	}

	routeID := wireguard.GenerateRandomID("route_")
	caddyID := fmt.Sprintf("route-%s-%d", req.TunnelID, req.UpstreamPort)

	// Add to Caddy
	caddyRoute := caddy.BuildCaddyRoute(caddyID, req.MatchValue, upstream)
	_ = s.caddyClient.CreateServer(r.Context())
	if err := s.caddyClient.AddRoute(r.Context(), caddyRoute); err != nil {
		// Non-fatal, reconciler will fix
		fmt.Printf("warning: failed to add caddy route: %v\n", err)
	}

	// Persist to SQLite
	route := &store.Route{
		ID:         routeID,
		TunnelID:   req.TunnelID,
		ListenPort: 443,
		MatchType:  req.MatchType,
		MatchValue: req.MatchValue,
		Upstream:   upstream,
		CaddyID:    caddyID,
		Enabled:    true,
	}
	if err := s.routeStore.Create(route); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist route: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"data": map[string]interface{}{
			"id":          routeID,
			"tunnel_id":   req.TunnelID,
			"match_type":  req.MatchType,
			"match_value": req.MatchValue,
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
	if err := s.caddyClient.DeleteRoute(context.Background(), route.CaddyID); err != nil {
		// Non-fatal
		fmt.Printf("warning: failed to delete caddy route: %v\n", err)
	}

	// Delete from DB
	if err := s.routeStore.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete route: %v", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
