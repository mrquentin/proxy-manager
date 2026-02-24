package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/proxy-manager/controlplane/internal/caddy"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
	qrcode "github.com/skip2/go-qrcode"
)

// sniRegex validates FQDN values used for SNI matching.
var sniRegex = regexp.MustCompile(`^(\*\.)?[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,252}[a-zA-Z0-9]$`)

// reservedPorts are management ports that cannot be used for tunnels or firewall rules.
var reservedPorts = map[int]bool{22: true, 2019: true, 7443: true, 51820: true}

// createTunnelRequest represents the request body for POST /api/v1/tunnels.
type createTunnelRequest struct {
	PublicKey    string   `json:"public_key,omitempty"`
	Domains      []string `json:"domains,omitempty"`
	UpstreamPort int      `json:"upstream_port,omitempty"`
}

func (s *Server) handleCreateTunnel(w http.ResponseWriter, r *http.Request) {
	var req createTunnelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// Validate domains
	for _, d := range req.Domains {
		if !sniRegex.MatchString(d) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid domain: %q", d))
			return
		}
	}

	// Validate upstream port
	if req.UpstreamPort == 0 {
		req.UpstreamPort = 443
	}
	if req.UpstreamPort < 1 || req.UpstreamPort > 65535 {
		writeError(w, http.StatusBadRequest, "upstream_port must be between 1 and 65535")
		return
	}
	if reservedPorts[req.UpstreamPort] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("port %d is reserved", req.UpstreamPort))
		return
	}

	// Validate public key if provided (Flow B)
	if req.PublicKey != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.PublicKey)
		if err != nil || len(decoded) != 32 {
			writeError(w, http.StatusBadRequest, "public_key must be valid base64 encoding of 32 bytes")
			return
		}
	}

	// Allocate VPN IP
	subnetPrefix := extractSubnetPrefix(s.cfg.WGServerIP)
	vpnIP, err := s.tunnelStore.AllocateIP(s.cfg.WGServerIP, subnetPrefix)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "no available VPN IP addresses")
		return
	}

	tunnelID := wireguard.GenerateRandomID("tun_")

	// Generate PSK
	psk, err := wireguard.GeneratePSK()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate PSK")
		return
	}

	var privateKey, publicKey string

	if req.PublicKey == "" {
		// Flow A: Server generates keypair
		priv, pub, err := wireguard.GenerateKeyPair()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate key pair")
			return
		}
		privateKey = priv
		publicKey = pub
	} else {
		// Flow B: User provided public key
		publicKey = req.PublicKey
	}

	// Add WireGuard peer
	if err := s.wgManager.AddPeer(publicKey, psk, vpnIP); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to add WireGuard peer: %v", err))
		return
	}

	// Persist tunnel to SQLite
	tunnel := &store.Tunnel{
		ID:                 tunnelID,
		PublicKey:           publicKey,
		VpnIP:              vpnIP,
		Domains:            req.Domains,
		Enabled:            true,
		AutoRevokeInactive: true,
		InactiveExpiryDays: 90,
		GracePeriodMinutes: 30,
	}
	if err := s.tunnelStore.Create(tunnel); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist tunnel: %v", err))
		return
	}

	// Add Caddy L4 routes for each domain
	if len(req.Domains) > 0 {
		upstream := fmt.Sprintf("%s:%d", vpnIP, req.UpstreamPort)
		caddyID := fmt.Sprintf("route-%s-%d", tunnelID, req.UpstreamPort)

		caddyRoute := caddy.BuildCaddyRoute(caddyID, req.Domains, upstream)

		// Ensure Caddy server exists
		_ = s.caddyClient.CreateServer(r.Context())

		if err := s.caddyClient.AddRoute(r.Context(), caddyRoute); err != nil {
			// Non-fatal: reconciler will fix this
			fmt.Printf("warning: failed to add caddy route: %v\n", err)
		}

		// Persist route to SQLite
		route := &store.Route{
			ID:         wireguard.GenerateRandomID("route_"),
			TunnelID:   tunnelID,
			ListenPort: 443,
			MatchType:  "sni",
			MatchValue: req.Domains,
			Upstream:   upstream,
			CaddyID:    caddyID,
			Enabled:    true,
		}
		if err := s.routeStore.Create(route); err != nil {
			fmt.Printf("warning: failed to persist route: %v\n", err)
		}
	}

	// Build response
	serverPubKey, _ := s.wgManager.GetServerPublicKey()

	if req.PublicKey == "" {
		// Flow A response: includes config
		config := buildWGConfig(privateKey, vpnIP, serverPubKey, psk, s.cfg.ServerEndpoint)

		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"id":                tunnelID,
			"vpn_ip":            vpnIP,
			"config":            config,
			"qr_code_url":       fmt.Sprintf("/api/v1/tunnels/%s/qr", tunnelID),
			"server_public_key": serverPubKey,
			"warning":           "Save this config now. The private key will not be available again.",
		})
	} else {
		// Flow B response
		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"id":                tunnelID,
			"vpn_ip":            vpnIP,
			"server_public_key": serverPubKey,
			"server_endpoint":   s.cfg.ServerEndpoint,
			"preshared_key":     psk,
		})
	}
}

