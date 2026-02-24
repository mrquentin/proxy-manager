package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/proxy-manager/controlplane/internal/firewall"
	"github.com/proxy-manager/controlplane/internal/store"
	"github.com/proxy-manager/controlplane/internal/wireguard"
)

type createFirewallRuleRequest struct {
	Port       int    `json:"port"`
	Proto      string `json:"proto"`
	SourceCIDR string `json:"source_cidr,omitempty"`
	Action     string `json:"action,omitempty"`
}

func (s *Server) handleCreateFirewallRule(w http.ResponseWriter, r *http.Request) {
	var req createFirewallRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// Set defaults
	if req.SourceCIDR == "" {
		req.SourceCIDR = "0.0.0.0/0"
	}
	if req.Action == "" {
		req.Action = "allow"
	}

	// Validate port
	if req.Port < 1 || req.Port > 65535 {
		writeError(w, http.StatusBadRequest, "port must be between 1 and 65535")
		return
	}
	if reservedPorts[req.Port] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("port %d is reserved", req.Port))
		return
	}

	// Validate protocol
	if req.Proto != "tcp" && req.Proto != "udp" {
		writeError(w, http.StatusBadRequest, "proto must be 'tcp' or 'udp'")
		return
	}

	// Validate CIDR
	_, _, err := net.ParseCIDR(req.SourceCIDR)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid source_cidr: %v", err))
		return
	}

	// Validate action
	if req.Action != "allow" && req.Action != "deny" {
		writeError(w, http.StatusBadRequest, "action must be 'allow' or 'deny'")
		return
	}

	ruleID := wireguard.GenerateRandomID("fw_rule_")

	// Add to nftables
	fwRule := firewall.Rule{
		ID:         ruleID,
		Port:       req.Port,
		Proto:      req.Proto,
		Direction:  "in",
		SourceCIDR: req.SourceCIDR,
		Action:     req.Action,
	}
	if err := s.fwManager.AddRule(fwRule); err != nil {
		// Non-fatal, reconciler will fix
		fmt.Printf("warning: failed to add nftables rule: %v\n", err)
	}

	// Persist to SQLite
	dbRule := &store.FirewallRule{
		ID:         ruleID,
		Port:       req.Port,
		Proto:      req.Proto,
		Direction:  "in",
		SourceCIDR: req.SourceCIDR,
		Action:     req.Action,
		Enabled:    true,
	}
	if err := s.fwStore.Create(dbRule); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist firewall rule: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"data": map[string]interface{}{
			"id":          ruleID,
			"port":        req.Port,
			"proto":       req.Proto,
			"source_cidr": req.SourceCIDR,
			"action":      req.Action,
			"status":      "active",
			"enabled":     true,
			"created_at":  dbRule.CreatedAt.UTC().Format(time.RFC3339),
			"updated_at":  dbRule.UpdatedAt.UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleListFirewallRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.fwStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to list firewall rules: %v", err))
		return
	}

	result := make([]map[string]interface{}, 0, len(rules))
	for _, rule := range rules {
		entry := map[string]interface{}{
			"id":          rule.ID,
			"port":        rule.Port,
			"proto":       rule.Proto,
			"direction":   rule.Direction,
			"source_cidr": rule.SourceCIDR,
			"action":      rule.Action,
			"enabled":     rule.Enabled,
			"created_at":  rule.CreatedAt.UTC().Format(time.RFC3339),
			"updated_at":  rule.UpdatedAt.UTC().Format(time.RFC3339),
		}
		result = append(result, entry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": result})
}

func (s *Server) handleDeleteFirewallRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "rule id is required")
		return
	}

	rule, err := s.fwStore.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "firewall rule not found")
		return
	}

	// Remove from nftables
	if err := s.fwManager.DeleteRule(rule.ID); err != nil {
		// Non-fatal
		fmt.Printf("warning: failed to delete nftables rule: %v\n", err)
	}

	// Delete from DB
	if err := s.fwStore.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to delete firewall rule: %v", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
