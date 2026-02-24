package api

import (
	"fmt"
	"net/http"
	"time"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	// Tunnels
	tunnels, err := s.tunnelStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list tunnels: %v", err))
		return
	}

	connectedCount := 0
	peers := make([]map[string]interface{}, 0, len(tunnels))
	for _, t := range tunnels {
		connected := false
		if t.LastHandshake != nil && time.Since(*t.LastHandshake) < 5*time.Minute {
			connected = true
			connectedCount++
		}
		peers = append(peers, map[string]interface{}{
			"id":             t.ID,
			"vpn_ip":         t.VpnIP,
			"last_handshake": formatTimePtr(t.LastHandshake),
			"tx_bytes":       t.TxBytes,
			"rx_bytes":       t.RxBytes,
			"connected":      connected,
		})
	}

	// Routes
	routes, err := s.routeStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list routes: %v", err))
		return
	}

	routeList := make([]map[string]interface{}, 0, len(routes))
	for _, route := range routes {
		routeList = append(routeList, map[string]interface{}{
			"id":          route.ID,
			"tunnel_id":   route.TunnelID,
			"match_type":  route.MatchType,
			"match_value": route.MatchValue,
			"upstream":    route.Upstream,
			"enabled":     route.Enabled,
		})
	}

	// Firewall
	fwRules, err := s.fwStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list firewall rules: %v", err))
		return
	}

	fwList := make([]map[string]interface{}, 0, len(fwRules))
	for _, rule := range fwRules {
		fwList = append(fwList, map[string]interface{}{
			"id":          rule.ID,
			"port":        rule.Port,
			"proto":       rule.Proto,
			"source_cidr": rule.SourceCIDR,
			"action":      rule.Action,
			"enabled":     rule.Enabled,
		})
	}

	// Reconciliation state
	reconcState, err := s.fwStore.GetReconciliationState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get reconciliation state: %v", err))
		return
	}

	var lastError interface{} = nil
	if reconcState.LastError != "" {
		lastError = reconcState.LastError
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tunnels": map[string]interface{}{
			"total":     len(tunnels),
			"connected": connectedCount,
			"peers":     peers,
		},
		"routes": map[string]interface{}{
			"total":  len(routes),
			"routes": routeList,
		},
		"firewall": map[string]interface{}{
			"dynamic_rules": len(fwRules),
			"rules":         fwList,
		},
		"reconciliation": map[string]interface{}{
			"interval_seconds":       reconcState.IntervalSeconds,
			"last_run_at":            formatTimePtr(reconcState.LastRunAt),
			"last_status":            reconcState.LastStatus,
			"last_error":             lastError,
			"drift_corrections_total": reconcState.DriftCorrections,
		},
	})
}

func (s *Server) handleForceReconcile(w http.ResponseWriter, r *http.Request) {
	if s.reconciler != nil {
		s.reconciler.ForceReconcile()
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "reconciliation triggered",
	})
}

func (s *Server) handleGetServerPubkey(w http.ResponseWriter, r *http.Request) {
	pubkey, err := s.wgManager.GetServerPublicKey()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get server public key: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"public_key": pubkey,
	})
}