func (s *Server) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	tunnels, err := s.tunnelStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list tunnels: %v", err))
		return
	}

	result := make([]map[string]interface{}, 0, len(tunnels))
	for _, t := range tunnels {
		connected := false
		if t.LastHandshake != nil {
			connected = time.Since(*t.LastHandshake) < 5*time.Minute
		}

		entry := map[string]interface{}{
			"id":                  t.ID,
			"public_key":          t.PublicKey,
			"vpn_ip":              t.VpnIP,
			"domains":             t.Domains,
			"enabled":             t.Enabled,
			"endpoint":            t.Endpoint,
			"last_handshake":      formatTimePtr(t.LastHandshake),
			"tx_bytes":            t.TxBytes,
			"rx_bytes":            t.RxBytes,
			"connected":           connected,
			"created_at":          t.CreatedAt.UTC().Format(time.RFC3339),
			"updated_at":          t.UpdatedAt.UTC().Format(time.RFC3339),
		}
		result = append(result, entry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": result})
}

func (s *Server) handleDeleteTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	tunnel, err := s.tunnelStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	// Remove WireGuard peer
	if err := s.wgManager.RemovePeer(tunnel.PublicKey); err != nil {
		// Log but continue — reconciler will clean up
		fmt.Printf("warning: failed to remove WG peer: %v\n", err)
	}

	// Delete associated Caddy routes
	routes, _ := s.routeStore.ListByTunnelID(id)
	for _, route := range routes {
		_ = s.caddyClient.DeleteRoute(r.Context(), route.CaddyID)
	}

	// Delete routes from DB
	_ = s.routeStore.DeleteByTunnelID(id)

	// Delete tunnel from DB
	if err := s.tunnelStore.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete tunnel: %v", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetTunnelConfig(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	tunnel, err := s.tunnelStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	// Config is only available for server-generated keys (Flow A).
	// We can't reconstruct the private key, so we return a template
	// that indicates the config was one-time only.
	serverPubKey, _ := s.wgManager.GetServerPublicKey()

	config := fmt.Sprintf(`[Interface]
PrivateKey = <your-private-key>
Address = %s/32
DNS = 1.1.1.1

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s/32
PersistentKeepalive = 25
`, tunnel.VpnIP, serverPubKey, s.cfg.ServerEndpoint, s.cfg.WGServerIP)

	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.conf", id))
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(config))
}

func (s *Server) handleGetTunnelQR(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	tunnel, err := s.tunnelStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	serverPubKey, _ := s.wgManager.GetServerPublicKey()

	config := fmt.Sprintf(`[Interface]
PrivateKey = <your-private-key>
Address = %s/32
DNS = 1.1.1.1

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = %s/32
PersistentKeepalive = 25
`, tunnel.VpnIP, serverPubKey, s.cfg.ServerEndpoint, s.cfg.WGServerIP)

	png, err := qrcode.Encode(config, qrcode.Medium, 512)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate QR code")
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.WriteHeader(http.StatusOK)
	w.Write(png)
}

func (s *Server) handleRotateTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	tunnel, err := s.tunnelStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	// Generate new keypair and PSK
	newPrivKey, newPubKey, err := wireguard.GenerateKeyPair()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate new key pair")
		return
	}

	newPSK, err := wireguard.GeneratePSK()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate new PSK")
		return
	}

	// Add new peer to WireGuard (same VPN IP, new keys)
	if err := s.wgManager.AddPeer(newPubKey, newPSK, tunnel.VpnIP); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to add new WG peer: %v", err))
		return
	}

	// Create new tunnel record for the rotated peer
	newTunnelID := wireguard.GenerateRandomID("tun_")
	newTunnel := &store.Tunnel{
		ID:                      newTunnelID,
		PublicKey:                newPubKey,
		VpnIP:                   tunnel.VpnIP + "_new", // Temporary, will share VPN IP after grace period
		Domains:                 tunnel.Domains,
		Enabled:                 true,
		AutoRotatePSK:           tunnel.AutoRotatePSK,
		PSKRotationIntervalDays: tunnel.PSKRotationIntervalDays,
		AutoRevokeInactive:      tunnel.AutoRevokeInactive,
		InactiveExpiryDays:      tunnel.InactiveExpiryDays,
		GracePeriodMinutes:      tunnel.GracePeriodMinutes,
	}

	// Mark the old tunnel as having a pending rotation
	if err := s.tunnelStore.SetPendingRotation(id, newTunnelID); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to set pending rotation: %v", err))
		return
	}

	// Build new config
	serverPubKey, _ := s.wgManager.GetServerPublicKey()
	config := buildWGConfig(newPrivKey, tunnel.VpnIP, serverPubKey, newPSK, s.cfg.ServerEndpoint)

	_ = newTunnel // Rotation creates a pending state, actual cutover happens after grace period

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config":               config,
		"qr_code_url":          fmt.Sprintf("/api/v1/tunnels/%s/qr", id),
		"grace_period_minutes": tunnel.GracePeriodMinutes,
		"warning":              fmt.Sprintf("Your tunnel will disconnect in %d minutes. Download and import this new config now.", tunnel.GracePeriodMinutes),
	})
}

func (s *Server) handleUpdateRotationPolicy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	var req struct {
		AutoRotatePSK           *bool `json:"auto_rotate_psk,omitempty"`
		PSKRotationIntervalDays *int  `json:"psk_rotation_interval_days,omitempty"`
		AutoRevokeInactive      *bool `json:"auto_revoke_inactive,omitempty"`
		InactiveExpiryDays      *int  `json:"inactive_expiry_days,omitempty"`
		GracePeriodMinutes      *int  `json:"grace_period_minutes,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// Validate interval days
	if req.PSKRotationIntervalDays != nil && *req.PSKRotationIntervalDays < 0 {
		writeError(w, http.StatusBadRequest, "psk_rotation_interval_days must be non-negative")
		return
	}
	if req.InactiveExpiryDays != nil && *req.InactiveExpiryDays < 1 {
		writeError(w, http.StatusBadRequest, "inactive_expiry_days must be at least 1")
		return
	}
	if req.GracePeriodMinutes != nil && *req.GracePeriodMinutes < 1 {
		writeError(w, http.StatusBadRequest, "grace_period_minutes must be at least 1")
		return
	}

	updated, err := s.tunnelStore.UpdateRotationPolicy(
		id, req.AutoRotatePSK, req.PSKRotationIntervalDays,
		req.AutoRevokeInactive, req.InactiveExpiryDays, req.GracePeriodMinutes,
	)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "tunnel not found")
		} else {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update rotation policy: %v", err))
		}
		return
	}

	// Calculate next rotation time
	var nextRotation *string
	if updated.AutoRotatePSK && updated.PSKRotationIntervalDays > 0 {
		var base time.Time
		if updated.LastRotationAt != nil {
			base = *updated.LastRotationAt
		} else {
			base = updated.CreatedAt
		}
		next := base.Add(time.Duration(updated.PSKRotationIntervalDays) * 24 * time.Hour)
		nextStr := next.UTC().Format(time.RFC3339)
		nextRotation = &nextStr
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tunnel_id":                   id,
		"auto_rotate_psk":             updated.AutoRotatePSK,
		"psk_rotation_interval_days":  updated.PSKRotationIntervalDays,
		"auto_revoke_inactive":        updated.AutoRevokeInactive,
		"inactive_expiry_days":        updated.InactiveExpiryDays,
		"grace_period_minutes":        updated.GracePeriodMinutes,
		"last_rotation_at":            formatTimePtr(updated.LastRotationAt),
		"next_rotation_at":            nextRotation,
	})
}

func (s *Server) handleGetRotationPolicy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "tunnel id is required")
		return
	}

	tunnel, err := s.tunnelStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	var nextRotation *string
	if tunnel.AutoRotatePSK && tunnel.PSKRotationIntervalDays > 0 {
		var base time.Time
		if tunnel.LastRotationAt != nil {
			base = *tunnel.LastRotationAt
		} else {
			base = tunnel.CreatedAt
		}
		next := base.Add(time.Duration(tunnel.PSKRotationIntervalDays) * 24 * time.Hour)
		nextStr := next.UTC().Format(time.RFC3339)
		nextRotation = &nextStr
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tunnel_id":                   id,
		"auto_rotate_psk":             tunnel.AutoRotatePSK,
		"psk_rotation_interval_days":  tunnel.PSKRotationIntervalDays,
		"auto_revoke_inactive":        tunnel.AutoRevokeInactive,
		"inactive_expiry_days":        tunnel.InactiveExpiryDays,
		"grace_period_minutes":        tunnel.GracePeriodMinutes,
		"last_rotation_at":            formatTimePtr(tunnel.LastRotationAt),
		"next_rotation_at":            nextRotation,
	})
}

// buildWGConfig creates a WireGuard client config file content.
func buildWGConfig(privateKey, vpnIP, serverPubKey, psk, serverEndpoint string) string {
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s/32
DNS = 1.1.1.1

[Peer]
PublicKey = %s
PresharedKey = %s
Endpoint = %s
AllowedIPs = 10.0.0.1/32
PersistentKeepalive = 25
`, privateKey, vpnIP, serverPubKey, psk, serverEndpoint)
}

// extractSubnetPrefix extracts the first 3 octets of an IP (e.g., "10.0.0" from "10.0.0.1").
func extractSubnetPrefix(ip string) string {
	parts := strings.Split(ip, ".")
	if len(parts) >= 3 {
		return strings.Join(parts[:3], ".")
	}
	return "10.0.0"
}

// formatTimePtr formats a *time.Time as RFC3339 or returns nil.
func formatTimePtr(t *time.Time) interface{} {
	if t == nil || t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
